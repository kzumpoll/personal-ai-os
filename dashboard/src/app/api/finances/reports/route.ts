import { NextRequest, NextResponse } from 'next/server';
import pool, { logDbError } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const startDate = searchParams.get('startDate');
  const endDate   = searchParams.get('endDate');

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate and endDate required' }, { status: 400 });
  }

  try {
    const [spendRes, netRes, monthlyRes] = await Promise.all([
      // Spend by category (total for full period)
      pool.query(
        `SELECT c.id AS category_id, c.name, c.color,
                SUM(ABS(t.amount))::text AS total,
                COALESCE(
                  SUM(ABS(t.amount) / NULLIF(COALESCE(fx.rate_to_usd, CASE WHEN t.currency = 'USD' THEN 1 END), 0)),
                  SUM(ABS(t.amount))
                )::text AS total_usd
         FROM finance_transactions t
         JOIN finance_categories c ON t.category_id = c.id
         LEFT JOIN LATERAL (
           SELECT rate_to_usd FROM fx_rates
           WHERE currency = t.currency AND date <= t.date
           ORDER BY date DESC LIMIT 1
         ) fx ON true
         WHERE t.date >= $1 AND t.date <= $2
           AND t.is_income = false AND t.status = 'categorized'
         GROUP BY c.id, c.name, c.color
         ORDER BY total_usd DESC`,
        [startDate, endDate]
      ),
      // Net flow (income vs expenses)
      pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN t.is_income THEN t.amount ELSE 0 END), 0)::text AS income,
           COALESCE(SUM(CASE WHEN NOT t.is_income THEN ABS(t.amount) ELSE 0 END), 0)::text AS expenses,
           COALESCE(SUM(CASE WHEN t.is_income THEN t.amount / NULLIF(COALESCE(fx.rate_to_usd, CASE WHEN t.currency = 'USD' THEN 1 END), 0) ELSE 0 END), 0)::text AS income_usd,
           COALESCE(SUM(CASE WHEN NOT t.is_income THEN ABS(t.amount) / NULLIF(COALESCE(fx.rate_to_usd, CASE WHEN t.currency = 'USD' THEN 1 END), 0) ELSE 0 END), 0)::text AS expenses_usd
         FROM finance_transactions t
         LEFT JOIN LATERAL (
           SELECT rate_to_usd FROM fx_rates
           WHERE currency = t.currency AND date <= t.date
           ORDER BY date DESC LIMIT 1
         ) fx ON true
         WHERE t.date >= $1 AND t.date <= $2 AND t.status = 'categorized'`,
        [startDate, endDate]
      ),
      // Monthly breakdown per category
      pool.query(
        `SELECT
           TO_CHAR(t.date, 'YYYY-MM') AS month,
           c.name AS category_name,
           COALESCE(
             SUM(ABS(t.amount) / NULLIF(COALESCE(fx.rate_to_usd, CASE WHEN t.currency = 'USD' THEN 1 END), 0)),
             SUM(ABS(t.amount))
           )::text AS total_usd
         FROM finance_transactions t
         JOIN finance_categories c ON t.category_id = c.id
         LEFT JOIN LATERAL (
           SELECT rate_to_usd FROM fx_rates
           WHERE currency = t.currency AND date <= t.date
           ORDER BY date DESC LIMIT 1
         ) fx ON true
         WHERE t.date >= $1 AND t.date <= $2
           AND t.is_income = false AND t.status = 'categorized'
         GROUP BY month, c.name
         ORDER BY month ASC, total_usd DESC`,
        [startDate, endDate]
      ),
    ]);

    const netRow       = netRes.rows[0] ?? {};
    const income       = parseFloat(netRow.income       ?? '0');
    const expenses     = parseFloat(netRow.expenses     ?? '0');
    const income_usd   = parseFloat(netRow.income_usd   ?? '0');
    const expenses_usd = parseFloat(netRow.expenses_usd ?? '0');

    return NextResponse.json({
      spendByCategory: spendRes.rows.map(r => ({
        category_id: r.category_id as string,
        name:        r.name as string,
        color:       r.color as string,
        total:       parseFloat(String(r.total)),
        total_usd:   parseFloat(String(r.total_usd)),
      })),
      netFlow: {
        income, expenses, net: income - expenses,
        income_usd, expenses_usd, net_usd: income_usd - expenses_usd,
      },
      monthlyBreakdown: monthlyRes.rows.map(r => ({
        month:         r.month as string,
        category_name: r.category_name as string,
        total_usd:     parseFloat(String(r.total_usd)),
      })),
    });
  } catch (err) {
    logDbError('api/finances/reports GET', err);
    return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 });
  }
}
