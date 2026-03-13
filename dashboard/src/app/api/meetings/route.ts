import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import pool, { logDbError } from '@/lib/db';

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date');
  try {
    const { rows } = date
      ? await pool.query(`SELECT * FROM meetings WHERE meeting_date = $1 ORDER BY start_time ASC`, [date])
      : await pool.query(`SELECT * FROM meetings ORDER BY meeting_date DESC, start_time DESC LIMIT 50`);

    // Fetch actions for each meeting
    for (const m of rows) {
      const { rows: actions } = await pool.query(
        `SELECT * FROM meeting_actions WHERE meeting_id = $1 ORDER BY created_at ASC`, [m.id]
      );
      m.actions = actions;
    }

    return NextResponse.json(rows);
  } catch (err) {
    logDbError('api/meetings GET', err);
    return NextResponse.json({ error: 'Failed to fetch meetings' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { title, meeting_date, start_time, end_time, attendees, transcript, summary, source, source_id, actions } = await req.json();
    if (!title || !meeting_date) {
      return NextResponse.json({ error: 'title and meeting_date required' }, { status: 400 });
    }

    const { rows } = await pool.query(
      `INSERT INTO meetings (title, meeting_date, start_time, end_time, attendees, transcript, summary, source, source_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [title, meeting_date, start_time ?? null, end_time ?? null,
       attendees ?? [], transcript ?? null, summary ?? null,
       source ?? 'manual', source_id ?? null]
    );
    const meeting = rows[0];

    // Create actions if provided
    if (Array.isArray(actions)) {
      for (const a of actions) {
        if (!a.action) continue;
        await pool.query(
          `INSERT INTO meeting_actions (meeting_id, action, assignee, due_date) VALUES ($1, $2, $3, $4)`,
          [meeting.id, a.action, a.assignee ?? null, a.due_date ?? null]
        );
      }
    }

    revalidatePath('/calendar');
    return NextResponse.json(meeting);
  } catch (err) {
    logDbError('api/meetings POST', err);
    return NextResponse.json({ error: 'Failed to create meeting' }, { status: 500 });
  }
}
