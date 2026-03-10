'use client';

import { useState } from 'react';
import DeleteButton from './DeleteButton';

interface Idea {
  id: string;
  content: string;
  actionability: string | null;
  next_step: string | null;
  linked_project_id: string | null;
  linked_task_id: string | null;
  status: string;
  created_at: string;
}

interface Props {
  ideas: Idea[];
}

function fmtDate(d: string): string {
  const s = String(d).slice(0, 10);
  const parts = s.split('-').map(Number);
  if (parts.length !== 3) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parts[1] - 1]} ${String(parts[2]).padStart(2, '0')}`;
}

function preview(content: string): { text: string; truncated: boolean } {
  const firstLine = content.split('\n')[0].trim();
  if (firstLine.length <= 100) return { text: firstLine, truncated: firstLine !== content.trim() };
  return { text: firstLine.slice(0, 100) + '…', truncated: true };
}

// ── Status config ──────────────────────────────────────────────────────────────

type StatusKey = 'active' | 'inbox' | 'later' | 'archived';

const STATUS_ORDER: StatusKey[] = ['active', 'inbox', 'later', 'archived'];

const STATUS_CONFIG: Record<StatusKey, { label: string; color: string; bg: string }> = {
  active:   { label: 'Active',    color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  inbox:    { label: 'Inbox',     color: '#94a3b8', bg: 'rgba(148,163,184,0.1)'  },
  later:    { label: 'Later',     color: '#f59e0b', bg: 'rgba(245,158,11,0.12)'  },
  archived: { label: 'Archived',  color: '#64748b', bg: 'rgba(100,116,139,0.1)'  },
};

function normaliseStatus(raw: string | null | undefined): StatusKey {
  const s = (raw ?? '').toLowerCase();
  if (s === 'active') return 'active';
  if (s === 'later') return 'later';
  if (s === 'done' || s === 'archived' || s === 'completed') return 'archived';
  return 'inbox'; // null / 'inbox' / unrecognised → Inbox
}

// ── Actionability config ───────────────────────────────────────────────────────

const ACTION_CONFIG: Record<string, { color: string; bg: string; order: number }> = {
  high:   { color: '#10b981', bg: 'rgba(16,185,129,0.12)', order: 0 },
  medium: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  order: 1 },
  low:    { color: '#64748b', bg: 'rgba(100,116,139,0.1)',  order: 2 },
};

function actionOrder(a: string | null): number {
  return ACTION_CONFIG[a?.toLowerCase() ?? '']?.order ?? 3;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function IdeasTable({ ideas }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // IDs where the inline "turn into task" form is open
  const [forming, setForming] = useState<Set<string>>(new Set());
  // IDs where a task was successfully created this session
  const [taskCreated, setTaskCreated] = useState<Set<string>>(
    new Set(ideas.filter((i) => i.linked_task_id).map((i) => i.id))
  );
  const [formTitle, setFormTitle] = useState<Record<string, string>>({});
  const [formDue, setFormDue] = useState<Record<string, string>>({});
  const [formLoading, setFormLoading] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openForm(idea: Idea) {
    const title = idea.content.split('\n')[0].trim().slice(0, 200);
    setFormTitle((prev) => ({ ...prev, [idea.id]: title }));
    setFormDue((prev) => ({ ...prev, [idea.id]: '' }));
    setForming((prev) => new Set(prev).add(idea.id));
  }

  function closeForm(id: string) {
    setForming((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }

  async function submitForm(ideaId: string) {
    const title = formTitle[ideaId]?.trim();
    if (!title) return;
    setFormLoading((prev) => new Set(prev).add(ideaId));
    try {
      const res = await fetch(`/api/ideas/${ideaId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, due_date: formDue[ideaId] || null }),
      });
      if (!res.ok) throw new Error('Failed');
      setTaskCreated((prev) => new Set(prev).add(ideaId));
      closeForm(ideaId);
    } catch {
      // silent fail — form stays open so user can retry
    } finally {
      setFormLoading((prev) => { const n = new Set(prev); n.delete(ideaId); return n; });
    }
  }

  // Group and sort
  const groups = STATUS_ORDER.map((statusKey) => {
    const items = ideas
      .filter((i) => normaliseStatus(i.status) === statusKey)
      .sort((a, b) => {
        const od = actionOrder(a.actionability) - actionOrder(b.actionability);
        if (od !== 0) return od;
        return b.created_at.localeCompare(a.created_at);
      });
    return { statusKey, cfg: STATUS_CONFIG[statusKey], items };
  }).filter((g) => g.items.length > 0);

  if (groups.length === 0) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No ideas yet.</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.map(({ statusKey, cfg, items }) => (
        <div key={statusKey}>
          {/* Group header */}
          <div className="flex items-center gap-2 mb-2">
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ color: cfg.color, background: cfg.bg }}
            >
              {cfg.label}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: '10px',
                color: 'var(--text-faint)',
              }}
            >
              {items.length}
            </span>
          </div>

          {/* Table */}
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {/* Column header */}
            <div
              className="grid px-4 py-2"
              style={{
                gridTemplateColumns: '1fr 64px 56px 20px 20px',
                gap: '12px',
                background: 'var(--surface)',
                borderBottom: '1px solid var(--border)',
                fontFamily: "var(--font-mono)",
                fontSize: '9px',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--text-faint)',
              }}
            >
              <span>Idea</span>
              <span>Potential</span>
              <span style={{ textAlign: 'right' }}>Date</span>
              <span />
              <span />
            </div>

            {items.map((idea, i) => {
              const { text, truncated } = preview(idea.content);
              const isExpanded = expanded.has(idea.id);
              const canExpand = truncated || idea.content.includes('\n');
              const actionKey = idea.actionability?.toLowerCase() ?? '';
              const actionCfg = ACTION_CONFIG[actionKey] ?? null;
              const isForming = forming.has(idea.id);
              const isConverted = taskCreated.has(idea.id);
              const isLoading = formLoading.has(idea.id);

              return (
                <div
                  key={idea.id}
                  className="group px-4 py-2.5"
                  style={{
                    borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                    background: i % 2 === 0 ? 'var(--bg)' : 'var(--surface)',
                    cursor: canExpand ? 'pointer' : 'default',
                  }}
                  onClick={() => canExpand && toggle(idea.id)}
                >
                  {/* Main row */}
                  <div
                    className="grid items-start"
                    style={{ gridTemplateColumns: '1fr 64px 56px 20px 20px', gap: '12px' }}
                  >
                    <p className="text-sm leading-snug" style={{ color: 'var(--text)' }}>
                      {isExpanded ? idea.content : text}
                    </p>

                    <div style={{ lineHeight: '20px' }}>
                      {actionCfg ? (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded-full capitalize font-medium"
                          style={{ color: actionCfg.color, background: actionCfg.bg }}
                        >
                          {idea.actionability}
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>—</span>
                      )}
                    </div>

                    <p
                      className="text-xs text-right shrink-0"
                      style={{
                        color: 'var(--text-faint)',
                        fontFamily: "var(--font-mono)",
                        lineHeight: '20px',
                      }}
                    >
                      {fmtDate(idea.created_at)}
                    </p>

                    {/* Turn into task button */}
                    <div onClick={(e) => e.stopPropagation()}>
                      {!isConverted && (
                        <button
                          onClick={() => isForming ? closeForm(idea.id) : openForm(idea)}
                          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{
                            color: isForming ? 'var(--cyan)' : 'var(--text-faint)',
                            cursor: 'pointer',
                            fontSize: '14px',
                            lineHeight: 1,
                            padding: '0 2px',
                          }}
                          aria-label="Turn into task"
                          title="Turn into task"
                        >
                          ↗
                        </button>
                      )}
                    </div>

                    <div onClick={(e) => e.stopPropagation()}>
                      <DeleteButton id={idea.id} endpoint="/api/ideas" />
                    </div>
                  </div>

                  {/* Inline "turn into task" form */}
                  {isForming && (
                    <div
                      className="mt-2 flex flex-col gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div
                        className="rounded-lg p-3 flex flex-col gap-2"
                        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
                      >
                        <input
                          type="text"
                          value={formTitle[idea.id] ?? ''}
                          onChange={(e) => setFormTitle((prev) => ({ ...prev, [idea.id]: e.target.value }))}
                          placeholder="Task title"
                          className="w-full text-sm rounded px-2 py-1"
                          style={{
                            background: 'var(--bg)',
                            border: '1px solid var(--border)',
                            color: 'var(--text)',
                            outline: 'none',
                          }}
                          autoFocus
                        />
                        <input
                          type="date"
                          value={formDue[idea.id] ?? ''}
                          onChange={(e) => setFormDue((prev) => ({ ...prev, [idea.id]: e.target.value }))}
                          className="text-sm rounded px-2 py-1"
                          style={{
                            background: 'var(--bg)',
                            border: '1px solid var(--border)',
                            color: 'var(--text)',
                            outline: 'none',
                            colorScheme: 'dark',
                          }}
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => submitForm(idea.id)}
                            disabled={isLoading || !formTitle[idea.id]?.trim()}
                            className="text-xs px-3 py-1 rounded"
                            style={{
                              background: 'rgba(16,185,129,0.15)',
                              color: 'var(--green)',
                              cursor: isLoading ? 'default' : 'pointer',
                              opacity: !formTitle[idea.id]?.trim() ? 0.5 : 1,
                            }}
                          >
                            {isLoading ? '…' : 'Create task'}
                          </button>
                          <button
                            onClick={() => closeForm(idea.id)}
                            className="text-xs"
                            style={{ color: 'var(--text-faint)', cursor: 'pointer' }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Next step sub-row */}
                  {idea.next_step && (
                    <div className="mt-1.5 flex items-start gap-1.5">
                      <span
                        className="text-xs shrink-0 mt-0.5"
                        style={{ color: 'var(--cyan)', fontFamily: "var(--font-mono)" }}
                      >
                        →
                      </span>
                      <p className="text-xs leading-snug" style={{ color: 'var(--text-muted)' }}>
                        {idea.next_step}
                      </p>
                    </div>
                  )}

                  {/* Badges */}
                  <div className="mt-1.5 flex items-center gap-2">
                    {isConverted && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ color: 'var(--green)', background: 'rgba(16,185,129,0.12)' }}
                      >
                        turned into task
                      </span>
                    )}
                    {idea.linked_project_id && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ color: 'var(--violet)', background: 'rgba(139,92,246,0.12)' }}
                      >
                        promoted to project
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
