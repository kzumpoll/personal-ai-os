import { NextRequest, NextResponse } from 'next/server';
import pool, { logDbError } from '@/lib/db';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { status, scheduled_at } = body;

    if (status === 'done') {
      await pool.query(`UPDATE reminders SET status = 'done', completed_at = NOW(), updated_at = NOW() WHERE id = $1`, [params.id]);
    } else if (status === 'cancelled') {
      await pool.query(`UPDATE reminders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [params.id]);
    } else if (scheduled_at) {
      await pool.query(`UPDATE reminders SET scheduled_at = $2, status = 'pending', updated_at = NOW() WHERE id = $1`, [params.id, scheduled_at]);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    logDbError('api/reminders PATCH', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await pool.query('DELETE FROM reminders WHERE id = $1', [params.id]);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    logDbError('api/reminders DELETE', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
