'use client';

import { useState, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import { Plus, X } from 'lucide-react';

export default function TaskQuickAdd() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), due_date: dueDate }),
      });
      setTitle('');
      setOpen(false);
      // Reload to show new task
      window.location.reload();
    } finally {
      setSaving(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors"
        style={{
          background: 'var(--cyan)',
          color: '#fff',
          border: 'none',
          fontSize: '13px',
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        <Plus size={14} strokeWidth={2.5} />
        New task
      </button>
    );
  }

  return (
    <div
      className="flex items-center gap-2 p-2 rounded-lg"
      style={{ background: 'var(--surface)', border: '1px solid var(--cyan)' }}
    >
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKey}
        placeholder="Task title..."
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'var(--text)',
          fontSize: '13px',
          fontWeight: 500,
        }}
      />
      <input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        style={{
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          color: 'var(--text-muted)',
          fontSize: '12px',
          padding: '2px 6px',
          cursor: 'pointer',
        }}
      />
      <button
        onClick={submit}
        disabled={saving || !title.trim()}
        style={{
          background: 'var(--cyan)',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          padding: '4px 10px',
          fontSize: '12px',
          fontWeight: 500,
          cursor: 'pointer',
          opacity: saving || !title.trim() ? 0.5 : 1,
        }}
      >
        Add
      </button>
      <button
        onClick={() => setOpen(false)}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
