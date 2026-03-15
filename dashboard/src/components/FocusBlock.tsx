'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Journal {
  mit: string | null;
  p1: string | null;
  p2: string | null;
  open_journal: string | null;
}

interface DayPlan {
  id: string;
  plan_date: string;
  mit_done: boolean;
  p1_done: boolean;
  p2_done: boolean;
  mit_start_action: string | null;
  p1_start_action: string | null;
  p2_start_action: string | null;
}

interface Props {
  journal: Journal;
  dayPlan: DayPlan | null;
  todayStr: string;
  isToday: boolean;
}

function SectionLabel({ children, color = 'var(--text-muted)' }: { children: React.ReactNode; color?: string }) {
  return (
    <p
      className="mb-3"
      style={{
        fontFamily: 'var(--font-mono)',
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

export default function FocusBlock({ journal, dayPlan, todayStr }: Props) {
  const router = useRouter();
  const [mitDone, setMitDone] = useState(dayPlan?.mit_done ?? false);
  const [p1Done,  setP1Done]  = useState(dayPlan?.p1_done  ?? false);
  const [p2Done,  setP2Done]  = useState(dayPlan?.p2_done  ?? false);

  async function toggle(field: 'mit_done' | 'p1_done' | 'p2_done', current: boolean) {
    if (!dayPlan) return;
    const next = !current;
    // Optimistic update
    if (field === 'mit_done') setMitDone(next);
    if (field === 'p1_done')  setP1Done(next);
    if (field === 'p2_done')  setP2Done(next);

    try {
      await fetch('/api/day-plans/focus', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_date: todayStr, field, done: next }),
      });
      router.refresh();
    } catch {
      // Revert on failure
      if (field === 'mit_done') setMitDone(current);
      if (field === 'p1_done')  setP1Done(current);
      if (field === 'p2_done')  setP2Done(current);
    }
  }

  return (
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
            <div className="flex items-center gap-2 mb-1.5">
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.14em', color: 'var(--cyan)' }}>
                MIT
              </p>
              {dayPlan && (
                <button
                  onClick={() => toggle('mit_done', mitDone)}
                  style={{
                    background: mitDone ? 'var(--cyan)' : 'transparent',
                    border: `1px solid ${mitDone ? 'var(--cyan)' : 'var(--border)'}`,
                    borderRadius: 4,
                    width: 16,
                    height: 16,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    flexShrink: 0,
                  }}
                  title={mitDone ? 'Mark incomplete' : 'Mark done'}
                >
                  {mitDone && <span style={{ fontSize: 10, color: '#fff', lineHeight: 1 }}>✓</span>}
                </button>
              )}
            </div>
            <p className="text-sm font-medium" style={{ color: mitDone ? 'var(--text-muted)' : 'var(--text)', textDecoration: mitDone ? 'line-through' : 'none' }}>
              {journal.mit}
            </p>
            {dayPlan?.mit_start_action && !mitDone && (
              <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>
                Start: <span style={{ color: 'var(--text-muted)' }}>{dayPlan.mit_start_action}</span>
              </p>
            )}
          </div>
        )}
        {journal.p1 && (
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.14em', color: 'var(--blue)' }}>
                P1
              </p>
              {dayPlan && (
                <button
                  onClick={() => toggle('p1_done', p1Done)}
                  style={{
                    background: p1Done ? 'var(--blue)' : 'transparent',
                    border: `1px solid ${p1Done ? 'var(--blue)' : 'var(--border)'}`,
                    borderRadius: 4,
                    width: 16,
                    height: 16,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    flexShrink: 0,
                  }}
                  title={p1Done ? 'Mark incomplete' : 'Mark done'}
                >
                  {p1Done && <span style={{ fontSize: 10, color: '#fff', lineHeight: 1 }}>✓</span>}
                </button>
              )}
            </div>
            <p className="text-sm" style={{ color: p1Done ? 'var(--text-muted)' : 'var(--text-dim)', textDecoration: p1Done ? 'line-through' : 'none' }}>
              {journal.p1}
            </p>
            {dayPlan?.p1_start_action && !p1Done && (
              <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>
                Start: <span style={{ color: 'var(--text-muted)' }}>{dayPlan.p1_start_action}</span>
              </p>
            )}
          </div>
        )}
        {journal.p2 && (
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.14em', color: 'var(--violet)' }}>
                P2
              </p>
              {dayPlan && (
                <button
                  onClick={() => toggle('p2_done', p2Done)}
                  style={{
                    background: p2Done ? 'var(--violet)' : 'transparent',
                    border: `1px solid ${p2Done ? 'var(--violet)' : 'var(--border)'}`,
                    borderRadius: 4,
                    width: 16,
                    height: 16,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    flexShrink: 0,
                  }}
                  title={p2Done ? 'Mark incomplete' : 'Mark done'}
                >
                  {p2Done && <span style={{ fontSize: 10, color: '#fff', lineHeight: 1 }}>✓</span>}
                </button>
              )}
            </div>
            <p className="text-sm" style={{ color: p2Done ? 'var(--text-muted)' : 'var(--text-dim)', textDecoration: p2Done ? 'line-through' : 'none' }}>
              {journal.p2}
            </p>
            {dayPlan?.p2_start_action && !p2Done && (
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
  );
}
