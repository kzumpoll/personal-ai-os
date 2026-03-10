import { addDays, parseISO } from 'date-fns';
import pool, { Task, logDbError } from '@/lib/db';
import { getLocalToday } from '@/lib/date';
import TaskBoard from '@/components/TaskBoard';
import PageHeader from '@/components/PageHeader';

const emptyBoard = { overdue: [] as Task[], today: [] as Task[], tomorrow: [] as Task[], next7: [] as Task[], future: [] as Task[] };

async function getBoard() {
  // Use getLocalToday() (USER_TZ-aware) so buckets use Bali local date, not UTC.
  // Plain new Date() on Vercel returns UTC, causing tasks to appear in wrong bucket
  // across midnight (e.g. March 10 tasks staying in "Today" when it is already March 11).
  const today = getLocalToday();
  const tomorrow = addDays(parseISO(today + 'T12:00:00'), 1).toISOString().slice(0, 10);
  const next7End = addDays(parseISO(today + 'T12:00:00'), 7).toISOString().slice(0, 10);

  console.log(`[getBoard] query params  today=${today}  tomorrow=${tomorrow}  next7End=${next7End}`);

  try {
    const { rows } = await pool.query<Task & { bucket: string }>(
      `SELECT *,
         CASE
           WHEN due_date < $1 THEN 'overdue'
           WHEN due_date = $1 THEN 'today'
           WHEN due_date = $2 THEN 'tomorrow'
           WHEN due_date <= $3 THEN 'next7'
           ELSE 'future'
         END as bucket
       FROM tasks
       WHERE status = 'todo'
       ORDER BY due_date ASC NULLS LAST`,
      [today, tomorrow, next7End]
    );
    console.log(
      `[getBoard] ${rows.length} tasks returned: ` +
      rows.map((r) => `${r.id.slice(0, 8)} due=${JSON.stringify(r.due_date)} bucket=${r.bucket}`).join(' | ')
    );
    return {
      overdue:  rows.filter((r) => r.bucket === 'overdue'),
      today:    rows.filter((r) => r.bucket === 'today'),
      tomorrow: rows.filter((r) => r.bucket === 'tomorrow'),
      next7:    rows.filter((r) => r.bucket === 'next7'),
      future:   rows.filter((r) => r.bucket === 'future'),
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
  const tomorrowStr = addDays(parseISO(todayStr + 'T12:00:00'), 1).toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle={`${total} open`}
        badge={overdueCount > 0 ? `${overdueCount} overdue` : undefined}
        badgeColor="red"
      />
      <TaskBoard board={board} todayStr={todayStr} tomorrowStr={tomorrowStr} />
    </div>
  );
}
