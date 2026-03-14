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
    const [spendRes, netRes] = await Promise.all([
      pool.query(
        `SELECT c.name, c.color,
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
         GROUP BY c.name, c.color
         ORDER BY total_usd DESC`,
        [startDate, endDate]
      ),
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
    ]);

    const netRow       = netRes.rows[0] ?? {};
    const income       = parseFloat(netRow.income       ?? '0');
    const expenses     = parseFloat(netRow.expenses     ?? '0');
    const income_usd   = parseFloat(netRow.income_usd   ?? '0');
    const expenses_usd = parseFloat(netRow.expenses_usd ?? '0');

    return NextResponse.json({
      spendByCategory: spendRes.rows.map(r => ({
        ...r,
        total:     parseFloat(String(r.total)),
        total_usd: parseFloat(String(r.total_usd)),
      })),
      netFlow: {
        income, expenses, net: income - expenses,
        income_usd, expenses_usd, net_usd: income_usd - expenses_usd,
      },
    });
  } catch (err) {
    logDbError('api/finances/reports GET', err);
    return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 });
  }
}
