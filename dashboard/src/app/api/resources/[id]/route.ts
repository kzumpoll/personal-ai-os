import { NextRequest, NextResponse } from 'next/server';
import pool, { logDbError } from '@/lib/db';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { rows } = await pool.query('DELETE FROM resources WHERE id = $1 RETURNING id', [params.id]);
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    logDbError('api/resources DELETE', err);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
