import { NextRequest, NextResponse } from 'next/server';
import pool, { logDbError } from '@/lib/db';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { title, content_or_url, type } = await req.json() as { title?: string; content_or_url?: string; type?: string };
    if (!title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 });
    const { rows } = await pool.query(
      `UPDATE resources SET title = $1, content_or_url = $2, type = $3 WHERE id = $4 RETURNING *`,
      [title.trim(), content_or_url?.trim() ?? null, type?.trim() ?? 'note', params.id]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch (err) {
    logDbError('api/resources PATCH', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

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
