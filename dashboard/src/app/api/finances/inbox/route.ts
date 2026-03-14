import { NextRequest, NextResponse } from 'next/server';
import pool, { logDbError } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page     = Math.max(1, parseInt(searchParams.get('page')     ?? '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '30')));
  const offset   = (page - 1) * pageSize;

  try {
    const [countRes, rowsRes] = await Promise.all([
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM finance_transactions WHERE status = 'uncategorized'`
      ),
      pool.query(
        `SELECT t.id,
                t.date::text          AS date,
                t.description,
                t.amount::text        AS amount,
                t.currency,
                t.category_id,
                t.account,
                t.is_income,
                t.status,
                t.source_name,
                t.direction,
                t.merchant_raw,
                c.name                AS category_name
         FROM finance_transactions t
         LEFT JOIN finance_categories c ON t.category_id = c.id
         WHERE t.status = 'uncategorized'
         ORDER BY t.date DESC
         LIMIT $1 OFFSET $2`,
        [pageSize, offset]
      ),
    ]);

    return NextResponse.json({
      transactions: rowsRes.rows,
      total:        parseInt(countRes.rows[0].count),
      page,
      pageSize,
    });
  } catch (err) {
    logDbError('api/finances/inbox GET', err);
    return NextResponse.json({ error: 'Failed to fetch inbox' }, { status: 500 });
  }
}
