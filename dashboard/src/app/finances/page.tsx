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
  notes: string | null;
}

interface SpendRow {
  name: string;
  color: string;
  total: number;
}

async function getData() {
  const empty = {
    categories: [] as Category[],
    uncategorized: [] as Transaction[],
    recentTransactions: [] as Transaction[],
    spendByCategory: [] as SpendRow[],
    netFlow: { income: 0, expenses: 0, net: 0 },
    snapshots: [] as BalanceSnapshot[],
  };

  try {
    const now = new Date();
    const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const endOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`;

    const [categoriesRes, uncategorizedRes, recentRes, spendRes, netFlowRes, snapshotsRes] = await Promise.all([
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
        `SELECT c.name, c.color, SUM(ABS(t.amount)) as total
         FROM finance_transactions t
         JOIN finance_categories c ON t.category_id = c.id
         WHERE t.date >= $1 AND t.date <= $2 AND t.is_income = false AND t.status = 'categorized'
         GROUP BY c.name, c.color
         ORDER BY total DESC`,
        [startOfMonth, endOfMonth]
      ),
      pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN is_income THEN amount ELSE 0 END), 0) as income,
           COALESCE(SUM(CASE WHEN NOT is_income THEN ABS(amount) ELSE 0 END), 0) as expenses
         FROM finance_transactions
         WHERE date >= $1 AND date <= $2 AND status = 'categorized'`,
        [startOfMonth, endOfMonth]
      ),
      pool.query<BalanceSnapshot>('SELECT * FROM finance_balance_snapshots ORDER BY date DESC, account ASC'),
    ]);

    const income = parseFloat(netFlowRes.rows[0]?.income ?? '0');
    const expenses = parseFloat(netFlowRes.rows[0]?.expenses ?? '0');

    return {
      categories: categoriesRes.rows,
      uncategorized: uncategorizedRes.rows,
      recentTransactions: recentRes.rows,
      spendByCategory: spendRes.rows.map(r => ({ ...r, total: parseFloat(String(r.total)) })),
      netFlow: { income, expenses, net: income - expenses },
      snapshots: snapshotsRes.rows,
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
