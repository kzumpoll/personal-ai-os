import { format, subDays } from 'date-fns';
import pool, { Win, Goal, logDbError } from '@/lib/db';
import PageHeader from '@/components/PageHeader';

interface Journal {
  id: string;
  entry_date: unknown;
  mit: string | null;
  k1: string | null;
  k2: string | null;
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

function toDateStr(d: unknown): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function fmtDate(d: unknown): string {
  const s = toDateStr(d);
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
    const [winsRes, goalsRes, journalsRes, reviewsRes, highIdeasRes, overdueRes] = await Promise.all([
      pool.query<Win>(
        'SELECT * FROM wins WHERE entry_date >= $1 ORDER BY entry_date DESC',
        [weekStart]
      ),
      pool.query<Goal>(`SELECT * FROM goals WHERE status = 'active' ORDER BY created_at DESC`),
      pool.query<Journal>(
        'SELECT id, entry_date, mit, k1, k2, open_journal FROM journals WHERE entry_date >= $1 ORDER BY entry_date DESC LIMIT 7',
        [weekStart]
      ),
      pool.query<Review>('SELECT * FROM reviews ORDER BY period_start DESC LIMIT 5'),
      pool.query<IdeaRow>(
        `SELECT id, content, actionability, next_step FROM ideas WHERE actionability = 'high' AND status = 'active' ORDER BY created_at DESC LIMIT 8`
      ),
      pool.query<TaskRow>(
        `SELECT id, title, due_date FROM tasks WHERE status = 'todo' AND due_date < $1 ORDER BY due_date ASC LIMIT 10`,
        [today]
      ),
    ]);

    return {
      wins: winsRes.rows,
      goals: goalsRes.rows,
      journals: journalsRes.rows,
      reviews: reviewsRes.rows,
      highIdeas: highIdeasRes.rows,
      overdue: overdueRes.rows,
      weekStart,
      today,
    };
  } catch (err) {
    logDbError('review', err);
    return {
      wins: [] as Win[],
      goals: [] as Goal[],
      journals: [] as Journal[],
      reviews: [] as Review[],
      highIdeas: [] as IdeaRow[],
      overdue: [] as TaskRow[],
      weekStart,
      today,
    };
  }
}

function SectionLabel({ children, color = 'var(--text-faint)' }: { children: React.ReactNode; color?: string }) {
  return (
    <p
      className="mb-3"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: '9px',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color,
      }}
    >
      {children}
    </p>
  );
}

export const revalidate = 30;

export default async function ReviewPage() {
  const { wins, goals, journals, reviews, highIdeas, overdue, weekStart, today } = await getData();
  const hasData = goals.length > 0 || wins.length > 0 || journals.length > 0;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Weekly Review"
        subtitle={`${fmtDate(weekStart)} — ${fmtDate(today)}`}
      />

      <div className="flex flex-col gap-8">
        {/* Active Goals */}
        {goals.length > 0 && (
          <section>
            <SectionLabel color="var(--cyan)">Active Goals &nbsp;{goals.length}</SectionLabel>
            <div className="flex flex-col gap-2">
              {goals.map((g) => (
                <div
                  key={g.id}
                  className="flex items-start justify-between gap-3 rounded-lg px-4 py-3"
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderLeft: '2px solid var(--cyan)',
                  }}
                >
                  <p className="text-sm font-medium flex-1" style={{ color: 'var(--text)' }}>{g.title}</p>
                  {g.target_date && (
                    <span
                      className="text-xs shrink-0"
                      style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}
                    >
                      {fmtDate(g.target_date)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Wins this week */}
        <section>
          <SectionLabel color="var(--green)">Wins This Week &nbsp;{wins.length}</SectionLabel>
          {wins.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {wins.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center gap-3 rounded-lg px-4 py-2.5"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--green)' }} />
                  <span className="text-sm flex-1" style={{ color: 'var(--text)' }}>{w.content}</span>
                  <span
                    className="text-xs shrink-0"
                    style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}
                  >
                    {fmtDate(w.entry_date)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
              No wins logged this week. Add one in Telegram: &quot;win: shipped X&quot;
            </p>
          )}
        </section>

        {/* Focus this week — from journals */}
        {journals.length > 0 && (
          <section>
            <SectionLabel color="var(--blue)">Focus This Week &nbsp;{journals.length} debriefs</SectionLabel>
            <div className="flex flex-col gap-2">
              {journals.map((j) => (
                <div
                  key={j.id}
                  className="rounded-lg p-4"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <p
                    className="text-xs mb-2"
                    style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}
                  >
                    {fmtDate(j.entry_date)}
                  </p>
                  <div className="flex flex-col gap-1">
                    {j.mit && (
                      <p className="text-sm" style={{ color: 'var(--text)' }}>
                        <span
                          style={{
                            color: 'var(--cyan)',
                            fontWeight: 600,
                            fontFamily: "var(--font-mono)",
                            fontSize: '10px',
                          }}
                        >
                          MIT
                        </span>{' '}
                        {j.mit}
                      </p>
                    )}
                    {j.k1 && (
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        <span
                          style={{
                            fontWeight: 600,
                            fontFamily: "var(--font-mono)",
                            fontSize: '10px',
                            color: 'var(--blue)',
                          }}
                        >
                          K1
                        </span>{' '}
                        {j.k1}
                      </p>
                    )}
                    {j.k2 && (
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        <span
                          style={{
                            fontWeight: 600,
                            fontFamily: "var(--font-mono)",
                            fontSize: '10px',
                            color: 'var(--violet)',
                          }}
                        >
                          K2
                        </span>{' '}
                        {j.k2}
                      </p>
                    )}
                    {j.open_journal && (
                      <p
                        className="text-xs mt-1 pt-2"
                        style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}
                      >
                        {j.open_journal}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* High-actionability ideas */}
        {highIdeas.length > 0 && (
          <section>
            <SectionLabel color="var(--amber)">Ideas to Action &nbsp;{highIdeas.length}</SectionLabel>
            <div className="flex flex-col gap-2">
              {highIdeas.map((idea) => (
                <div
                  key={idea.id}
                  className="rounded-lg px-4 py-3"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <p className="text-sm" style={{ color: 'var(--text)' }}>{idea.content}</p>
                  {idea.next_step && (
                    <div className="mt-1.5 flex items-start gap-1.5">
                      <span
                        className="text-xs shrink-0"
                        style={{ color: 'var(--cyan)', fontFamily: "var(--font-mono)" }}
                      >
                        →
                      </span>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{idea.next_step}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Overdue tasks */}
        {overdue.length > 0 && (
          <section>
            <SectionLabel color="var(--red)">Overdue Tasks &nbsp;{overdue.length}</SectionLabel>
            <div className="flex flex-col gap-1.5">
              {overdue.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-3 rounded-lg px-4 py-2.5"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--red)' }} />
                  <span className="text-sm flex-1" style={{ color: 'var(--text)' }}>{t.title}</span>
                  {t.due_date && (
                    <span
                      className="text-xs shrink-0"
                      style={{ color: 'var(--red)', fontFamily: "var(--font-mono)" }}
                    >
                      {fmtDate(t.due_date)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Saved reviews */}
        {reviews.length > 0 && (
          <section>
            <SectionLabel color="var(--violet)">Saved Reviews &nbsp;{reviews.length}</SectionLabel>
            <div className="flex flex-col gap-2">
              {reviews.map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg px-4 py-3"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className="text-xs capitalize px-2 py-0.5 rounded-full"
                      style={{ color: 'var(--violet)', background: 'rgba(139,92,246,0.12)', fontWeight: 500 }}
                    >
                      {r.review_type}
                    </span>
                    <span
                      className="text-xs"
                      style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}
                    >
                      {fmtDate(r.period_start)} – {fmtDate(r.period_end)}
                    </span>
                  </div>
                  {typeof r.content === 'object' &&
                    r.content !== null &&
                    'summary' in r.content &&
                    r.content.summary ? (
                    <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
                      {String(r.content.summary)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        )}

        {!hasData && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No review data yet. Run your daily debrief in Telegram to start building your weekly review history.
          </p>
        )}
      </div>
    </div>
  );
}
