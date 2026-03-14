import pool, { logDbError } from '@/lib/db';
import FinancesView from '@/components/FinancesView';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Category {
  id: string;
  name: string;
  color: string | null;
  is_income: boolean;
}

interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  category_id: string | null;
  category_name: string | null;
  account: string | null;
  is_income: boolean;
  status: string;
}

interface BalanceSnapshot {
  id: string;
  account: string;
  date: string;
  balance: number;
  currency: string;
  balance_usd: number | null;
  notes: string | null;
}

interface ManualHolding {
  id: string;
  as_of_date: string;
  asset_type: 'crypto' | 'stock';
  asset_name: string;
  platform: string;
  quantity: number | null;
  usd_value: number;
  notes: string | null;
}

interface FxRate {
  id: string;
  date: string;
  currency: string;
  rate_to_usd: number;
  is_estimated: boolean;
}

interface SpendRow {
  name: string;
  color: string;
  total: number;
  total_usd: number;
}

// Runs a DB query and returns its rows. On failure, logs the error, returns [] and the error string.
// This lets one failing query show partial data instead of blanking the whole page.
async function safeRows<T>(label: string, fn: () => Promise<{ rows: T[] }>): Promise<{ rows: T[]; error: string | null }> {
  try {
    const result = await fn();
    return { rows: result.rows, error: null };
  } catch (err) {
    logDbError(`finances/${label}`, err);
    const code = (err as Record<string, unknown>)?.code;
    const msg = err instanceof Error ? err.message : String(err);
    return { rows: [], error: `[${label}]${code ? ` (${code})` : ''}: ${msg}` };
  }
}

async function getData() {
  const now = new Date();
  const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const endOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`;

  const [categoriesR, uncategorizedR, recentR, spendR, netFlowR, snapshotsR, manualR, fxR] = await Promise.all([
    safeRows('categories', () =>
      pool.query<Category>('SELECT id, name, color, is_income FROM finance_categories ORDER BY is_income, name')
    ),
    safeRows('uncategorized', () =>
      pool.query<Transaction>(
        `SELECT t.id, t.date, t.description, t.amount, t.currency, t.category_id, t.account, t.is_income, t.status, c.name as category_name
         FROM finance_transactions t
         LEFT JOIN finance_categories c ON t.category_id = c.id
         WHERE t.status = 'uncategorized'
         ORDER BY t.date DESC LIMIT 100`
      )
    ),
    safeRows('recent', () =>
      pool.query<Transaction>(
        `SELECT t.id, t.date, t.description, t.amount, t.currency, t.category_id, t.account, t.is_income, t.status, c.name as category_name
         FROM finance_transactions t
         LEFT JOIN finance_categories c ON t.category_id = c.id
         ORDER BY t.date DESC LIMIT 50`
      )
    ),
    safeRows('spend', () =>
      pool.query<SpendRow>(
        `SELECT c.name, c.color, SUM(ABS(t.amount)) as total,
           COALESCE(SUM(ABS(t.amount) / NULLIF(COALESCE(fx.rate_to_usd, CASE WHEN t.currency = 'USD' THEN 1 END), 0)), SUM(ABS(t.amount))) as total_usd
         FROM finance_transactions t
         JOIN finance_categories c ON t.category_id = c.id
         LEFT JOIN LATERAL (
           SELECT rate_to_usd FROM fx_rates WHERE currency = t.currency AND date <= t.date ORDER BY date DESC LIMIT 1
         ) fx ON true
         WHERE t.date >= $1 AND t.date <= $2 AND t.is_income = false AND t.status = 'categorized'
         GROUP BY c.name, c.color
         ORDER BY total_usd DESC`,
        [startOfMonth, endOfMonth]
      )
    ),
    safeRows('netflow', () =>
      pool.query<Record<string, string>>(
        `SELECT
           COALESCE(SUM(CASE WHEN is_income THEN amount ELSE 0 END), 0) as income,
           COALESCE(SUM(CASE WHEN NOT is_income THEN ABS(amount) ELSE 0 END), 0) as expenses,
           COALESCE(SUM(CASE WHEN is_income THEN amount / NULLIF(COALESCE(fx.rate_to_usd, CASE WHEN t.currency = 'USD' THEN 1 END), 0) ELSE 0 END), 0) as income_usd,
           COALESCE(SUM(CASE WHEN NOT is_income THEN ABS(amount) / NULLIF(COALESCE(fx.rate_to_usd, CASE WHEN t.currency = 'USD' THEN 1 END), 0) ELSE 0 END), 0) as expenses_usd
         FROM finance_transactions t
         LEFT JOIN LATERAL (
           SELECT rate_to_usd FROM fx_rates WHERE currency = t.currency AND date <= t.date ORDER BY date DESC LIMIT 1
         ) fx ON true
         WHERE t.date >= $1 AND t.date <= $2 AND t.status = 'categorized'`,
        [startOfMonth, endOfMonth]
      )
    ),
    safeRows('snapshots', () =>
      pool.query<BalanceSnapshot>('SELECT id, account, date, balance, currency, balance_usd, notes FROM finance_balance_snapshots ORDER BY date DESC, account ASC')
    ),
    safeRows('holdings', () =>
      pool.query<ManualHolding>(
        `SELECT id, as_of_date, asset_type, asset_name, platform, quantity, usd_value, notes FROM finance_manual_holdings
         WHERE as_of_date = (SELECT MAX(as_of_date) FROM finance_manual_holdings)
         ORDER BY asset_type, asset_name`
      )
    ),
    safeRows('fx', () =>
      pool.query<FxRate>('SELECT id, date, currency, rate_to_usd, is_estimated FROM fx_rates ORDER BY date DESC, currency ASC LIMIT 50')
    ),
  ]);

  const netRow = netFlowR.rows[0] ?? {};
  const income = parseFloat(netRow.income ?? '0');
  const expenses = parseFloat(netRow.expenses ?? '0');
  const income_usd = parseFloat(netRow.income_usd ?? '0');
  const expenses_usd = parseFloat(netRow.expenses_usd ?? '0');

  const errors = [categoriesR, uncategorizedR, recentR, spendR, netFlowR, snapshotsR, manualR, fxR]
    .map(r => r.error).filter(Boolean) as string[];

  const result = {
    categories: categoriesR.rows,
    uncategorized: uncategorizedR.rows,
    recentTransactions: recentR.rows,
    spendByCategory: spendR.rows.map(r => ({ ...r, total: parseFloat(String(r.total)), total_usd: parseFloat(String(r.total_usd)) })),
    netFlow: { income, expenses, net: income - expenses, income_usd, expenses_usd, net_usd: income_usd - expenses_usd },
    snapshots: snapshotsR.rows,
    manualHoldings: manualR.rows,
    manualHoldingsDate: manualR.rows[0]?.as_of_date ?? null,
    fxRates: fxR.rows,
    dbErrors: errors,
  };
  // JSON round-trip strips any Date objects pg returns for TIMESTAMPTZ columns,
  // converting them to ISO strings. Without this, React throws error #31 when
  // a Date lands in a JSX child via the RSC payload.
  return JSON.parse(JSON.stringify(result)) as typeof result;
}

export default async function FinancesPage() {
  const data = await getData();
  return (
    <>
      {data.dbErrors.length > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          <p style={{ color: 'var(--red)', marginBottom: 4, fontWeight: 600 }}>DB query errors — check Vercel logs for full details:</p>
          {data.dbErrors.map((e, i) => <p key={i} style={{ color: 'var(--red)', opacity: 0.8 }}>{e}</p>)}
        </div>
      )}
      <FinancesView {...data} />
    </>
  );
}
