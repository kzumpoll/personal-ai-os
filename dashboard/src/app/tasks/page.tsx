import { format, addDays } from 'date-fns';
import pool, { Task, logDbError } from '@/lib/db';
import TaskBoard from '@/components/TaskBoard';
import PageHeader from '@/components/PageHeader';

const emptyBoard = { overdue: [] as Task[], today: [] as Task[], tomorrow: [] as Task[], next7: [] as Task[], future: [] as Task[] };

async function getBoard() {
  // Use Node.js local time (same as the bot) rather than PostgreSQL CURRENT_DATE
  // (which is UTC in Supabase), so buckets match what Telegram shows.
  const now = new Date();
  const today = format(now, 'yyyy-MM-dd');
  const tomorrow = format(addDays(now, 1), 'yyyy-MM-dd');
  const next7End = format(addDays(now, 7), 'yyyy-MM-dd');

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

export const revalidate = 30;

export default async function TasksPage() {
  const board = await getBoard();
  const total = Object.values(board).reduce((s, arr) => s + arr.length, 0);
  const overdueCount = board.overdue.length;
  const now = new Date();
  const todayStr = format(now, 'yyyy-MM-dd');
  const tomorrowStr = format(addDays(now, 1), 'yyyy-MM-dd');

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
