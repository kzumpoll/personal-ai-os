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
  created_at: string;
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

async function getData() {
  const empty = {
    categories: [] as Category[],
    uncategorized: [] as Transaction[],
    recentTransactions: [] as Transaction[],
    spendByCategory: [] as SpendRow[],
    netFlow: { income: 0, expenses: 0, net: 0, income_usd: 0, expenses_usd: 0, net_usd: 0 },
    snapshots: [] as BalanceSnapshot[],
    manualHoldings: [] as ManualHolding[],
    manualHoldingsDate: null as string | null,
    fxRates: [] as FxRate[],
  };

  try {
    const now = new Date();
    const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const endOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`;

    const [categoriesRes, uncategorizedRes, recentRes, spendRes, netFlowRes, snapshotsRes, fxRes] = await Promise.all([
      pool.query<Category>('SELECT * FROM finance_categories ORDER BY is_income, name'),
      pool.query<Transaction>(
        `SELECT t.*, c.name as category_name
         FROM finance_transactions t
         LEFT JOIN finance_categories c ON t.category_id = c.id
         WHERE t.status = 'uncategorized'
         ORDER BY t.date DESC LIMIT 100`
      ),
      pool.query<Transaction>(
        `SELECT t.*, c.name as category_name
         FROM finance_transactions t
         LEFT JOIN finance_categories c ON t.category_id = c.id
         ORDER BY t.date DESC LIMIT 50`
      ),
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
      ),
      pool.query(
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
      ),
      pool.query<BalanceSnapshot>('SELECT *, balance_usd FROM finance_balance_snapshots ORDER BY date DESC, account ASC'),
      pool.query<FxRate>('SELECT * FROM fx_rates ORDER BY date DESC, currency ASC LIMIT 50'),
    ]);

    // Separate query — table may not exist yet if migration hasn't run
    let manualRes = { rows: [] as ManualHolding[] };
    try {
      manualRes = await pool.query<ManualHolding>(
        `SELECT * FROM finance_manual_holdings
         WHERE as_of_date = (SELECT MAX(as_of_date) FROM finance_manual_holdings)
         ORDER BY asset_type, asset_name`
      );
    } catch { /* table may not exist yet */ }

    const income = parseFloat(netFlowRes.rows[0]?.income ?? '0');
    const expenses = parseFloat(netFlowRes.rows[0]?.expenses ?? '0');
    const income_usd = parseFloat(netFlowRes.rows[0]?.income_usd ?? '0');
    const expenses_usd = parseFloat(netFlowRes.rows[0]?.expenses_usd ?? '0');

    return {
      categories: categoriesRes.rows,
      uncategorized: uncategorizedRes.rows,
      recentTransactions: recentRes.rows,
      spendByCategory: spendRes.rows.map(r => ({ ...r, total: parseFloat(String(r.total)), total_usd: parseFloat(String(r.total_usd)) })),
      netFlow: { income, expenses, net: income - expenses, income_usd, expenses_usd, net_usd: income_usd - expenses_usd },
      snapshots: snapshotsRes.rows,
      manualHoldings: manualRes.rows,
      manualHoldingsDate: manualRes.rows[0]?.as_of_date ?? null,
      fxRates: fxRes.rows,
    };
  } catch (err) {
    logDbError('finances', err);
    return empty;
  }
}

export default async function FinancesPage() {
  const data = await getData();
  return <FinancesView {...data} />;
}
