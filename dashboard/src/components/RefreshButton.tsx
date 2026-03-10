'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { RefreshCw } from 'lucide-react';

export default function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [justRefreshed, setJustRefreshed] = useState(false);

  function handleRefresh() {
    startTransition(() => {
      router.refresh();
    });
    setJustRefreshed(true);
    setTimeout(() => setJustRefreshed(false), 1200);
  }

  return (
    <button
      onClick={handleRefresh}
      disabled={isPending}
      title="Refresh page data"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        borderRadius: 6,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        color: justRefreshed ? 'var(--green)' : 'var(--text-muted)',
        cursor: isPending ? 'wait' : 'pointer',
        fontSize: '11px',
        fontFamily: "var(--font-mono)",
        letterSpacing: '0.05em',
        transition: 'color 0.2s',
        opacity: isPending ? 0.6 : 1,
      }}
    >
      <RefreshCw
        size={11}
        style={{
          flexShrink: 0,
          animation: isPending ? 'spin 0.7s linear infinite' : 'none',
        }}
      />
      <span>{justRefreshed ? 'done' : 'refresh'}</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </button>
  );
}
