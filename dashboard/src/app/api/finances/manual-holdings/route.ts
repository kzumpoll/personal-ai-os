import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import pool, { logDbError } from '@/lib/db';

export async function GET() {
  try {
    // Return latest snapshot (most recent as_of_date) + total
    const { rows } = await pool.query(
      `SELECT * FROM finance_manual_holdings
       WHERE as_of_date = (SELECT MAX(as_of_date) FROM finance_manual_holdings)
       ORDER BY asset_type, asset_name`
    );
    const total = rows.reduce((sum, r) => sum + Number(r.usd_value), 0);
    const asOfDate = rows[0]?.as_of_date ?? null;
    return NextResponse.json({ holdings: rows, total, asOfDate });
  } catch (err) {
    logDbError('api/finances/manual-holdings GET', err);
    return NextResponse.json({ error: 'Failed to fetch manual holdings' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Duplicate snapshot action
    if (body.action === 'duplicate_snapshot') {
      const today = new Date().toISOString().slice(0, 10);
      const { rows } = await pool.query(
        `INSERT INTO finance_manual_holdings (as_of_date, asset_type, asset_name, platform, quantity, usd_value, notes)
         SELECT $1, asset_type, asset_name, platform, quantity, usd_value, notes
         FROM finance_manual_holdings
         WHERE as_of_date = (SELECT MAX(as_of_date) FROM finance_manual_holdings)
         RETURNING *`,
        [today]
      );
      revalidatePath('/finances');
      return NextResponse.json({ duplicated: rows.length, asOfDate: today });
    }

    // Upsert a single holding
    const { id, as_of_date, asset_type, asset_name, platform, quantity, usd_value, notes } = body;
    if (!asset_type || !asset_name || usd_value === undefined || !as_of_date) {
      return NextResponse.json({ error: 'as_of_date, asset_type, asset_name, and usd_value required' }, { status: 400 });
    }

    if (id) {
      // Update existing
      const { rows } = await pool.query(
        `UPDATE finance_manual_holdings
         SET asset_type = $2, asset_name = $3, platform = $4, quantity = $5, usd_value = $6, notes = $7, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, asset_type, asset_name, platform ?? 'Manual', quantity ?? null, usd_value, notes ?? null]
      );
      revalidatePath('/finances');
      return NextResponse.json(rows[0]);
    }

    // Insert new
    const { rows } = await pool.query(
      `INSERT INTO finance_manual_holdings (as_of_date, asset_type, asset_name, platform, quantity, usd_value, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [as_of_date, asset_type, asset_name, platform ?? 'Manual', quantity ?? null, usd_value, notes ?? null]
    );
    revalidatePath('/finances');
    return NextResponse.json(rows[0]);
  } catch (err) {
    logDbError('api/finances/manual-holdings POST', err);
    return NextResponse.json({ error: 'Failed to save manual holding' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    await pool.query('DELETE FROM finance_manual_holdings WHERE id = $1', [id]);
    revalidatePath('/finances');
    return NextResponse.json({ deleted: true });
  } catch (err) {
    logDbError('api/finances/manual-holdings DELETE', err);
    return NextResponse.json({ error: 'Failed to delete holding' }, { status: 500 });
  }
}
