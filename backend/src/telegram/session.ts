import { Intent, CaptureType } from '../ai/intents';
import { CheckinData, WithinProposal } from '../ai/claude';
import { CalendarEvent } from '../services/calendar';
import pool from '../db/client';

// ---------------------------------------------------------------------------
// Task list reference — tracks the last numbered list shown per chat so that
// positional references ("mark 6 done") resolve against the correct list.
// These are ephemeral display state — in-memory only.
// ---------------------------------------------------------------------------

export interface TaskListRef {
  scope: string;       // 'today' | 'all' | 'overdue' | etc.
  taskIds: string[];   // ordered task IDs matching the displayed numbering
}

const taskListRefs = new Map<number, TaskListRef>();

export function setLastTaskList(chatId: number, scope: string, taskIds: string[]): void {
  taskListRefs.set(chatId, { scope, taskIds });
}

export function getLastTaskList(chatId: number): TaskListRef | null {
  return taskListRefs.get(chatId) ?? null;
}

// ---------------------------------------------------------------------------
// Idea list reference — tracks the last numbered idea list shown per chat so
// that positional references ("set next step for idea 2 to X") resolve correctly.
// These are ephemeral display state — in-memory only.
// ---------------------------------------------------------------------------

export interface IdeaListRef {
  ideaIds: string[];   // ordered idea IDs matching the displayed numbering
}

const ideaListRefs = new Map<number, IdeaListRef>();

export function setLastIdeaList(chatId: number, ideaIds: string[]): void {
  ideaListRefs.set(chatId, { ideaIds });
}

export function getLastIdeaList(chatId: number): IdeaListRef | null {
  return ideaListRefs.get(chatId) ?? null;
}

/**
 * Extract the first standalone 1–2 digit number from a message.
 * Used to resolve positional task references like "mark 6 done" → position 6.
 */
export function extractPositionalNumber(text: string): number | null {
  const m = text.match(/\b(\d{1,2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Extract all standalone 1–2 digit numbers from a message.
 * Used for bulk operations like "mark 7,8 done" or "move 1 and 2 to tomorrow".
 * Returns unique numbers in ascending order, capped at 1–50.
 */
export function extractPositionalNumbers(text: string): number[] {
  const matches = text.match(/\b(\d{1,2})\b/g);
  if (!matches) return [];
  return [...new Set(matches.map((n) => parseInt(n, 10)).filter((n) => n >= 1 && n <= 50))].sort(
    (a, b) => a - b
  );
}

// ---------------------------------------------------------------------------
// Entity reference tracking — tracks the last referenced task/event/reminder
// per chat so the LLM can resolve "that one", "yeah that", etc.
// Ephemeral display state — in-memory only, like task/idea list refs.
// ---------------------------------------------------------------------------

export interface EntityRef {
  last_task?: { id: string; title: string } | null;
  last_calendar_event?: { id: string; title: string; start: string } | null;
  last_reminder?: { id: string; title: string; fire_at: string } | null;
}

const entityRefs = new Map<number, EntityRef>();

export function setLastTaskRef(chatId: number, task: { id: string; title: string }): void {
  const ref = entityRefs.get(chatId) ?? {};
  ref.last_task = task;
  entityRefs.set(chatId, ref);
}

export function setLastCalendarEventRef(chatId: number, event: { id: string; title: string; start: string }): void {
  const ref = entityRefs.get(chatId) ?? {};
  ref.last_calendar_event = event;
  entityRefs.set(chatId, ref);
}

export function setLastReminderRef(chatId: number, reminder: { id: string; title: string; fire_at: string }): void {
  const ref = entityRefs.get(chatId) ?? {};
  ref.last_reminder = reminder;
  entityRefs.set(chatId, ref);
}

export function getEntityRefs(chatId: number): EntityRef {
  return entityRefs.get(chatId) ?? {};
}

// ---------------------------------------------------------------------------
// Pending action tracking — stores the last executed action per chat so
// conversational corrections ("no remove that, make it a reminder") work.
// In-memory only — corrections are only valid within the same conversation.
// ---------------------------------------------------------------------------

interface PendingAction {
  intent: Intent;
  result: { success: boolean; message: string; data?: unknown };
}

const pendingActions = new Map<number, PendingAction>();

export function setPendingAction(chatId: number, action: PendingAction): void {
  pendingActions.set(chatId, action);
}

export function getPendingAction(chatId: number): PendingAction | null {
  return pendingActions.get(chatId) ?? null;
}

export function clearPendingAction(chatId: number): void {
  pendingActions.delete(chatId);
}

export type SessionState =
  | { state: 'idle' }
  | {
      state: 'debrief_awaiting_input';
      debriefDate: string;
      planDate: string;
      taskSummary: string;
      tasks: Array<{ id: string; title: string; due_date: string | null }>;
    }
  | {
      state: 'debrief_awaiting_confirmation';
      debriefDate: string;
      planDate: string;
      pendingIntent: Intent;
      // Kept so task names can be shown in correction summaries
      tasks: Array<{ id: string; title: string; due_date: string | null }>;
    }
  | {
      // Awaiting yes/no from user before executing an ambiguous/significant intent
      state: 'pending_confirmation';
      pendingIntent: Intent;
    }
  | {
      // Awaiting yes/no from user before saving a capture_candidate
      state: 'pending_capture';
      captureType: CaptureType;
      captureContent: string;
    }
  | {
      // Multiple calendar events matched "remove X from plan" — waiting for user to pick one
      state: 'pending_remove_event';
      planDate: string;
      candidates: Array<{ id: string; title: string; start: string }>;
    }
  | {
      // User sent a photo without a caption — waiting for the edit prompt
      // NOTE: this state contains a Buffer and is NOT persisted to Postgres
      state: 'image_awaiting_prompt';
      imageBuffer: Buffer;
      imageMimeType: string;
    }
  | {
      // Friday check-in: waiting for freeform reply
      state: 'checkin_awaiting_input';
      weekLabel: string;
      periodStart: string;
      periodEnd: string;
    }
  | {
      // Friday check-in: parsed, showing summary, waiting for yes/correction
      state: 'checkin_awaiting_confirmation';
      weekLabel: string;
      periodStart: string;
      periodEnd: string;
      checkinData: CheckinData;
    }
  | {
      // Within Notion update: proposal shown, waiting for yes/correction/no
      state: 'within_review_awaiting_confirmation';
      proposal: WithinProposal;
      stats: { total: number; overdue: number; due_today: number; due_soon: number };
    }
  | {
      // Calendar: multiple events matched an update/delete — waiting for user to pick one
      state: 'pending_calendar_disambiguation';
      action: 'update' | 'delete';
      pendingIntent: Intent;
      candidates: CalendarEvent[];
    }
  | {
      // Reminder reschedule: waiting for user to send new time
      state: 'reminder_reschedule';
      reminderId: string;
    }
  | {
      // ROI: user wants to set the generated top 3 as MIT/P1/P2
      state: 'roi_set_focus';
    }
  | {
      // Stores the last executed action so corrections like "no remove that, make it a reminder" work
      state: 'pending_action';
      lastAction: {
        intent: Intent;
        result: { success: boolean; message: string; data?: unknown };
      };
    }
  | {
      // After debrief save: propose extracted thoughts from journal, waiting for yes/no/numbers
      state: 'debrief_thought_confirmation';
      pendingThoughts: string[];
    };

// ---------------------------------------------------------------------------
// Session storage — database-backed with in-memory cache
//
// All states except image_awaiting_prompt are persisted to Postgres.
// image_awaiting_prompt contains a Buffer and stays in-memory only.
// Sessions expire after 24 hours (cleaned up on read).
// ---------------------------------------------------------------------------

// States that cannot be persisted (contain non-serializable data like Buffer)
const NON_PERSISTABLE_STATES = new Set(['image_awaiting_prompt']);

// In-memory cache — used for fast reads and for non-persistable states
const memoryCache = new Map<number, SessionState>();

/**
 * Get session state for a chat. Checks in-memory cache first, then Postgres.
 * Returns idle if no session exists or if the session has expired.
 */
export async function getSession(chatId: number): Promise<SessionState> {
  // Check in-memory cache first
  const cached = memoryCache.get(chatId);
  if (cached && cached.state !== 'idle') return cached;

  // Check Postgres
  try {
    const { rows } = await pool.query<{ state: string; data: Record<string, unknown>; expires_at: string }>(
      `SELECT state, data, expires_at FROM chat_sessions WHERE chat_id = $1`,
      [chatId]
    );

    if (rows.length === 0 || rows[0].state === 'idle') return { state: 'idle' };

    // Check expiry
    if (new Date(rows[0].expires_at) < new Date()) {
      console.log('[session] expired session for chat', chatId, '— state was:', rows[0].state);
      await pool.query(`DELETE FROM chat_sessions WHERE chat_id = $1`, [chatId]);
      memoryCache.delete(chatId);
      return { state: 'idle' };
    }

    const session = { state: rows[0].state, ...rows[0].data } as unknown as SessionState;
    memoryCache.set(chatId, session);
    return session;
  } catch (err) {
    console.error('[session] getSession DB error for chat', chatId, ':', err instanceof Error ? err.message : err);
    // Fall back to memory cache or idle
    return cached ?? { state: 'idle' };
  }
}

/**
 * Synchronous version for use in code paths that can't be async.
 * Returns the in-memory cached state only.
 */
export function getSessionSync(chatId: number): SessionState {
  return memoryCache.get(chatId) ?? { state: 'idle' };
}

/**
 * Set session state for a chat. Updates both in-memory cache and Postgres.
 * Non-persistable states (image_awaiting_prompt) are stored in-memory only.
 */
export async function setSession(chatId: number, session: SessionState): Promise<void> {
  memoryCache.set(chatId, session);

  if (NON_PERSISTABLE_STATES.has(session.state)) return;

  const { state, ...data } = session;
  try {
    await pool.query(
      `INSERT INTO chat_sessions (chat_id, state, data, updated_at, expires_at)
       VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '24 hours')
       ON CONFLICT (chat_id)
       DO UPDATE SET state = $2, data = $3, updated_at = NOW(), expires_at = NOW() + INTERVAL '24 hours'`,
      [chatId, state, JSON.stringify(data)]
    );
  } catch (err) {
    console.error('[session] setSession DB error for chat', chatId, ':', err instanceof Error ? err.message : err);
    // In-memory cache is still set, so the session works for this process lifetime
  }
}

/**
 * Clear session state for a chat. Sets to idle in both memory and Postgres.
 */
export async function clearSession(chatId: number): Promise<void> {
  memoryCache.set(chatId, { state: 'idle' });

  try {
    await pool.query(`DELETE FROM chat_sessions WHERE chat_id = $1`, [chatId]);
  } catch (err) {
    console.error('[session] clearSession DB error for chat', chatId, ':', err instanceof Error ? err.message : err);
  }
}

/**
 * Clean up expired sessions. Called periodically or at startup.
 */
export async function cleanupExpiredSessions(): Promise<number> {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM chat_sessions WHERE expires_at < NOW()`
    );
    return rowCount ?? 0;
  } catch (err) {
    console.error('[session] cleanup error:', err instanceof Error ? err.message : err);
    return 0;
  }
}
