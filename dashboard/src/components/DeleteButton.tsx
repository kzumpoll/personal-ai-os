'use client';

import { useState } from 'react';

interface Props {
  id: string;
  endpoint: string; // e.g. '/api/ideas' or '/api/thoughts'
}

export default function DeleteButton({ id, endpoint }: Props) {
  const [confirm, setConfirm] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [loading, setLoading] = useState(false);

  if (deleted) return null;

  async function handleDelete() {
    setLoading(true);
    try {
      const res = await fetch(`${endpoint}/${id}`, { method: 'DELETE' });
      if (res.ok) setDeleted(true);
    } catch {
      // silent fail
    } finally {
      setLoading(false);
      setConfirm(false);
    }
  }

  if (confirm) {
    return (
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleDelete}
          disabled={loading}
          className="text-xs px-2 py-0.5 rounded"
          style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--red)', cursor: 'pointer' }}
        >
          {loading ? '…' : 'Delete'}
        </button>
        <button
          onClick={() => setConfirm(false)}
          className="text-xs"
          style={{ color: 'var(--text-faint)', cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
      style={{ color: 'var(--text-faint)', cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: '0 2px' }}
      aria-label="Delete"
    >
      ×
    </button>
  );
}
