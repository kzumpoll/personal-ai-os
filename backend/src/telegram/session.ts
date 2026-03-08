import { Intent, CaptureType } from '../ai/intents';

// ---------------------------------------------------------------------------
// Task list reference — tracks the last numbered list shown per chat so that
// positional references ("mark 6 done") resolve against the correct list.
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
    };

const sessions = new Map<number, SessionState>();

export function getSession(chatId: number): SessionState {
  return sessions.get(chatId) ?? { state: 'idle' };
}

export function setSession(chatId: number, session: SessionState): void {
  sessions.set(chatId, session);
}

export function clearSession(chatId: number): void {
  sessions.set(chatId, { state: 'idle' });
}
