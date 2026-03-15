'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import ManifestationsView from './ManifestationsView';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Goal {
  id: string;
  title: string;
  description: string | null;
  status: string;
  target_date: string | null;
  quarter: string | null;
  created_at: string;
}

interface Manifestation {
  id: string;
  category: string;
  vision: string;
  why: string | null;
  timeframe: string | null;
  status: string;
  evidence: string | null;
  manifested_at: string | null;
  created_at: string;
}

interface Props {
  identity: Record<string, string>;
  goals: Goal[];
  manifestations: Manifestation[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function SectionLabel({ children, color = 'var(--text-muted)' }: { children: React.ReactNode; color?: string }) {
  return (
    <p className="mb-2" style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color }}>
      {children}
    </p>
  );
}

const QUARTER_COLORS: Record<string, string> = {
  Q1: 'var(--cyan)', Q2: 'var(--green)', Q3: 'var(--amber)', Q4: 'var(--violet)',
};
const QUARTER_END: Record<string, string> = {
  Q1: 'Mar 31', Q2: 'Jun 30', Q3: 'Sep 30', Q4: 'Dec 31',
};

function quarterColor(quarter: string) {
  return QUARTER_COLORS[quarter.split('-')[1] ?? ''] ?? 'var(--text-muted)';
}
function quarterEndLabel(quarter: string) {
  const [year, q] = quarter.split('-');
  const end = QUARTER_END[q];
  return end ? `ends ${end} ${year}` : '';
}
function inferQuarter(g: Goal): string {
  if (g.quarter) return g.quarter;
  if (g.target_date) {
    const d = new Date(String(g.target_date).slice(0, 10) + 'T12:00:00');
    return `${d.getFullYear()}-Q${Math.ceil((d.getMonth() + 1) / 3)}`;
  }
  const now = new Date();
  return `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;
}

// ── IdentitySection ───────────────────────────────────────────────────────────

const IDENTITY_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'identity',  label: 'Who I am',        placeholder: 'I am…' },
  { key: 'values',    label: 'Values',           placeholder: 'I value…' },
  { key: 'mission',   label: 'Mission',          placeholder: 'My mission is…' },
  { key: 'how_i_live',label: 'How I live',       placeholder: 'I live by…' },
  { key: 'standards', label: 'Standards',        placeholder: 'I hold myself to…' },
  { key: 'freedom',   label: 'What freedom means', placeholder: 'Freedom to me is…' },
  { key: 'reminder',  label: 'Daily reminder',   placeholder: 'Remember…' },
];

function IdentitySection({ initial }: { initial: Record<string, string> }) {
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved,  setSaved]  = useState<Record<string, boolean>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const save = useCallback(async (key: string, content: string) => {
    setSaving(prev => ({ ...prev, [key]: true }));
    try {
      await fetch('/api/life-identity', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, content }),
      });
      setSaved(prev => ({ ...prev, [key]: true }));
      setTimeout(() => setSaved(prev => ({ ...prev, [key]: false })), 1500);
    } catch { /* silent */ }
    finally { setSaving(prev => ({ ...prev, [key]: false })); }
  }, []);

  function handleChange(key: string, content: string) {
    setValues(prev => ({ ...prev, [key]: content }));
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => save(key, content), 1000);
  }

  return (
    <div className="flex flex-col gap-5">
      {IDENTITY_FIELDS.map(({ key, label, placeholder }) => (
        <div key={key}>
          <div className="flex items-center justify-between mb-1.5">
            <SectionLabel>{label}</SectionLabel>
            {saving[key] && <span className="text-xs" style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>saving…</span>}
            {saved[key]  && <span className="text-xs" style={{ color: 'var(--green)',      fontFamily: 'var(--font-mono)' }}>saved</span>}
          </div>
          <textarea
            value={values[key] ?? ''}
            onChange={e => handleChange(key, e.target.value)}
            placeholder={placeholder}
            rows={3}
            className="w-full text-sm px-3 py-2 rounded-lg resize-none"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              outline: 'none',
              fontFamily: 'inherit',
              lineHeight: 1.6,
            }}
          />
        </div>
      ))}
    </div>
  );
}

// ── GoalsSection ──────────────────────────────────────────────────────────────

function GoalRow({ goal: initial }: { goal: Goal }) {
  const [goal, setGoal]     = useState(initial);
  const [editing, setEdit]  = useState(false);
  const [title, setTitle]   = useState(initial.title);
  const [desc, setDesc]     = useState(initial.description ?? '');
  const [status, setStatus] = useState(initial.status);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/goals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: goal.id, title, description: desc || null, status }),
      });
      if (res.ok) {
        const d = await res.json() as { goal: Goal };
        setGoal(d.goal); setEdit(false);
      }
    } catch { /* silent */ }
    finally { setSaving(false); }
  }

  const color = goal.status === 'active' ? 'var(--violet)' : 'var(--border)';

  if (editing) {
    return (
      <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: `1px solid ${color}`, borderLeft: `2px solid ${color}` }}>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="text-sm font-medium w-full mb-2 px-0 bg-transparent outline-none"
          style={{ color: 'var(--text)', borderBottom: '1px solid var(--border)' }}
        />
        <textarea
          value={desc}
          onChange={e => setDesc(e.target.value)}
          placeholder="Description (optional)"
          rows={2}
          className="text-xs w-full mb-3 px-0 bg-transparent outline-none resize-none"
          style={{ color: 'var(--text-muted)', fontFamily: 'inherit' }}
        />
        <div className="flex items-center gap-2">
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="text-xs px-2 py-1 rounded"
            style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)' }}>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </select>
          <button onClick={save} disabled={saving}
            className="text-xs px-2.5 py-1 rounded"
            style={{ background: 'rgba(139,92,246,0.15)', color: 'var(--violet)', cursor: 'pointer' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setEdit(false)}
            className="text-xs px-2 py-1 rounded"
            style={{ color: 'var(--text-faint)', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg p-4 cursor-pointer group"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `2px solid ${color}` }}
      onClick={() => setEdit(true)}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{goal.title}</p>
        <div className="flex items-center gap-2 shrink-0">
          {goal.target_date && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-faint)' }}>
              {String(goal.target_date).slice(0, 10)}
            </span>
          )}
          <span className="text-xs opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: 'var(--text-faint)' }}>edit</span>
        </div>
      </div>
      {goal.description && (
        <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>{goal.description}</p>
      )}
    </div>
  );
}

function GoalsSection({ goals }: { goals: Goal[] }) {
  const active   = goals.filter(g => g.status === 'active');
  const archived = goals.filter(g => g.status !== 'active');

  const now = new Date();
  const currentQuarter = `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;

  const byQuarter = new Map<string, Goal[]>();
  for (const g of active) {
    const q = inferQuarter(g);
    if (!byQuarter.has(q)) byQuarter.set(q, []);
    byQuarter.get(q)!.push(g);
  }
  const quarters = Array.from(byQuarter.keys()).sort((a, b) => a.localeCompare(b));

  return (
    <div>
      {active.length === 0 && (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--text-faint)' }}>No active goals. Add one via Telegram.</p>
      )}

      {quarters.map(quarter => {
        const qGoals  = byQuarter.get(quarter)!;
        const isCur   = quarter === currentQuarter;
        const [, q]   = quarter.split('-');
        return (
          <div key={quarter} className="mb-8">
            <div className="flex items-center gap-3 mb-3">
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: quarterColor(quarter), fontWeight: 600 }}>
                {q} — {quarterEndLabel(quarter)}
              </span>
              {isCur && (
                <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(6,182,212,0.12)', color: 'var(--cyan)', fontFamily: 'var(--font-mono)', fontSize: '9px' }}>
                  current
                </span>
              )}
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-faint)' }}>{qGoals.length}</span>
            </div>
            <div className="flex flex-col gap-3">
              {qGoals.map(g => <GoalRow key={g.id} goal={g} />)}
            </div>
          </div>
        );
      })}

      {archived.length > 0 && (
        <div className="mt-6 opacity-50">
          <div className="flex items-center gap-3 mb-3">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600 }}>Archived</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>
          <div className="flex flex-col gap-3">
            {archived.map(g => <GoalRow key={g.id} goal={g} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function LifeOSView({ identity, goals, manifestations }: Props) {
  return (
    <div className="flex flex-col gap-10 max-w-6xl mx-auto">
      {/* Top: 2-column — Identity left, Visionboard right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        <div>
          <p className="mb-5" style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600 }}>
            Identity
          </p>
          <IdentitySection initial={identity} />
        </div>
        <div>
          <p className="mb-5" style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600 }}>
            Visionboard
          </p>
          <ManifestationsView manifestations={manifestations} />
        </div>
      </div>

      {/* Goals full width below */}
      <div>
        <p className="mb-5" style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 600 }}>
          Goals
        </p>
        <GoalsSection goals={goals} />
      </div>
    </div>
  );
}
