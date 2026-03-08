import pool from '../client';

export interface ScheduleBlock {
  time: string;         // HH:MM
  title: string;
  type: 'event' | 'mit' | 'k1' | 'k2' | 'task' | 'break' | 'free' | 'wake' | 'work_start';
  duration_min: number;
}

export interface DayPlan {
  id: string;
  plan_date: string;
  wake_time: string | null;
  work_start: string | null;
  schedule: ScheduleBlock[];
  overflow: string[];
  created_at: string;
  updated_at: string;
}

export async function upsertDayPlan(data: {
  plan_date: string;
  wake_time?: string;
  work_start?: string;
  schedule: ScheduleBlock[];
  overflow: string[];
}): Promise<DayPlan> {
  const { rows } = await pool.query(
    `INSERT INTO day_plans (plan_date, wake_time, work_start, schedule, overflow)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
     ON CONFLICT (plan_date) DO UPDATE SET
       wake_time = EXCLUDED.wake_time,
       work_start = EXCLUDED.work_start,
       schedule = EXCLUDED.schedule,
       overflow = EXCLUDED.overflow,
       updated_at = NOW()
     RETURNING *`,
    [
      data.plan_date,
      data.wake_time ?? null,
      data.work_start ?? null,
      JSON.stringify(data.schedule),
      JSON.stringify(data.overflow),
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
