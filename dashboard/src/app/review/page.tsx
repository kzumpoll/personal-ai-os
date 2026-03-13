import { format, subDays } from 'date-fns';
import pool, { Win, Goal, logDbError } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import ReviewView from '@/components/ReviewView';

interface Journal {
  id: string;
  entry_date: unknown;
  mit: string | null;
  p1: string | null;
  p2: string | null;
  open_journal: string | null;
}

interface IdeaRow {
  id: string;
  content: string;
  actionability: string | null;
  next_step: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  due_date: string | null;
}

interface Review {
  id: string;
  review_type: string;
  period_start: unknown;
  period_end: unknown;
  content: Record<string, unknown>;
}

interface ReviewSchedule {
  id: string;
  review_type: string;
  cadence_days: number;
  last_completed_at: string | null;
  next_due_at: string;
  template: Array<{ question: string; category: string }>;
  enabled: boolean;
}

function fmtDate(d: unknown): string {
  const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  const parts = s.split('-').map(Number);
  if (parts.length !== 3) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parts[1] - 1]} ${String(parts[2]).padStart(2, '0')}`;
}

async function getData() {
  const now = new Date();
  const weekStart = format(subDays(now, 7), 'yyyy-MM-dd');
  const today = format(now, 'yyyy-MM-dd');

  try {
    const [winsRes, goalsRes, journalsRes, checkinsRes, highIdeasRes, overdueRes, schedulesRes] = await Promise.all([
      pool.query<Win>('SELECT * FROM wins WHERE entry_date >= $1 ORDER BY entry_date DESC', [weekStart]),
      pool.query<Goal>(`SELECT * FROM goals WHERE status = 'active' ORDER BY created_at DESC`),
      pool.query<Journal>('SELECT id, entry_date, mit, p1, p2, open_journal FROM journals WHERE entry_date >= $1 ORDER BY entry_date DESC LIMIT 7', [weekStart]),
      pool.query<Review>(`SELECT * FROM reviews WHERE review_type = 'weekly_checkin' ORDER BY period_start DESC LIMIT 10`),
      pool.query<IdeaRow>(`SELECT id, content, actionability, next_step FROM ideas WHERE actionability = 'high' AND status = 'active' ORDER BY created_at DESC LIMIT 8`),
      pool.query<TaskRow>(`SELECT id, title, due_date FROM tasks WHERE status = 'todo' AND due_date < $1 ORDER BY due_date ASC LIMIT 10`, [today]),
      pool.query<ReviewSchedule>(`SELECT * FROM review_schedule WHERE enabled = true ORDER BY next_due_at ASC`),
    ]);

    return {
      wins: winsRes.rows, goals: goalsRes.rows, journals: journalsRes.rows,
      checkins: checkinsRes.rows, highIdeas: highIdeasRes.rows, overdue: overdueRes.rows,
      schedules: schedulesRes.rows, weekStart, today,
    };
  } catch (err) {
    logDbError('review', err);
    return {
      wins: [] as Win[], goals: [] as Goal[], journals: [] as Journal[],
      checkins: [] as Review[], highIdeas: [] as IdeaRow[], overdue: [] as TaskRow[],
      schedules: [] as ReviewSchedule[], weekStart, today,
    };
  }
}

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const data = await getData();
  const dueCount = data.schedules.filter(s => new Date(s.next_due_at) <= new Date()).length;

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Review"
        subtitle={`${fmtDate(data.weekStart)} — ${fmtDate(data.today)}${dueCount > 0 ? ` · ${dueCount} due` : ''}`}
      />
      <ReviewView {...data} />
    </div>
  );
}
