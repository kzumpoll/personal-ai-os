import { NextResponse } from 'next/server';
import pool, { logDbError } from '@/lib/db';

export const revalidate = 0; // never cache — always live

export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT status, current_task, permission_request, updated_at
       FROM claude_code_status WHERE id = 'default'`
    );
    if (rows.length === 0) {
      return NextResponse.json({ status: 'idle', current_task: null, permission_request: null, updated_at: null });
    }
    return NextResponse.json(rows[0]);
  } catch (err) {
    logDbError('api/claude-status', err);
    return NextResponse.json({ status: 'idle', current_task: null, permission_request: null, updated_at: null });
  }
}
