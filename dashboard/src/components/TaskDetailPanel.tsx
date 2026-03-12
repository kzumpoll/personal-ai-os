'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { Task } from '@/lib/db';

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  const parts = s.split('-').map(Number);
  if (parts.length !== 3) return s;
  const [, m, day] = parts;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${String(day).padStart(2, '0')}`;
}

function fmtDateTime(d: string | null): string {
  if (!d) return '—';
  try {
    const dt = new Date(d);
    return dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return String(d).slice(0, 16); }
}

interface Props {
  task: Task;
  onClose: () => void;
}

export default function TaskDetailPanel({ task, onClose }: Props) {
  const router = useRouter();
  const [description, setDescription] = useState(task.description ?? '');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDescription(task.description ?? '');
    setDirty(false);
  }, [task.id, task.description]);

  async function saveDescription() {
    if (!dirty) return;
    setSaving(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, description: description.trim() }),
      });
      if (res.ok) {
        setDirty(false);
        router.refresh();
      }
    } catch { /* silent */ }
    finally { setSaving(false); }
  }

  return (
    <div
      className="fixed top-0 right-0 h-full flex flex-col"
      style={{
        width: 400,
        maxWidth: '100vw',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
        zIndex: 50,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.3)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Task Detail
        </span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
        {/* Title */}
        <div>
          <label style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>
            Title
          </label>
          <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{task.title}</p>
        </div>

        {/* Due date */}
        <div>
          <label style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>
            Due Date
          </label>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{fmtDate(task.due_date)}</p>
        </div>

        {/* Status */}
        <div>
          <label style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>
            Status
          </label>
          <span
            className="text-xs px-2 py-0.5 rounded-full capitalize"
            style={{
              color: task.status === 'done' ? 'var(--green)' : 'var(--amber)',
              background: task.status === 'done' ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
            }}
          >
            {task.status}
          </span>
        </div>

        {/* Description (editable) */}
        <div className="flex-1 flex flex-col">
          <label style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => { setDescription(e.target.value); setDirty(true); }}
            onBlur={saveDescription}
            placeholder="Add a description..."
            rows={6}
            style={{
              flex: 1,
              minHeight: 120,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '8px 10px',
              color: 'var(--text)',
              fontSize: 13,
              outline: 'none',
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
          {dirty && (
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={saveDescription}
                disabled={saving}
                className="text-xs px-3 py-1 rounded"
                style={{ background: 'rgba(6,182,212,0.15)', color: 'var(--cyan)', cursor: saving ? 'default' : 'pointer' }}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => { setDescription(task.description ?? ''); setDirty(false); }}
                className="text-xs"
                style={{ color: 'var(--text-faint)', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Last updated */}
        <div>
          <label style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>
            Last Updated
          </label>
          <p className="text-xs" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}>
            {fmtDateTime(task.updated_at)}
          </p>
        </div>
      </div>
    </div>
  );
}
