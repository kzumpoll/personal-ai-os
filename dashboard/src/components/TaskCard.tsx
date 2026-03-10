'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Task } from '@/lib/db';
import MoveTaskDate from './MoveTaskDate';

type Bucket = 'overdue' | 'today' | 'tomorrow' | 'next7' | 'future' | 'done';

const bucketAccent: Record<Bucket, string> = {
  overdue:  'var(--red)',
  today:    'var(--amber)',
  tomorrow: 'var(--green)',
  next7:    'var(--blue)',
  future:   'var(--text-faint)',
  done:     'var(--text-faint)',
};

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  const parts = s.split('-').map(Number);
  if (parts.length !== 3) return s;
  const [, m, day] = parts;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${String(day).padStart(2, '0')}`;
}

interface Props {
  task: Task;
  bucket: Bucket;
}

export default function TaskCard({ task, bucket }: Props) {
  const router = useRouter();
  const accent = bucketAccent[bucket];
  const initialDone = bucket === 'done';
  const [done, setDone] = useState(initialDone);
  const [loading, setLoading] = useState(false);

  async function toggleDone() {
    if (loading) return;
    const newStatus = done ? 'todo' : 'done';
    setDone(!done);
    setLoading(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, status: newStatus }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh(); // bust ISR cache so re-render reflects DB state
    } catch {
      setDone(done); // revert on error
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="rounded-md p-3 flex flex-col gap-1 transition-all"
      style={{
        background: done ? 'transparent' : 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: `2px solid ${accent}`,
        opacity: done ? 0.45 : 1,
      }}
    >
      <div className="flex items-start gap-2">
        <button
          onClick={toggleDone}
          disabled={loading}
          className="shrink-0 rounded-full flex items-center justify-center transition-all"
          style={{
            width: 14,
            height: 14,
            marginTop: 2,
            border: `1.5px solid ${done ? accent : 'var(--border)'}`,
            background: done ? accent : 'transparent',
            cursor: loading ? 'wait' : 'pointer',
            padding: 0,
          }}
          aria-label={done ? 'Mark incomplete' : 'Mark done'}
        >
          {done && (
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path d="M1.5 4L3.2 5.7L6.5 2.5" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <span
          className="text-sm leading-snug flex-1"
          style={{
            color: done ? 'var(--text-muted)' : 'var(--text)',
            textDecoration: done ? 'line-through' : 'none',
            fontWeight: 500,
          }}
        >
          {task.title}
        </span>
        {!done && (
          <MoveTaskDate
            taskId={task.id}
            currentDue={task.due_date ? String(task.due_date).slice(0, 10) : null}
          />
        )}
      </div>
      {task.notes && (
        <p className="text-xs pl-[22px] line-clamp-2" style={{ color: 'var(--text-muted)' }}>
          {task.notes}
        </p>
      )}
      {task.due_date && (
        <p
          className="pl-[22px]"
          style={{
            fontFamily: "var(--font-mono)",
            color: 'var(--text-faint)',
            fontSize: '10px',
          }}
        >
          {fmtDate(task.due_date)}
        </p>
      )}
    </div>
  );
}
