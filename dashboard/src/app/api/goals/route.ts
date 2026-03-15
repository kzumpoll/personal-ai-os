import { NextRequest, NextResponse } from 'next/server';
import pool, { Goal, logDbError } from '@/lib/db';

export async function GET() {
  try {
    const { rows } = await pool.query<Goal>(
      'SELECT * FROM goals ORDER BY status ASC, quarter DESC, created_at DESC'
    );
    return NextResponse.json({ goals: rows });
  } catch (err) {
    logDbError('api/goals GET', err);
    return NextResponse.json({ error: 'Failed to fetch goals' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, title, description, status, quarter } = await req.json() as {
      id: string; title?: string; description?: string; status?: string; quarter?: string;
    };
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (title       !== undefined) { sets.push(`title       = $${idx++}`); vals.push(title); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); vals.push(description); }
    if (status      !== undefined) { sets.push(`status      = $${idx++}`); vals.push(status); }
    if (quarter     !== undefined) { sets.push(`quarter     = $${idx++}`); vals.push(quarter); }

    if (!sets.length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });

    vals.push(id);
    const { rows } = await pool.query<Goal>(
      `UPDATE goals SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ goal: rows[0] });
  } catch (err) {
    logDbError('api/goals PATCH', err);
    return NextResponse.json({ error: 'Failed to update goal' }, { status: 500 });
  }
}
