'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const params = useSearchParams();
  const from = params.get('from') ?? '/';
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/auth?from=${encodeURIComponent(from)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        redirect: 'follow',
      });
      if (res.ok || res.redirected) {
        window.location.href = res.url || from;
      } else {
        setError('Incorrect password');
      }
    } catch {
      setError('Something went wrong — try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg)' }}
    >
      <div
        className="w-full max-w-sm rounded-xl p-8"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <p
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '11px',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--cyan)',
            marginBottom: 24,
          }}
        >
          Personal AI OS
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full rounded-md px-3 py-2 text-sm outline-none"
            style={{
              background: 'var(--bg)',
              border: `1px solid ${error ? 'var(--red)' : 'var(--border)'}`,
              color: 'var(--text)',
            }}
          />
          {error && (
            <p style={{ fontSize: '12px', color: 'var(--red)' }}>{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            className="rounded-md px-4 py-2 text-sm font-medium transition-opacity"
            style={{
              background: 'var(--cyan)',
              color: 'var(--bg)',
              opacity: loading || !password ? 0.5 : 1,
              cursor: loading || !password ? 'not-allowed' : 'pointer',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {loading ? 'Checking…' : 'Enter'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
