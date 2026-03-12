import { addDays, parseISO, format } from 'date-fns';
import pool, { Task, logDbError } from '@/lib/db';
import { getLocalToday } from '@/lib/date';
import TaskBoard from '@/components/TaskBoard';
import PageHeader from '@/components/PageHeader';

export type Bucket = 'overdue' | 'today' | 'tomorrow' | 'day2' | 'next7';

const emptyBoard: Record<Bucket, Task[]> = { overdue: [], today: [], tomorrow: [], day2: [], next7: [] };

async function getBoard() {
  const today = getLocalToday();
  const base = parseISO(today + 'T12:00:00');
  const tomorrow = addDays(base, 1).toISOString().slice(0, 10);
  const day2 = addDays(base, 2).toISOString().slice(0, 10);
  const next7End = addDays(base, 7).toISOString().slice(0, 10);

  try {
    const { rows } = await pool.query<Task & { bucket: string }>(
      `SELECT *,
         CASE
           WHEN due_date < $1 THEN 'overdue'
           WHEN due_date = $1 THEN 'today'
           WHEN due_date = $2 THEN 'tomorrow'
           WHEN due_date = $3 THEN 'day2'
           WHEN due_date <= $4 THEN 'next7'
           ELSE 'next7'
         END as bucket
       FROM tasks
       WHERE status = 'todo'
       ORDER BY due_date ASC NULLS LAST`,
      [today, tomorrow, day2, next7End]
    );
    return {
      overdue:  rows.filter((r) => r.bucket === 'overdue'),
      today:    rows.filter((r) => r.bucket === 'today'),
      tomorrow: rows.filter((r) => r.bucket === 'tomorrow'),
      day2:     rows.filter((r) => r.bucket === 'day2'),
      next7:    rows.filter((r) => r.bucket === 'next7'),
    };
  } catch (err) {
    logDbError('tasks', err);
    return emptyBoard;
  }
}

// force-dynamic: opts out of the Full Route Cache (server-side).
// revalidate = 0: belt-and-suspenders — marks the route as dynamic so Next.js
// never serves a prerendered version.
// Together with staleTimes.dynamic = 0 in next.config.js (which kills the client-side
// Router Cache TTL), router.refresh() now always fetches a genuinely fresh RSC payload.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function TasksPage() {
  const board = await getBoard();
  const total = Object.values(board).reduce((s, arr) => s + arr.length, 0);
  const overdueCount = board.overdue.length;
  const todayStr = getLocalToday();
  const base = parseISO(todayStr + 'T12:00:00');
  const tomorrowStr = addDays(base, 1).toISOString().slice(0, 10);
  const day2Str = addDays(base, 2).toISOString().slice(0, 10);
  const day2Label = format(addDays(base, 2), 'EEEE'); // e.g. "Saturday"

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle={`${total} open`}
        badge={overdueCount > 0 ? `${overdueCount} overdue` : undefined}
        badgeColor="red"
      />
      <TaskBoard board={board} todayStr={todayStr} tomorrowStr={tomorrowStr} day2Str={day2Str} day2Label={day2Label} />
    </div>
  );
}
