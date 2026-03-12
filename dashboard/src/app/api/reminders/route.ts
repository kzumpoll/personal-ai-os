import { NextRequest, NextResponse } from 'next/server';
import pool, { logDbError } from '@/lib/db';

export async function GET(req: NextRequest) {
  const start = req.nextUrl.searchParams.get('start');
  const end = req.nextUrl.searchParams.get('end');

  try {
    if (start && end) {
      const { rows } = await pool.query(
        `SELECT * FROM reminders WHERE scheduled_at >= $1 AND scheduled_at < $2 ORDER BY scheduled_at ASC`,
        [start, end]
      );
      return NextResponse.json(rows);
    }
    // Default: upcoming reminders
    const { rows } = await pool.query(
      `SELECT * FROM reminders WHERE status IN ('pending', 'snoozed') ORDER BY scheduled_at ASC LIMIT 50`
    );
    return NextResponse.json(rows);
  } catch (err) {
    logDbError('api/reminders GET', err);
    return NextResponse.json([], { status: 500 });
  }
}
