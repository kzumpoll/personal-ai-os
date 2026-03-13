'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, CheckCircle, AlertCircle, ChevronDown, Target } from 'lucide-react';

interface Win { id: string; content: string; entry_date: unknown; }
interface Goal { id: string; title: string; target_date: string | null; }
interface Journal { id: string; entry_date: unknown; mit: string | null; p1: string | null; p2: string | null; open_journal: string | null; }
interface Review { id: string; review_type: string; period_start: unknown; period_end: unknown; content: Record<string, unknown>; }
interface IdeaRow { id: string; content: string; next_step: string | null; }
interface TaskRow { id: string; title: string; due_date: string | null; }
interface ReviewSchedule {
  id: string; review_type: string; cadence_days: number;
  last_completed_at: string | null; next_due_at: string;
  template: Array<{ question: string; category: string }>; enabled: boolean;
}

interface Props {
  wins: Win[]; goals: Goal[]; journals: Journal[]; checkins: Review[];
  highIdeas: IdeaRow[]; overdue: TaskRow[]; schedules: ReviewSchedule[];
  weekStart: string; today: string;
}

function fmtDate(d: unknown): string {
  const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  const parts = s.split('-').map(Number);
  if (parts.length !== 3) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parts[1] - 1]} ${String(parts[2]).padStart(2, '0')}`;
}

function SectionLabel({ children, color = 'var(--text-faint)' }: { children: React.ReactNode; color?: string }) {
  return (
    <p className="mb-3" style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.14em', textTransform: 'uppercase', color }}>
      {children}
    </p>
  );
}

export default function ReviewView({ wins, goals, journals, checkins, highIdeas, overdue, schedules }: Props) {
  const now = new Date();
  const due = schedules.filter(s => new Date(s.next_due_at) <= now);
  const upcoming = schedules.filter(s => new Date(s.next_due_at) > now);

  return (
    <div className="flex flex-col gap-8">
      {/* Due reviews */}
      {due.length > 0 && (
        <section>
          <SectionLabel color="var(--red)">Due Now</SectionLabel>
          <div className="flex flex-col gap-3">
            {due.map(s => <ReviewScheduleCard key={s.id} schedule={s} isDue />)}
          </div>
        </section>
      )}

      {/* Upcoming reviews */}
      {upcoming.length > 0 && (
        <section>
          <SectionLabel color="var(--cyan)">Upcoming Reviews</SectionLabel>
          <div className="flex flex-col gap-2">
            {upcoming.map(s => <ReviewScheduleCard key={s.id} schedule={s} isDue={false} />)}
          </div>
        </section>
      )}

      {/* Weekly check-ins */}
      {checkins.length > 0 && (
        <section>
          <SectionLabel color="var(--violet)">Weekly Check-ins &nbsp;{checkins.length}</SectionLabel>
          <div className="flex flex-col gap-3">
            {checkins.map(r => <CheckinCard key={r.id} review={r} />)}
          </div>
        </section>
      )}

      {/* Active Goals */}
      {goals.length > 0 && (
        <section>
          <SectionLabel color="var(--cyan)">Active Goals &nbsp;{goals.length}</SectionLabel>
          <div className="flex flex-col gap-2">
            {goals.map(g => (
              <div key={g.id} className="flex items-start justify-between gap-3 rounded-lg px-4 py-3"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '2px solid var(--cyan)' }}>
                <p className="text-sm font-medium flex-1" style={{ color: 'var(--text)' }}>{g.title}</p>
                {g.target_date && <span className="text-xs shrink-0" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}>{fmtDate(g.target_date)}</span>}
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
            {wins.map(w => (
              <div key={w.id} className="flex items-center gap-3 rounded-lg px-4 py-2.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--green)' }} />
                <span className="text-sm flex-1" style={{ color: 'var(--text)' }}>{w.content}</span>
                <span className="text-xs shrink-0" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}>{fmtDate(w.entry_date)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No wins logged this week.</p>
        )}
      </section>

      {/* Focus this week */}
      {journals.length > 0 && (
        <section>
          <SectionLabel color="var(--blue)">Focus This Week &nbsp;{journals.length} debriefs</SectionLabel>
          <div className="flex flex-col gap-2">
            {journals.map(j => (
              <div key={j.id} className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <p className="text-xs mb-2" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}>{fmtDate(j.entry_date)}</p>
                <div className="flex flex-col gap-1">
                  {j.mit && <p className="text-sm" style={{ color: 'var(--text)' }}><span style={{ color: 'var(--cyan)', fontWeight: 600, fontFamily: "var(--font-mono)", fontSize: '10px' }}>MIT</span> {j.mit}</p>}
                  {j.p1 && <p className="text-sm" style={{ color: 'var(--text-muted)' }}><span style={{ fontWeight: 600, fontFamily: "var(--font-mono)", fontSize: '10px', color: 'var(--blue)' }}>P1</span> {j.p1}</p>}
                  {j.p2 && <p className="text-sm" style={{ color: 'var(--text-muted)' }}><span style={{ fontWeight: 600, fontFamily: "var(--font-mono)", fontSize: '10px', color: 'var(--violet)' }}>P2</span> {j.p2}</p>}
                  {j.open_journal && <p className="text-xs mt-1 pt-2" style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>{j.open_journal}</p>}
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
            {highIdeas.map(idea => (
              <div key={idea.id} className="rounded-lg px-4 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <p className="text-sm" style={{ color: 'var(--text)' }}>{idea.content}</p>
                {idea.next_step && (
                  <div className="mt-1.5 flex items-start gap-1.5">
                    <span className="text-xs shrink-0" style={{ color: 'var(--cyan)', fontFamily: "var(--font-mono)" }}>-&gt;</span>
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
            {overdue.map(t => (
              <div key={t.id} className="flex items-center gap-3 rounded-lg px-4 py-2.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--red)' }} />
                <span className="text-sm flex-1" style={{ color: 'var(--text)' }}>{t.title}</span>
                {t.due_date && <span className="text-xs shrink-0" style={{ color: 'var(--red)', fontFamily: "var(--font-mono)" }}>{fmtDate(t.due_date)}</span>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ReviewScheduleCard({ schedule, isDue }: { schedule: ReviewSchedule; isDue: boolean }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  const daysUntil = Math.ceil((new Date(schedule.next_due_at).getTime() - Date.now()) / 86400000);
  const color = isDue ? 'var(--red)' : 'var(--cyan)';

  async function complete() {
    setSaving(true);
    try {
      await fetch('/api/review-schedule/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: schedule.id, answers }),
      });
      router.refresh();
    } catch { /* swallow */ }
    finally { setSaving(false); }
  }

  return (
    <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: `1px solid ${isDue ? 'var(--red)' : 'var(--border)'}` }}>
      <div className="flex items-center gap-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        {isDue ? <AlertCircle size={14} style={{ color, flexShrink: 0 }} /> : <Clock size={14} style={{ color, flexShrink: 0 }} />}
        <span className="text-sm font-medium capitalize flex-1" style={{ color: 'var(--text)' }}>{schedule.review_type} Review</span>
        <span className="text-xs" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}>
          {isDue ? 'Due now' : `in ${daysUntil}d`}
        </span>
        {schedule.last_completed_at && (
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
            last: {fmtDate(schedule.last_completed_at)}
          </span>
        )}
        <ChevronDown size={12} style={{ color: 'var(--text-faint)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </div>

      {expanded && (
        <div className="mt-3 pt-3 flex flex-col gap-3" style={{ borderTop: '1px solid var(--border)' }}>
          {schedule.template.map((q, i) => (
            <div key={i}>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>
                <span className="capitalize px-1 py-0.5 rounded mr-1" style={{ background: 'var(--surface-3)', fontSize: '9px', color: 'var(--text-faint)' }}>{q.category}</span>
                {q.question}
              </label>
              <textarea
                value={answers[i] ?? ''}
                onChange={e => setAnswers({ ...answers, [i]: e.target.value })}
                rows={2}
                className="w-full text-xs px-2 py-1.5 rounded"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', resize: 'vertical' }}
              />
            </div>
          ))}
          <button
            onClick={complete} disabled={saving}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded self-end"
            style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--green)', cursor: 'pointer' }}
          >
            <CheckCircle size={12} />
            {saving ? 'Saving...' : 'Complete Review'}
          </button>
        </div>
      )}
    </div>
  );
}

function CheckinCard({ review }: { review: Review }) {
  const c = review.content;
  const weekLabel = typeof c.week_label === 'string' ? c.week_label : `${fmtDate(review.period_start)} – ${fmtDate(review.period_end)}`;

  const rows: { label: string; value: string | null; color: string }[] = [
    { label: 'Feeling', value: typeof c.overall_feeling === 'string' ? c.overall_feeling : null, color: 'var(--green)' },
    { label: 'Goals', value: typeof c.goals_progress === 'string' ? c.goals_progress : null, color: 'var(--cyan)' },
    { label: 'Blocker', value: typeof c.biggest_blocker === 'string' ? c.biggest_blocker : null, color: 'var(--red)' },
    { label: 'Next week', value: typeof c.next_week_priorities === 'string' ? c.next_week_priorities : null, color: 'var(--violet)' },
  ];

  return (
    <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: 'var(--violet)', background: 'rgba(139,92,246,0.12)' }}>weekly check-in</span>
        <span className="text-xs" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}>{weekLabel}</span>
      </div>
      <div className="flex flex-col gap-2">
        {rows.filter(r => r.value).map(r => (
          <div key={r.label} className="flex items-start gap-2">
            <span className="text-xs shrink-0 pt-0.5" style={{ color: r.color, fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', minWidth: 60 }}>{r.label}</span>
            <p className="text-sm leading-snug" style={{ color: 'var(--text)' }}>{r.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
