'use client';

import { useState, useEffect } from 'react';

interface Status {
  status: 'idle' | 'running' | 'waiting_for_permission';
  current_task: string | null;
  permission_request: string | null;
  updated_at: string | null;
}

const STATUS_CONFIG = {
  idle:                    { color: 'var(--green)',      label: 'idle' },
  running:                 { color: 'var(--blue)',       label: 'running' },
  waiting_for_permission:  { color: 'var(--amber)',      label: 'permission' },
  unknown:                 { color: 'var(--text-faint)', label: 'unknown' },
} as const;

export default function ClaudeCodeIndicator() {
  const [status, setStatus] = useState<Status | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function poll() {
      try {
        const res = await fetch('/api/claude-status', { cache: 'no-store' });
        if (!mounted) return;
        if (res.ok) {
          const data = await res.json() as Status;
          setStatus(data);
          setHasError(false);
        } else {
          console.warn('[ClaudeCodeIndicator] /api/claude-status HTTP', res.status);
          setHasError(true);
        }
      } catch (err) {
        if (mounted) {
          console.warn('[ClaudeCodeIndicator] fetch failed:', err instanceof Error ? err.message : err);
          setHasError(true);
        }
      }
    }

    poll();
    const interval = setInterval(poll, 15_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  // Determine display values
  // - While loading (no status yet, no error): show faint dot with no label
  // - On error: show "unknown"
  // - On success: show actual status
  const statusKey = hasError
    ? 'unknown'
    : (status?.status ?? null);

  if (!statusKey && !hasError) {
    // Still loading the very first response — show a minimal placeholder
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', opacity: 0.4 }}
      >
        <span
          className="rounded-full shrink-0"
          style={{ width: 6, height: 6, background: 'var(--text-faint)' }}
        />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: '9px', color: 'var(--text-faint)', letterSpacing: '0.1em' }}>
          CC
        </span>
      </div>
    );
  }

  const cfg = STATUS_CONFIG[statusKey as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.unknown;
  const isActive = status?.status === 'running' || status?.status === 'waiting_for_permission';
  const tooltip = status?.current_task ?? status?.permission_request ?? `Claude Code: ${statusKey}`;

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded"
      title={tooltip}
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <span
        className="rounded-full shrink-0"
        style={{
          width: 6,
          height: 6,
          background: cfg.color,
          boxShadow: isActive ? `0 0 6px ${cfg.color}` : 'none',
        }}
      />
      <span
        style={{
          fontFamily: "var(--font-mono)",
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
