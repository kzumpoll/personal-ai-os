'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import PageHeader from '@/components/PageHeader';

interface TaskResult   { id: string; title: string; due_date: string | null; status: string }
interface ThoughtResult { id: string; content: string; created_at: string }
interface IdeaResult    { id: string; content: string; actionability: string | null; created_at: string }
interface ResourceResult { id: string; title: string; content_or_url: string | null; type: string | null; created_at: string }

interface Results {
  tasks: TaskResult[];
  thoughts: ThoughtResult[];
  ideas: IdeaResult[];
  resources: ResourceResult[];
}

function fmtDate(d: string | null): string {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const parts = s.split('-').map(Number);
  if (parts.length !== 3) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parts[1] - 1]} ${String(parts[2]).padStart(2, '0')}`;
}

function isUrl(str: string) {
  try { new URL(str); return true; } catch { return false; }
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <p
      className="mb-2 mt-5"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: '9px',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--text-faint)',
      }}
    >
      {label} <span style={{ color: 'var(--text-muted)' }}>{count}</span>
    </p>
  );
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) { setResults(null); return; }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data);
      } catch {
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [query]);

  const total = results
    ? results.tasks.length + results.thoughts.length + results.ideas.length + results.resources.length
    : 0;

  return (
    <div className="max-w-2xl">
      <PageHeader title="Search" subtitle="Tasks, thoughts, ideas, resources" />

      {/* Search input */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 rounded-lg mb-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <Search size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
        <input
          autoFocus
          type="text"
          placeholder="Search everything..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text)',
            fontSize: '14px',
            fontWeight: 500,
          }}
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 0 }}>
            <X size={13} />
          </button>
        )}
      </div>

      {loading && (
        <p className="text-xs" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}>searching…</p>
      )}

      {results && !loading && total === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No results for &ldquo;{query}&rdquo;</p>
      )}

      {results && total > 0 && (
        <div>
          {results.tasks.length > 0 && (
            <section>
              <SectionHeader label="Tasks" count={results.tasks.length} />
              <div className="flex flex-col gap-1.5">
                {results.tasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: t.status === 'done' ? 'var(--green)' : 'var(--amber)' }}
                    />
                    <span className="text-sm flex-1 truncate" style={{ color: 'var(--text)', textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</span>
                    {t.due_date && (
                      <span className="text-xs shrink-0" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}>{fmtDate(t.due_date)}</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {results.ideas.length > 0 && (
            <section>
              <SectionHeader label="Ideas" count={results.ideas.length} />
              <div className="flex flex-col gap-1.5">
                {results.ideas.map((i) => (
                  <div key={i.id} className="px-3 py-2.5 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <p className="text-sm" style={{ color: 'var(--text)' }}>{i.content}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {i.actionability && (
                        <span className="text-xs capitalize" style={{ color: 'var(--text-faint)' }}>{i.actionability}</span>
                      )}
                      <span className="text-xs ml-auto" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}>{fmtDate(i.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {results.thoughts.length > 0 && (
            <section>
              <SectionHeader label="Thoughts" count={results.thoughts.length} />
              <div className="flex flex-col gap-1.5">
                {results.thoughts.map((t) => (
                  <div key={t.id} className="flex items-start gap-3 px-3 py-2.5 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <p className="text-sm flex-1" style={{ color: 'var(--text)' }}>{t.content}</p>
                    <span className="text-xs shrink-0 mt-0.5" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}>{fmtDate(t.created_at)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {results.resources.length > 0 && (
            <section>
              <SectionHeader label="Resources" count={results.resources.length} />
              <div className="flex flex-col gap-1.5">
                {results.resources.map((r) => (
                  <div key={r.id} className="px-3 py-2.5 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    {r.content_or_url && isUrl(r.content_or_url) ? (
                      <a href={r.content_or_url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                        {r.title}
                      </a>
                    ) : (
                      <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{r.title}</p>
                    )}
                    <div className="flex items-center gap-2 mt-0.5">
                      {r.type && <span className="text-xs capitalize" style={{ color: 'var(--text-faint)' }}>{r.type}</span>}
                      <span className="text-xs ml-auto" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}>{fmtDate(r.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {!query && (
        <p className="text-sm mt-6" style={{ color: 'var(--text-faint)' }}>
          Type at least 2 characters to search across all your data.
        </p>
      )}
    </div>
  );
}
