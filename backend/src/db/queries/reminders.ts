import pool from '../client';

export interface Reminder {
  id: string;
  chat_id: number;
  title: string;
  body: string;
  scheduled_at: string;
  timezone: string;
  recipient_name: string | null;
  suggested_message: string | null;
  draft_message: string | null;
  status: 'pending' | 'done' | 'cancelled' | 'snoozed';
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  last_sent_at: string | null;
  snoozed_until: string | null;
}

export async function createReminder(data: {
  chat_id: number;
  title: string;
  body: string;
  scheduled_at: string;
  timezone: string;
  recipient_name: string | null;
  suggested_message: string | null;
  draft_message?: string | null;
}): Promise<Reminder> {
  const { rows } = await pool.query(
    `INSERT INTO reminders (chat_id, title, body, scheduled_at, timezone, recipient_name, suggested_message, draft_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [data.chat_id, data.title, data.body, data.scheduled_at, data.timezone, data.recipient_name, data.suggested_message, data.draft_message ?? null]
  );
  return rows[0];
}

export async function getDueReminders(): Promise<Reminder[]> {
  const { rows } = await pool.query<Reminder>(
    `SELECT * FROM reminders
     WHERE status = 'pending' AND scheduled_at <= NOW() AND last_sent_at IS NULL
     ORDER BY scheduled_at ASC
     LIMIT 20`
  );
  return rows;
}

export async function getSnoozedDueReminders(): Promise<Reminder[]> {
  const { rows } = await pool.query<Reminder>(
    `SELECT * FROM reminders
     WHERE status = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= NOW()
     ORDER BY snoozed_until ASC
     LIMIT 20`
  );
  return rows;
}

export async function markReminderSent(id: string): Promise<void> {
  await pool.query(
    `UPDATE reminders SET last_sent_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [id]
  );
}

export async function markReminderDone(id: string): Promise<void> {
  await pool.query(
    `UPDATE reminders SET status = 'done', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [id]
  );
}

export async function snoozeReminder(id: string, until: string): Promise<void> {
  await pool.query(
    `UPDATE reminders SET status = 'snoozed', snoozed_until = $2, last_sent_at = NULL, updated_at = NOW() WHERE id = $1`,
    [id, until]
  );
}

export async function rescheduleReminder(id: string, newScheduledAt: string): Promise<void> {
  await pool.query(
    `UPDATE reminders SET scheduled_at = $2, status = 'pending', last_sent_at = NULL, snoozed_until = NULL, updated_at = NOW() WHERE id = $1`,
    [id, newScheduledAt]
  );
}

export async function cancelReminder(id: string): Promise<void> {
  await pool.query(
    `UPDATE reminders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
    [id]
  );
}

export async function getReminderById(id: string): Promise<Reminder | null> {
  const { rows } = await pool.query<Reminder>(
    `SELECT * FROM reminders WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function getUpcomingReminders(chatId: number, limit = 20): Promise<Reminder[]> {
  const { rows } = await pool.query<Reminder>(
    `SELECT * FROM reminders
     WHERE chat_id = $1 AND status IN ('pending', 'snoozed')
     ORDER BY scheduled_at ASC
     LIMIT $2`,
    [chatId, limit]
  );
  return rows;
}

export async function getAllRemindersForRange(startDate: string, endDate: string): Promise<Reminder[]> {
  const { rows } = await pool.query<Reminder>(
    `SELECT * FROM reminders
     WHERE scheduled_at >= $1 AND scheduled_at < $2
     ORDER BY scheduled_at ASC`,
    [startDate, endDate]
  );
  return rows;
}
