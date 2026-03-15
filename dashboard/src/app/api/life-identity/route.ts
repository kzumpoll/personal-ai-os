import { NextRequest, NextResponse } from 'next/server';
import pool, { logDbError } from '@/lib/db';

export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT key, content FROM life_identity ORDER BY id`
    );
    const identity: Record<string, string> = {};
    for (const r of rows) identity[r.key as string] = r.content as string;
    return NextResponse.json({ identity });
  } catch (err) {
    logDbError('api/life-identity GET', err);
    return NextResponse.json({ error: 'Failed to fetch identity' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { key, content } = await req.json() as { key: string; content: string };
    if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });
    await pool.query(
      `INSERT INTO life_identity (key, content)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET content = $2, updated_at = NOW()`,
      [key, content ?? '']
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    logDbError('api/life-identity PATCH', err);
    return NextResponse.json({ error: 'Failed to save identity section' }, { status: 500 });
  }
}
