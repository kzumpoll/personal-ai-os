import pool from '../client';

export interface FinanceCategory {
  id: string;
  name: string;
  color: string | null;
  is_income: boolean;
  created_at: string;
}

export interface FinanceTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  category_id: string | null;
  category_name?: string;
  account: string | null;
  is_income: boolean;
  status: string;
  statement_id: string | null;
  created_at: string;
}

export interface BalanceSnapshot {
  id: string;
  account: string;
  date: string;
  balance: number;
  currency: string;
  notes: string | null;
  created_at: string;
}

export async function getCategories(): Promise<FinanceCategory[]> {
  const { rows } = await pool.query('SELECT * FROM finance_categories ORDER BY is_income, name');
  return rows;
}

export async function getTransactions(opts?: {
  startDate?: string;
  endDate?: string;
  status?: string;
  limit?: number;
}): Promise<FinanceTransaction[]> {
  let query = `
    SELECT t.*, c.name as category_name
    FROM finance_transactions t
    LEFT JOIN finance_categories c ON t.category_id = c.id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  let idx = 1;

  if (opts?.startDate) { query += ` AND t.date >= $${idx++}`; params.push(opts.startDate); }
  if (opts?.endDate) { query += ` AND t.date <= $${idx++}`; params.push(opts.endDate); }
  if (opts?.status) { query += ` AND t.status = $${idx++}`; params.push(opts.status); }

  query += ` ORDER BY t.date DESC LIMIT $${idx}`;
  params.push(opts?.limit ?? 200);

  const { rows } = await pool.query(query, params);
  return rows;
}

export async function categorizeTransaction(id: string, categoryId: string): Promise<void> {
  await pool.query(
    `UPDATE finance_transactions SET category_id = $2, status = 'categorized', is_income = (SELECT is_income FROM finance_categories WHERE id = $2) WHERE id = $1`,
    [id, categoryId]
  );
}

export async function getSpendByCategory(startDate: string, endDate: string): Promise<Array<{ name: string; color: string; total: number }>> {
  const { rows } = await pool.query(
    `SELECT c.name, c.color, SUM(ABS(t.amount)) as total
     FROM finance_transactions t
     JOIN finance_categories c ON t.category_id = c.id
     WHERE t.date >= $1 AND t.date <= $2 AND t.is_income = false AND t.status = 'categorized'
     GROUP BY c.name, c.color
     ORDER BY total DESC`,
    [startDate, endDate]
  );
  return rows.map(r => ({ ...r, total: parseFloat(r.total) }));
}

export async function getMonthlyNetFlow(startDate: string, endDate: string): Promise<{ income: number; expenses: number; net: number }> {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN is_income THEN amount ELSE 0 END), 0) as income,
       COALESCE(SUM(CASE WHEN NOT is_income THEN ABS(amount) ELSE 0 END), 0) as expenses
     FROM finance_transactions
     WHERE date >= $1 AND date <= $2 AND status = 'categorized'`,
    [startDate, endDate]
  );
  const income = parseFloat(rows[0]?.income ?? '0');
  const expenses = parseFloat(rows[0]?.expenses ?? '0');
  return { income, expenses, net: income - expenses };
}

export async function getBalanceSnapshots(): Promise<BalanceSnapshot[]> {
  const { rows } = await pool.query(
    'SELECT * FROM finance_balance_snapshots ORDER BY date DESC, account ASC'
  );
  return rows;
}

export async function upsertBalanceSnapshot(data: {
  account: string;
  date: string;
  balance: number;
  currency: string;
  notes?: string;
}): Promise<BalanceSnapshot> {
  const { rows } = await pool.query(
    `INSERT INTO finance_balance_snapshots (account, date, balance, currency, notes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (account, date) DO UPDATE SET balance = $3, currency = $4, notes = $5
     RETURNING *`,
    [data.account, data.date, data.balance, data.currency, data.notes ?? null]
  );
  return rows[0];
}

export async function insertTransactions(transactions: Array<{
  date: string;
  description: string;
  amount: number;
  currency?: string;
  account?: string;
  statement_id?: string;
}>): Promise<number> {
  let count = 0;
  for (const t of transactions) {
    await pool.query(
      `INSERT INTO finance_transactions (date, description, amount, currency, account, statement_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [t.date, t.description, t.amount, t.currency ?? 'AED', t.account ?? null, t.statement_id ?? null]
    );
    count++;
  }
  return count;
}

/** Create a finance_statements record and return its UUID. */
export async function createStatement(data: {
  filename: string;
  account?: string;
  parsedCount: number;
  importBatchId: string;
}): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO finance_statements (id, filename, account, parsed_count)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [data.importBatchId, data.filename, data.account ?? null, data.parsedCount]
  );
  return rows[0].id as string;
}

export interface ImportedTransaction {
  source_name: string;
  transaction_date: string;
  booking_date?: string;
  amount: number;
  currency: string;
  description_raw: string;
  merchant_raw?: string;
  fee: number;
  direction: 'credit' | 'debit';
  external_id: string;
  import_batch_id: string;
  statement_id: string;
}

/**
 * Insert normalized transactions from a CSV import.
 * Uses ON CONFLICT DO NOTHING on external_id to skip duplicates across re-imports.
 * Returns the number of rows actually inserted.
 */
export async function insertImportedTransactions(transactions: ImportedTransaction[]): Promise<number> {
  let inserted = 0;
  for (const t of transactions) {
    const result = await pool.query(
      `INSERT INTO finance_transactions
         (date, description, amount, currency, account, is_income, statement_id,
          source_name, booking_date, description_raw, merchant_raw, fee, direction, external_id, import_batch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO NOTHING`,
      [
        t.transaction_date,
        t.description_raw,
        t.amount,
        t.currency,
        null,                          // account — set later via categorization
        t.direction === 'credit',      // is_income
        t.statement_id,
        t.source_name,
        t.booking_date ?? null,
        t.description_raw,
        t.merchant_raw ?? null,
        t.fee,
        t.direction,
        t.external_id,
        t.import_batch_id,
      ]
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}
