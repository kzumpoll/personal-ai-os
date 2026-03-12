import pool from '../client';

export interface ScheduleBlock {
  time: string;         // HH:MM
  title: string;
  type: 'event' | 'mit' | 'p1' | 'p2' | 'task' | 'break' | 'travel' | 'free' | 'wake' | 'work_start';
  duration_min: number;
}

/** Lightweight record of a calendar event that was removed from a day plan */
export interface IgnoredEventSnapshot {
  id: string;        // Google Calendar event ID
  title: string;
  start: string;     // ISO start string (for display)
  removedAt: string; // ISO timestamp when it was removed
}

export interface DayPlan {
  id: string;
  plan_date: string;
  wake_time: string | null;
  work_start: string | null;
  schedule: ScheduleBlock[];
  overflow: string[];
  /** Exact Google Calendar event IDs to exclude from the day plan */
  ignored_event_ids: string[];
  /** Lightweight snapshots of removed events for traceability */
  ignored_event_snapshots: IgnoredEventSnapshot[];
  /** Pre-planned focus items for the day — can be set before the debrief */
  planned_mit: string | null;
  planned_p1: string | null;
  planned_p2: string | null;
  /** Intra-day completion flags for focus blocks */
  mit_done: boolean;
  p1_done: boolean;
  p2_done: boolean;
  /** 2-minute start actions for focus blocks */
  mit_start_action: string | null;
  p1_start_action: string | null;
  p2_start_action: string | null;
  created_at: string;
  updated_at: string;
}

export async function upsertDayPlan(data: {
  plan_date: string;
  wake_time?: string;
  work_start?: string;
  schedule: ScheduleBlock[];
  overflow: string[];
  ignored_event_ids?: string[];
  ignored_event_snapshots?: IgnoredEventSnapshot[];
}): Promise<DayPlan> {
  const { rows } = await pool.query(
    `INSERT INTO day_plans (plan_date, wake_time, work_start, schedule, overflow, ignored_event_ids, ignored_event_snapshots)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::jsonb)
     ON CONFLICT (plan_date) DO UPDATE SET
       wake_time = EXCLUDED.wake_time,
       work_start = EXCLUDED.work_start,
       schedule = EXCLUDED.schedule,
       overflow = EXCLUDED.overflow,
       ignored_event_ids = EXCLUDED.ignored_event_ids,
       ignored_event_snapshots = EXCLUDED.ignored_event_snapshots,
       planned_mit = COALESCE(day_plans.planned_mit, EXCLUDED.planned_mit),
       planned_p1  = COALESCE(day_plans.planned_p1,  EXCLUDED.planned_p1),
       planned_p2  = COALESCE(day_plans.planned_p2,  EXCLUDED.planned_p2),
       mit_done    = day_plans.mit_done,
       p1_done     = day_plans.p1_done,
       p2_done     = day_plans.p2_done,
       updated_at = NOW()
     RETURNING *`,
    [
      data.plan_date,
      data.wake_time ?? null,
      data.work_start ?? null,
      JSON.stringify(data.schedule),
      JSON.stringify(data.overflow),
      data.ignored_event_ids ?? [],
      JSON.stringify(data.ignored_event_snapshots ?? []),
    ]
  );
  return rows[0];
}

export async function getDayPlanByDate(date: string): Promise<DayPlan | null> {
  const { rows } = await pool.query(
    'SELECT * FROM day_plans WHERE plan_date = $1',
    [date]
  );
  return rows[0] ?? null;
}

/**
 * Mark MIT, P1, or P2 as done (or un-done) for a given plan date.
 * Persists across plan regenerations — upsertDayPlan preserves these flags.
 */
export async function setFocusCompletion(
  plan_date: string,
  field: 'mit_done' | 'p1_done' | 'p2_done',
  done: boolean
): Promise<void> {
  await pool.query(
    `UPDATE day_plans SET ${field} = $1, updated_at = NOW() WHERE plan_date = $2`,
    [done, plan_date]
  );
}

export async function setDayPlanIntentions(
  plan_date: string,
  data: {
    planned_mit?: string;
    planned_p1?: string;
    planned_p2?: string;
    mit_start_action?: string;
    p1_start_action?: string;
    p2_start_action?: string;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO day_plans (plan_date, schedule, overflow, planned_mit, planned_p1, planned_p2, mit_start_action, p1_start_action, p2_start_action)
     VALUES ($1, '[]'::jsonb, '[]'::jsonb, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (plan_date) DO UPDATE SET
       planned_mit = COALESCE(EXCLUDED.planned_mit, day_plans.planned_mit),
       planned_p1  = COALESCE(EXCLUDED.planned_p1,  day_plans.planned_p1),
       planned_p2  = COALESCE(EXCLUDED.planned_p2,  day_plans.planned_p2),
       mit_start_action = COALESCE(EXCLUDED.mit_start_action, day_plans.mit_start_action),
       p1_start_action  = COALESCE(EXCLUDED.p1_start_action,  day_plans.p1_start_action),
       p2_start_action  = COALESCE(EXCLUDED.p2_start_action,  day_plans.p2_start_action),
       updated_at  = NOW()`,
    [plan_date, data.planned_mit ?? null, data.planned_p1 ?? null, data.planned_p2 ?? null,
     data.mit_start_action ?? null, data.p1_start_action ?? null, data.p2_start_action ?? null]
  );
}
