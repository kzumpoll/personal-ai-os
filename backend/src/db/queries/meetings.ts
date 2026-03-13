import pool from '../client';

export interface Meeting {
  id: string;
  title: string;
  meeting_date: string;
  start_time: string | null;
  end_time: string | null;
  attendees: string[];
  transcript: string | null;
  summary: string | null;
  source: string;
  source_id: string | null;
  calendar_event_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MeetingAction {
  id: string;
  meeting_id: string;
  action: string;
  assignee: string | null;
  due_date: string | null;
  status: string;
  created_at: string;
}

export async function createMeeting(data: {
  title: string;
  meeting_date: string;
  start_time?: string;
  end_time?: string;
  attendees?: string[];
  transcript?: string;
  summary?: string;
  source?: string;
  source_id?: string;
  calendar_event_id?: string;
}): Promise<Meeting> {
  const { rows } = await pool.query<Meeting>(
    `INSERT INTO meetings (title, meeting_date, start_time, end_time, attendees, transcript, summary, source, source_id, calendar_event_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      data.title, data.meeting_date, data.start_time ?? null, data.end_time ?? null,
      data.attendees ?? [], data.transcript ?? null, data.summary ?? null,
      data.source ?? 'granola', data.source_id ?? null, data.calendar_event_id ?? null,
    ]
  );
  return rows[0];
}

export async function getMeetingsForDate(date: string): Promise<Meeting[]> {
  const { rows } = await pool.query<Meeting>(
    `SELECT * FROM meetings WHERE meeting_date = $1 ORDER BY start_time ASC`, [date]
  );
  return rows;
}

export async function getRecentMeetings(limit = 20): Promise<Meeting[]> {
  const { rows } = await pool.query<Meeting>(
    `SELECT * FROM meetings ORDER BY meeting_date DESC, start_time DESC LIMIT $1`, [limit]
  );
  return rows;
}

export async function createMeetingAction(data: {
  meeting_id: string;
  action: string;
  assignee?: string;
  due_date?: string;
}): Promise<MeetingAction> {
  const { rows } = await pool.query<MeetingAction>(
    `INSERT INTO meeting_actions (meeting_id, action, assignee, due_date)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [data.meeting_id, data.action, data.assignee ?? null, data.due_date ?? null]
  );
  return rows[0];
}

export async function getActionsForMeeting(meetingId: string): Promise<MeetingAction[]> {
  const { rows } = await pool.query<MeetingAction>(
    `SELECT * FROM meeting_actions WHERE meeting_id = $1 ORDER BY created_at ASC`, [meetingId]
  );
  return rows;
}

export async function getPendingActions(limit = 20): Promise<(MeetingAction & { meeting_title: string })[]> {
  const { rows } = await pool.query<MeetingAction & { meeting_title: string }>(
    `SELECT ma.*, m.title as meeting_title
     FROM meeting_actions ma
     JOIN meetings m ON ma.meeting_id = m.id
     WHERE ma.status = 'pending'
     ORDER BY ma.due_date ASC NULLS LAST, ma.created_at ASC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function completeMeetingAction(id: string): Promise<void> {
  await pool.query(`UPDATE meeting_actions SET status = 'done' WHERE id = $1`, [id]);
}
