'use client';

import { useState, useEffect } from 'react';

interface Status {
  status: 'idle' | 'running' | 'waiting_for_permission';
  current_task: string | null;
  permission_request: string | null;
  updated_at: string | null;
}

const STATUS_CONFIG = {
  idle:                    { color: 'var(--green)',  label: 'idle' },
  running:                 { color: 'var(--blue)',   label: 'running' },
  waiting_for_permission:  { color: 'var(--amber)',  label: 'permission' },
} as const;

export default function ClaudeCodeIndicator() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let mounted = true;

    async function poll() {
      try {
        const res = await fetch('/api/claude-status', { cache: 'no-store' });
        if (res.ok && mounted) {
          const data = await res.json() as Status;
          setStatus(data);
        }
      } catch {
        // silent — indicator disappears if unreachable
      }
    }

    poll();
    const interval = setInterval(poll, 15_000); // poll every 15s
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  if (!status) return null;

  const cfg = STATUS_CONFIG[status.status] ?? STATUS_CONFIG.idle;

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded"
      title={status.current_task ?? status.permission_request ?? `Claude Code: ${status.status}`}
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <span
        className="rounded-full shrink-0"
        style={{
          width: 6,
          height: 6,
          background: cfg.color,
          boxShadow: status.status !== 'idle' ? `0 0 6px ${cfg.color}` : 'none',
        }}
      />
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '9px',
          letterSpacing: '0.1em',
          color: 'var(--text-faint)',
          textTransform: 'uppercase',
        }}
      >
        {cfg.label}
      </span>
    </div>
  );
}
