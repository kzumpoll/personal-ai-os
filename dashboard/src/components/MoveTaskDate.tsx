'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { format, addDays } from 'date-fns';
import { CalendarDays } from 'lucide-react';

interface Props {
  taskId: string;
  currentDue: string | null;
}

export default function MoveTaskDate({ taskId, currentDue }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const today = format(new Date(), 'yyyy-MM-dd');
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');

  const move = async (date: string) => {
    setSaving(true);
    setOpen(false);
    console.log('[MoveTaskDate] PATCH payload', { id: taskId, due_date: date });
    try {
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, due_date: date }),
      });
      const data = await res.json().catch(() => null);
      console.log('[MoveTaskDate] PATCH response', res.status, data);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
      router.refresh();
    } catch (err) {
      console.error('[MoveTaskDate] move failed', err);
    } finally {
      setSaving(false);
    }
  };

  const quickOptions = [
    { label: 'Today',     date: today },
    { label: 'Tomorrow',  date: tomorrow },
    { label: '+2 days',   date: format(addDays(new Date(), 2), 'yyyy-MM-dd') },
    { label: '+1 week',   date: format(addDays(new Date(), 7), 'yyyy-MM-dd') },
  ].filter((o) => o.date !== currentDue);

  return (
    <div className="relative" style={{ display: 'inline-block' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Move to date"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: saving ? 'wait' : 'pointer',
          color: 'var(--text-faint)',
          padding: '1px 2px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <CalendarDays size={12} strokeWidth={1.5} />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              zIndex: 50,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '6px',
              minWidth: 120,
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
              marginTop: 4,
            }}
          >
            {quickOptions.map((o) => (
              <button
                key={o.date}
                onClick={() => move(o.date)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '5px 8px',
                  borderRadius: 4,
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                  fontWeight: 500,
                }}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'var(--surface-3)'; (e.target as HTMLElement).style.color = 'var(--text)'; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; (e.target as HTMLElement).style.color = 'var(--text-muted)'; }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
