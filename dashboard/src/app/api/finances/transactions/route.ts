import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import pool, { logDbError } from '@/lib/db';

function extractMerchant(merchantRaw: string | null, description: string): string {
  return (merchantRaw ?? description).trim().slice(0, 120);
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const startDate = searchParams.get('startDate');
  const endDate   = searchParams.get('endDate');
  const page      = Math.max(1, parseInt(searchParams.get('page')     ?? '1'));
  const pageSize  = Math.min(200, Math.max(1, parseInt(searchParams.get('pageSize') ?? '50')));
  const offset    = (page - 1) * pageSize;

  const categoryId = searchParams.get('categoryId');

  const filterParams: unknown[] = [];
  const conditions: string[]    = ["t.status = 'categorized'"];

  if (startDate)  { conditions.push(`t.date >= $${filterParams.length + 1}`); filterParams.push(startDate); }
  if (endDate)    { conditions.push(`t.date <= $${filterParams.length + 1}`); filterParams.push(endDate); }
  if (categoryId) { conditions.push(`t.category_id = $${filterParams.length + 1}`); filterParams.push(categoryId); }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const n     = filterParams.length;

  try {
    const [countRes, rowsRes] = await Promise.all([
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM finance_transactions t ${where}`,
        filterParams
      ),
      pool.query(
        `SELECT t.id,
                t.date::text    AS date,
                t.description,
                t.merchant_raw,
                t.amount::text  AS amount,
                t.currency,
                t.category_id,
                t.account,
                t.is_income,
                t.status,
                t.direction,
                c.name          AS category_name
         FROM finance_transactions t
         LEFT JOIN finance_categories c ON t.category_id = c.id
         ${where}
         ORDER BY t.date DESC
         LIMIT $${n + 1} OFFSET $${n + 2}`,
        [...filterParams, pageSize, offset]
      ),
    ]);

    return NextResponse.json({
      transactions: rowsRes.rows,
      total:        parseInt(countRes.rows[0].count),
      page,
      pageSize,
    });
  } catch (err) {
    logDbError('api/finances/transactions GET', err);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, category_id } = await req.json();
    if (!id || !category_id) return NextResponse.json({ error: 'id and category_id required' }, { status: 400 });

    // Categorize the transaction
    const { rows } = await pool.query(
      `UPDATE finance_transactions
       SET category_id = $2, status = 'categorized',
           is_income = (SELECT is_income FROM finance_categories WHERE id = $2)
       WHERE id = $1 RETURNING id, merchant_raw, description`,
      [id, category_id]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Write merchant→category memory so future imports get instant suggestions
    const tx           = rows[0] as { id: string; merchant_raw: string | null; description: string };
    const merchant     = extractMerchant(tx.merchant_raw, tx.description);
    const catRes       = await pool.query<{ name: string }>(`SELECT name FROM finance_categories WHERE id = $1`, [category_id]);
    const categoryName = catRes.rows[0]?.name;

    if (merchant && categoryName) {
      await pool.query(
        `INSERT INTO merchant_category_memory (merchant_name, category_id, category_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (merchant_name) DO UPDATE
           SET category_id   = $2,
               category_name = $3,
               usage_count   = merchant_category_memory.usage_count + 1,
               last_used_at  = NOW()`,
        [merchant, category_id, categoryName]
      );
    }

    revalidatePath('/finances');
    return NextResponse.json({ ok: true });
  } catch (err) {
    logDbError('api/finances/transactions PATCH', err);
    return NextResponse.json({ error: 'Failed to categorize' }, { status: 500 });
  }
}
