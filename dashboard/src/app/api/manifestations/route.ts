import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import pool, { logDbError } from '@/lib/db';

export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM manifestations ORDER BY
        CASE status WHEN 'active' THEN 0 WHEN 'manifested' THEN 1 ELSE 2 END,
        created_at DESC`
    );
    return NextResponse.json(rows);
  } catch (err) {
    logDbError('api/manifestations GET', err);
    return NextResponse.json({ error: 'Failed to fetch manifestations' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { category, vision, why, timeframe } = await req.json();
    if (!vision || !category) {
      return NextResponse.json({ error: 'category and vision required' }, { status: 400 });
    }
    const { rows } = await pool.query(
      `INSERT INTO manifestations (category, vision, why, timeframe)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [category, vision, why ?? null, timeframe ?? null]
    );
    revalidatePath('/manifestations');
    return NextResponse.json(rows[0]);
  } catch (err) {
    logDbError('api/manifestations POST', err);
    return NextResponse.json({ error: 'Failed to create manifestation' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, status, evidence, vision, why, timeframe, category } = await req.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (status !== undefined) { sets.push(`status = $${idx++}`); vals.push(status); }
    if (evidence !== undefined) { sets.push(`evidence = $${idx++}`); vals.push(evidence); }
    if (vision !== undefined) { sets.push(`vision = $${idx++}`); vals.push(vision); }
    if (why !== undefined) { sets.push(`why = $${idx++}`); vals.push(why); }
    if (timeframe !== undefined) { sets.push(`timeframe = $${idx++}`); vals.push(timeframe); }
    if (category !== undefined) { sets.push(`category = $${idx++}`); vals.push(category); }
    if (status === 'manifested') { sets.push(`manifested_at = NOW()`); }
    sets.push('updated_at = NOW()');

    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE manifestations SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    revalidatePath('/manifestations');
    return NextResponse.json(rows[0]);
  } catch (err) {
    logDbError('api/manifestations PATCH', err);
    return NextResponse.json({ error: 'Failed to update manifestation' }, { status: 500 });
  }
}
