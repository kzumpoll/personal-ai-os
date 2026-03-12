import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import pool, { logDbError } from '@/lib/db';

export async function PATCH(req: NextRequest) {
  try {
    const { id, category_id } = await req.json();
    if (!id || !category_id) return NextResponse.json({ error: 'id and category_id required' }, { status: 400 });

    const { rows } = await pool.query(
      `UPDATE finance_transactions
       SET category_id = $2, status = 'categorized',
           is_income = (SELECT is_income FROM finance_categories WHERE id = $2)
       WHERE id = $1 RETURNING *`,
      [id, category_id]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    revalidatePath('/finances');
    return NextResponse.json(rows[0]);
  } catch (err) {
    logDbError('api/finances/transactions PATCH', err);
    return NextResponse.json({ error: 'Failed to categorize' }, { status: 500 });
  }
}
