import pool from '@/lib/db';
import { NextResponse } from 'next/server';

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = await req.json() as { title?: string; content_or_url?: string; type?: string };
    const title = body.title?.trim();
    if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });

    const { rows } = await pool.query(
      `INSERT INTO resources (title, content_or_url, type) VALUES ($1, $2, $3) RETURNING *`,
      [title, body.content_or_url?.trim() || null, body.type?.trim() || 'note']
    );
    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error('[api/resources] POST error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to create resource' }, { status: 500 });
  }
}
