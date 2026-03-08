import { NextRequest, NextResponse } from 'next/server';
import pool, { logDbError } from '@/lib/db';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { rows } = await pool.query('DELETE FROM thoughts WHERE id = $1 RETURNING id', [id]);
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ deleted: id });
  } catch (err) {
    logDbError('api/thoughts DELETE', err);
    return NextResponse.json({ error: 'Failed to delete thought' }, { status: 500 });
  }
}
