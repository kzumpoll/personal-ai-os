import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import pool, { logDbError } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { ids, category_id } = await req.json() as { ids: string[]; category_id: string };
    if (!Array.isArray(ids) || ids.length === 0 || !category_id) {
      return NextResponse.json({ error: 'ids (non-empty array) and category_id required' }, { status: 400 });
    }

    // Fetch category info once
    const catRes = await pool.query<{ name: string; is_income: boolean }>(
      `SELECT name, is_income FROM finance_categories WHERE id = $1`,
      [category_id]
    );
    if (catRes.rows.length === 0) return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    const { name: categoryName, is_income } = catRes.rows[0];

    // Bulk update all transactions
    const placeholders = ids.map((_, i) => `$${i + 3}`).join(',');
    const { rows: updated } = await pool.query(
      `UPDATE finance_transactions
       SET category_id = $1, status = 'categorized', is_income = $2
       WHERE id IN (${placeholders})
       RETURNING id, merchant_raw, description`,
      [category_id, is_income, ...ids]
    );

    // Write merchant→category memory for each updated transaction
    for (const tx of updated) {
      const merchant = ((tx.merchant_raw as string | null) ?? (tx.description as string)).trim().slice(0, 120);
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
    }

    revalidatePath('/finances');
    return NextResponse.json({ ok: true, updated: updated.length });
  } catch (err) {
    logDbError('api/finances/bulk-categorize POST', err);
    return NextResponse.json({ error: 'Failed to bulk categorize' }, { status: 500 });
  }
}
