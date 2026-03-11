import { format, addDays, parseISO } from 'date-fns';
import pool, { Task, Journal, Goal, logDbError } from '@/lib/db';
import { getEventsForDate, CalendarEvent, formatEventTime } from '@/lib/calendar';
import { getLocalToday } from '@/lib/date';
import TaskCard from '@/components/TaskCard';
import PageHeader from '@/components/PageHeader';
import DayNav from '@/components/DayNav';

interface ScheduleBlock {
  time: string;
  title: string;
  type: string;
  duration_min: number;
}

interface DayPlan {
  id: string;
  plan_date: string;
  wake_time: string | null;
  work_start: string | null;
  schedule: ScheduleBlock[];
  overflow: string[];
  mit_done: boolean;
  p1_done: boolean;
  p2_done: boolean;
  planned_mit: string | null;
  planned_p1: string | null;
  planned_p2: string | null;
  mit_start_action: string | null;
  p1_start_action: string | null;
  p2_start_action: string | null;
}

async function getData(dateParam?: string) {
  // Use timezone-aware today (fixes UTC vs user timezone mismatch on Vercel)
  const today = dateParam ?? getLocalToday();
  const baseDate = parseISO(today + 'T12:00:00');
  const tomorrow = format(addDays(baseDate, 1), 'yyyy-MM-dd');
  const empty = {
    journal: null, overdue: [] as Task[], today: [] as Task[],
    tomorrow: [] as Task[], completed: [] as Task[], todayStr: today,
    calendarEvents: [] as CalendarEvent[], dayPlan: null as DayPlan | null,
    goals: [] as Goal[],
  };

  try {
    const [journalRes, overdueRes, todayRes, tomorrowRes, completedRes, dayPlanRes, calendarEvents, goalsRes] = await Promise.all([
      pool.query<Journal>('SELECT * FROM journals WHERE entry_date = $1', [today]),
      pool.query<Task>(
        `SELECT * FROM tasks WHERE status = 'todo' AND due_date < $1 ORDER BY due_date ASC LIMIT 20`,
        [today]
      ),
      pool.query<Task>(
        `SELECT * FROM tasks WHERE status = 'todo' AND due_date = $1 ORDER BY created_at ASC`,
        [today]
      ),
      pool.query<Task>(
        `SELECT * FROM tasks WHERE status = 'todo' AND due_date = $1 ORDER BY created_at ASC`,
        [tomorrow]
      ),
      pool.query<Task>(
        `SELECT * FROM tasks WHERE status = 'done' AND completed_at::date = $1 ORDER BY completed_at DESC`,
        [today]
      ),
      pool.query<DayPlan>('SELECT * FROM day_plans WHERE plan_date = $1', [today]),
      getEventsForDate(today),
      pool.query<Goal>(`SELECT * FROM goals WHERE status = 'active' ORDER BY created_at DESC LIMIT 5`),
    ]);

    return {
      journal: journalRes.rows[0] ?? null,
      overdue: overdueRes.rows,
      today: todayRes.rows,
      tomorrow: tomorrowRes.rows,
      completed: completedRes.rows,
      todayStr: today,
      calendarEvents,
      dayPlan: dayPlanRes.rows[0] ?? null,
      goals: goalsRes.rows,
    };
  } catch (err) {
    logDbError('today', err);
    return empty;
  }
}

// force-dynamic: fresh data on every request.
// Required so that: (a) MIT/K1/K2 completion state reflects Telegram updates immediately,
// and (b) date navigation via searchParams re-renders the RSC with correct data —
// ISR caching causes the server component to serve stale payloads on navigation.
export const dynamic = 'force-dynamic';

/** Returns "Today", "Yesterday", "Tomorrow", or weekday name for dates further out. */
function getDayLabel(realToday: string, viewDate: string): string {
  if (viewDate === realToday) return 'Today';
  const todayMs = new Date(realToday + 'T12:00:00').getTime();
  const viewMs  = new Date(viewDate  + 'T12:00:00').getTime();
  const diff = Math.round((viewMs - todayMs) / 86_400_000);
  if (diff === -1) return 'Yesterday';
  if (diff === 1)  return 'Tomorrow';
  return format(parseISO(viewDate + 'T12:00:00'), 'EEEE');
}

/** Infers a calendar icon from event title via keyword matching. */
function getEventIcon(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('padel') || t.includes('tennis') || t.includes('squash')) return '🎾';
  if (
    t.includes('lunch') || t.includes('dinner') || t.includes('brunch') ||
    t.includes('restaurant') || t.includes('nook') || t.includes('cafe') ||
    t.includes('coffee') || t.includes('food') || t.includes('eat')
  ) return '🍽️';
  if (
    t.includes('flight') || t.includes('airport') || t.includes('travel') ||
    t.includes('drive') || t.includes('uber') || t.includes('taxi')
  ) return '🚗';
  if (
    t.includes('date') || t.includes('jofinne') || t.includes('anniversary')
  ) return '❤️';
  if (
    t.includes('standup') || t.includes('meeting') || t.includes('sync') ||
    t.includes('call') || t.includes('interview') || t.includes('review')
  ) return '📋';
  return '📅';
}

function SectionLabel({ children, color = 'var(--text-muted)' }: { children: React.ReactNode; color?: string }) {
  return (
    <p
      className="mb-3"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: '10px',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color,
      }}
    >
      {children}
    </p>
  );
}

const typeColors: Record<string, string> = {
  mit: 'var(--cyan)',
  p1: 'var(--blue)',
  p2: 'var(--violet)',
  event: 'var(--green)',
  task: 'var(--text-muted)',
  wake: 'var(--amber)',
  work_start: 'var(--text-faint)',
  break: 'var(--text-faint)',
};

export default async function TodayPage({ searchParams }: { searchParams: { date?: string } }) {
  const dateParam = searchParams.date;
  const { journal, overdue, today, tomorrow, completed, todayStr, calendarEvents, dayPlan, goals } = await getData(dateParam);
  const todayDate = parseISO(todayStr + 'T12:00:00');
  const dateLabel = format(todayDate, 'MMMM d, yyyy');
  const realToday = getLocalToday();
  const isToday = todayStr === realToday;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <PageHeader
          title={getDayLabel(realToday, todayStr)}
          subtitle={dateLabel}
        />
        <div className="mt-1 shrink-0">
          <DayNav currentDate={todayStr} />
        </div>
      </div>

      {/* Focus block — MIT / K1 / K2 */}
      {journal ? (
        <section
          className="mb-8 rounded-lg p-5"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderLeft: '3px solid var(--cyan)',
          }}
        >
          <SectionLabel color="var(--cyan)">Focus</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {journal.mit && (
              <div>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.14em', color: 'var(--cyan)', marginBottom: 6 }}>
                  MIT {dayPlan?.mit_done && '✅'}
                </p>
                <p className="text-sm font-medium" style={{ color: dayPlan?.mit_done ? 'var(--text-muted)' : 'var(--text)', textDecoration: dayPlan?.mit_done ? 'line-through' : 'none' }}>
                  {journal.mit}
                </p>
                {dayPlan?.mit_start_action && !dayPlan.mit_done && (
                  <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>
                    Start: <span style={{ color: 'var(--text-muted)' }}>{dayPlan.mit_start_action}</span>
                  </p>
                )}
              </div>
            )}
            {journal.p1 && (
              <div>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.14em', color: 'var(--blue)', marginBottom: 6 }}>
                  P1 {dayPlan?.p1_done && '✅'}
                </p>
                <p className="text-sm" style={{ color: dayPlan?.p1_done ? 'var(--text-muted)' : 'var(--text-dim)', textDecoration: dayPlan?.p1_done ? 'line-through' : 'none' }}>
                  {journal.p1}
                </p>
                {dayPlan?.p1_start_action && !dayPlan.p1_done && (
                  <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>
                    Start: <span style={{ color: 'var(--text-muted)' }}>{dayPlan.p1_start_action}</span>
                  </p>
                )}
              </div>
            )}
            {journal.p2 && (
              <div>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.14em', color: 'var(--violet)', marginBottom: 6 }}>
                  P2 {dayPlan?.p2_done && '✅'}
                </p>
                <p className="text-sm" style={{ color: dayPlan?.p2_done ? 'var(--text-muted)' : 'var(--text-dim)', textDecoration: dayPlan?.p2_done ? 'line-through' : 'none' }}>
                  {journal.p2}
                </p>
                {dayPlan?.p2_start_action && !dayPlan.p2_done && (
                  <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>
                    Start: <span style={{ color: 'var(--text-muted)' }}>{dayPlan.p2_start_action}</span>
                  </p>
                )}
              </div>
            )}
          </div>
          {journal.open_journal && (
            <p
              className="mt-4 text-sm pt-4"
              style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}
            >
              {journal.open_journal}
            </p>
          )}
        </section>
      ) : (
        <div
          className="mb-8 rounded-lg p-5"
          style={{ border: '1px dashed var(--border)' }}
        >
          {/* Show planned priorities from day_plan if they exist (useful for tomorrow view) */}
          {(dayPlan?.planned_mit || dayPlan?.planned_p1 || dayPlan?.planned_p2) ? (
            <>
              <SectionLabel color="var(--cyan)">Planned Focus</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-3">
                {dayPlan.planned_mit && (
                  <div>
                    <p style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.14em', color: 'var(--cyan)', marginBottom: 6 }}>MIT</p>
                    <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{dayPlan.planned_mit}</p>
                  </div>
                )}
                {dayPlan.planned_p1 && (
                  <div>
                    <p style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.14em', color: 'var(--blue)', marginBottom: 6 }}>P1</p>
                    <p className="text-sm" style={{ color: 'var(--text-dim)' }}>{dayPlan.planned_p1}</p>
                  </div>
                )}
                {dayPlan.planned_p2 && (
                  <div>
                    <p style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.14em', color: 'var(--violet)', marginBottom: 6 }}>P2</p>
                    <p className="text-sm" style={{ color: 'var(--text-dim)' }}>{dayPlan.planned_p2}</p>
                  </div>
                )}
              </div>
              <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                Day debrief for this date has not been completed yet.
              </p>
            </>
          ) : (
            <p className="text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              No debrief for {isToday ? 'today' : todayStr}.{' '}
              {isToday && (
                <span style={{ color: 'var(--text-dim)' }}>
                  Run <strong>daily debrief</strong> in Telegram.
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {/* Calendar events */}
      {calendarEvents.length > 0 && (
        <section className="mb-8">
          <SectionLabel color="var(--green)">Calendar &nbsp;{calendarEvents.length}</SectionLabel>
          <div className="flex flex-col gap-1.5">
            {calendarEvents.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-3 rounded-lg px-4 py-2.5"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <span
                  className="text-xs shrink-0"
                  style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)", minWidth: 40 }}
                >
                  {e.allDay ? 'all day' : formatEventTime(e.start)}
                </span>
                <span className="shrink-0 text-sm">{getEventIcon(e.title)}</span>
                <span className="text-sm font-medium flex-1 truncate" style={{ color: 'var(--text)' }}>{e.title}</span>
                {e.location && (
                  <span className="text-xs truncate shrink-0" style={{ color: 'var(--text-faint)', maxWidth: 120 }}>{e.location}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Day plan agenda timeline */}
      {dayPlan && dayPlan.schedule.length > 0 && (
        <section className="mb-8">
          <SectionLabel color="var(--cyan)">
            Day Plan{dayPlan.wake_time ? ` — wake ${dayPlan.wake_time}` : ''}
          </SectionLabel>
          <div className="flex flex-col gap-1">
            {dayPlan.schedule
              .filter((b) => b.type !== 'work_start' || b.duration_min > 0 || true)
              .map((block, i) => {
                const done =
                  (block.type === 'mit' && dayPlan.mit_done) ||
                  (block.type === 'p1'  && dayPlan.p1_done)  ||
                  (block.type === 'p2'  && dayPlan.p2_done);
                const color = done ? 'var(--green)' : (typeColors[block.type] ?? 'var(--text-muted)');
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span
                      className="text-xs shrink-0"
                      style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)", minWidth: 40 }}
                    >
                      {block.time}
                    </span>
                    {done
                      ? <span className="text-xs shrink-0">✅</span>
                      : <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                    }
                    <span
                      className="text-sm flex-1 truncate"
                      style={{ color: done ? 'var(--text-muted)' : 'var(--text)', textDecoration: done ? 'line-through' : 'none' }}
                    >
                      {block.title}
                    </span>
                    {block.duration_min > 0 && (
                      <span className="text-xs shrink-0" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}>
                        {block.duration_min}m
                      </span>
                    )}
                  </div>
                );
              })}
          </div>
          {dayPlan.overflow.length > 0 && (
            <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
              <p className="text-xs mb-1.5" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}>
                OVERFLOW
              </p>
              {dayPlan.overflow.map((t, i) => (
                <p key={i} className="text-sm" style={{ color: 'var(--text-muted)' }}>• {t}</p>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {overdue.length > 0 && isToday && (
          <section>
            <SectionLabel color="var(--red)">Overdue &nbsp;{overdue.length}</SectionLabel>
            <div className="flex flex-col gap-2">
              {overdue.map((t) => <TaskCard key={t.id} task={t} bucket="overdue" />)}
            </div>
          </section>
        )}

        <section>
          <SectionLabel color="var(--amber)">{isToday ? 'Today' : format(todayDate, 'MMM d')} &nbsp;{today.length}</SectionLabel>
          <div className="flex flex-col gap-2">
            {today.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-faint)' }}>Nothing scheduled.</p>
            ) : (
              today.map((t) => <TaskCard key={t.id} task={t} bucket="today" />)
            )}
          </div>
        </section>

        <section>
          <SectionLabel color="var(--green)">{format(addDays(todayDate, 1), 'MMM d')} &nbsp;{tomorrow.length}</SectionLabel>
          <div className="flex flex-col gap-2">
            {tomorrow.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-faint)' }}>Nothing scheduled.</p>
            ) : (
              tomorrow.map((t) => <TaskCard key={t.id} task={t} bucket="tomorrow" />)
            )}
          </div>
        </section>

        {completed.length > 0 && (
          <section>
            <SectionLabel>Done &nbsp;{completed.length}</SectionLabel>
            <div className="flex flex-col gap-2">
              {completed.map((t) => <TaskCard key={t.id} task={t} bucket="done" />)}
            </div>
          </section>
        )}
      </div>

      {/* Active goals — alignment block at bottom */}
      {goals.length > 0 && (
        <section className="mt-8 pt-6" style={{ borderTop: '1px solid var(--border)' }}>
          <SectionLabel color="var(--violet)">Active Goals &nbsp;{goals.length}</SectionLabel>
          <div className="flex flex-col gap-2">
            {goals.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between gap-3 rounded-lg px-4 py-2.5"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <p className="text-sm flex-1" style={{ color: 'var(--text-muted)' }}>{g.title}</p>
                {g.target_date && (
                  <span
                    className="text-xs shrink-0"
                    style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}
                  >
                    {g.target_date.toString().slice(0, 10)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
