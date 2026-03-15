import { NextRequest, NextResponse } from 'next/server';
import pool, { logDbError } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page     = Math.max(1, parseInt(searchParams.get('page')     ?? '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '30')));
  const search   = (searchParams.get('search') ?? '').trim();
  const offset   = (page - 1) * pageSize;

  // When searching: $1 = pattern, $2 = pageSize, $3 = offset
  // When not:       $1 = pageSize, $2 = offset
  const searchClause = search ? `AND (t.description ILIKE $1 OR COALESCE(t.merchant_raw,'') ILIKE $1)` : '';
  const limitIdx     = search ? 2 : 1;
  const offsetIdx    = search ? 3 : 2;
  const baseParams   = search ? [`%${search}%`] : [];

  try {
    const [countRes, rowsRes] = await Promise.all([
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM finance_transactions t
         WHERE t.status = 'uncategorized' ${searchClause}`,
        baseParams
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
         WHERE t.status = 'uncategorized' ${searchClause}
         ORDER BY t.date DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...baseParams, pageSize, offset]
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
