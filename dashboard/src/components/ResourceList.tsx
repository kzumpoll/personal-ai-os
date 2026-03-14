'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { Search, ExternalLink, X, ChevronRight, Trash2, Pencil } from 'lucide-react';
import { Resource } from '@/lib/db';

const typeColors: Record<string, { color: string; bg: string }> = {
  link:     { color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  article:  { color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' },
  book:     { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  video:    { color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  tool:     { color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
  note:     { color: '#64748b', bg: 'rgba(100,116,139,0.1)' },
};

function isUrl(str: string) {
  try { new URL(str); return true; } catch { return false; }
}

function toDateStr(d: unknown): string {
  if (d instanceof Date) return d.toISOString();
  return String(d);
}

interface Props {
  resources: Resource[];
}

interface AddFormProps {
  onAdded: (r: Resource) => void;
}

function AddResourceForm({ onAdded }: AddFormProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState('note');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), content_or_url: content.trim() || undefined, type }),
      });
      if (!res.ok) throw new Error('Failed to save');
      const created = await res.json() as Resource;
      onAdded(created);
      setTitle(''); setContent(''); setType('note'); setOpen(false);
    } catch (err) {
      console.error('AddResourceForm save error:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-2">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-sm px-3 py-1.5 rounded-lg transition-colors"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}
        >
          + Add resource
        </button>
      ) : (
        <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs mb-3" style={{ fontFamily: "var(--font-mono)", letterSpacing: '0.12em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>New resource</p>
          <div className="flex flex-col gap-2">
            <input
              autoFocus
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text)', fontSize: 13, outline: 'none', width: '100%' }}
            />
            <textarea
              placeholder="URL, notes, or content (optional)"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical', width: '100%', fontFamily: 'inherit' }}
            />
            <div className="flex items-center gap-2">
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', color: 'var(--text-muted)', fontSize: 12, outline: 'none', cursor: 'pointer' }}
              >
                {['note', 'link', 'article', 'book', 'video', 'tool'].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => { setOpen(false); setTitle(''); setContent(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 12, padding: '4px 8px' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!title.trim() || saving}
                style={{
                  background: title.trim() ? 'var(--cyan)' : 'var(--surface)',
                  border: 'none', borderRadius: 6, color: title.trim() ? '#fff' : 'var(--text-faint)',
                  cursor: title.trim() ? 'pointer' : 'default', fontSize: 12, fontWeight: 600, padding: '4px 14px',
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ResourceList({ resources: initial }: Props) {
  const router = useRouter();
  const [resources, setResources] = useState<Resource[]>(initial);
  const [query, setQuery] = useState('');
  const [activeType, setActiveType] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editType, setEditType] = useState('note');
  const [editSaving, setEditSaving] = useState(false);

  function startEdit(r: Resource, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingId(r.id);
    setEditTitle(r.title);
    setEditContent(r.content_or_url ?? '');
    setEditType(r.type ?? 'note');
    setExpandedId(r.id);
  }

  async function saveEdit(id: string) {
    if (!editTitle.trim()) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/resources/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle.trim(), content_or_url: editContent.trim() || null, type: editType }),
      });
      if (!res.ok) throw new Error('Failed to save');
      const updated = await res.json() as Resource;
      setResources(prev => prev.map(r => r.id === id ? updated : r));
      setEditingId(null);
    } catch { /* silent */ }
    finally { setEditSaving(false); }
  }

  // Collect unique types from the data
  const types = useMemo(() => {
    const seen = new Set<string>();
    for (const r of resources) {
      if (r.type) seen.add(r.type.toLowerCase());
    }
    return Array.from(seen).sort();
  }, [resources]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return resources.filter((r) => {
      if (activeType && r.type?.toLowerCase() !== activeType) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        (r.content_or_url ?? '').toLowerCase().includes(q) ||
        (r.type ?? '').toLowerCase().includes(q)
      );
    });
  }, [resources, query, activeType]);

  return (
    <div>
      {/* Add Resource form */}
      <AddResourceForm onAdded={(r) => setResources((prev) => [r, ...prev])} />

      {/* gap */}
      <div className="mb-5" />

      {/* Search + filters */}
      <div className="flex flex-col gap-3 mb-5">
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <Search size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search resources..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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
          {query && (
            <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 0 }}>
              <X size={13} />
            </button>
          )}
        </div>

        {types.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setActiveType(null)}
              className="text-xs px-2.5 py-1 rounded-full transition-colors"
              style={{
                background: activeType === null ? 'var(--cyan)' : 'var(--surface)',
                color: activeType === null ? '#fff' : 'var(--text-muted)',
                border: '1px solid ' + (activeType === null ? 'var(--cyan)' : 'var(--border)'),
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              All
            </button>
            {types.map((t) => {
              const cfg = typeColors[t] ?? { color: '#64748b', bg: 'rgba(100,116,139,0.1)' };
              const isActive = activeType === t;
              return (
                <button
                  key={t}
                  onClick={() => setActiveType(isActive ? null : t)}
                  className="text-xs px-2.5 py-1 rounded-full transition-colors capitalize"
                  style={{
                    background: isActive ? cfg.bg : 'var(--surface)',
                    color: isActive ? cfg.color : 'var(--text-muted)',
                    border: '1px solid ' + (isActive ? cfg.color + '40' : 'var(--border)'),
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Count */}
      <p className="text-xs mb-3" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}>
        {filtered.length} result{filtered.length !== 1 ? 's' : ''}
      </p>

      {/* List */}
      {filtered.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {query || activeType ? 'No matches.' : 'No resources yet.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((r) => {
            const typeCfg = r.type ? typeColors[r.type.toLowerCase()] ?? { color: '#64748b', bg: 'rgba(100,116,139,0.1)' } : null;
            const hasUrl = r.content_or_url && isUrl(r.content_or_url);
            let dateStr = '';
            try { dateStr = format(new Date(toDateStr(r.created_at)), 'MMM d'); } catch { /* skip */ }
            const isExpanded = expandedId === r.id;
            const isConfirming = confirmDeleteId === r.id;

            return (
              <div
                key={r.id}
                className="group rounded-lg"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <div
                  className="flex items-start justify-between gap-3 p-4"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setExpandedId(isExpanded ? null : r.id)}
                >
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <ChevronRight
                      size={14}
                      className="shrink-0 mt-0.5 transition-transform"
                      style={{ color: 'var(--text-faint)', transform: isExpanded ? 'rotate(90deg)' : 'none' }}
                    />
                    <div className="flex-1 min-w-0">
                      {hasUrl ? (
                        <a href={r.content_or_url!} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>{r.title}</span>
                          <ExternalLink size={11} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                        </a>
                      ) : (
                        <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{r.title}</p>
                      )}
                      {!isExpanded && r.content_or_url && !hasUrl && (
                        <p className="text-xs mt-1 line-clamp-1" style={{ color: 'var(--text-muted)' }}>{r.content_or_url}</p>
                      )}
                      {!isExpanded && hasUrl && (
                        <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}>{r.content_or_url}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {r.type && typeCfg && (
                      <span className="text-xs px-2 py-0.5 rounded-full capitalize" style={{ color: typeCfg.color, background: typeCfg.bg, fontWeight: 500 }}>{r.type}</span>
                    )}
                    {dateStr && <span className="text-xs" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}>{dateStr}</span>}

                    {/* Edit button — visible on hover */}
                    {editingId !== r.id && (
                      <button
                        onClick={(e) => startEdit(r, e)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 2 }}
                        aria-label="Edit resource"
                      >
                        <Pencil size={12} />
                      </button>
                    )}

                    {/* Delete button — visible on hover */}
                    {isConfirming ? (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={async () => {
                            setDeletingId(r.id);
                            try {
                              const res = await fetch(`/api/resources/${r.id}`, { method: 'DELETE' });
                              if (res.ok) {
                                setResources((prev) => prev.filter((x) => x.id !== r.id));
                                router.refresh();
                              }
                            } catch { /* silent */ }
                            finally { setDeletingId(null); setConfirmDeleteId(null); }
                          }}
                          disabled={deletingId === r.id}
                          className="text-xs px-2 py-0.5 rounded"
                          style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--red)', cursor: 'pointer' }}
                        >{deletingId === r.id ? '...' : 'Delete'}</button>
                        <button onClick={() => setConfirmDeleteId(null)} className="text-xs" style={{ color: 'var(--text-faint)', cursor: 'pointer' }}>Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(r.id); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 2 }}
                        aria-label="Delete resource"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded detail / inline editor */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-0 ml-6" style={{ borderTop: '1px solid var(--border)' }}>
                    {editingId === r.id ? (
                      <div className="pt-3 flex flex-col gap-2">
                        <input
                          autoFocus
                          value={editTitle}
                          onChange={e => setEditTitle(e.target.value)}
                          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text)', fontSize: 13, outline: 'none', width: '100%' }}
                        />
                        <textarea
                          value={editContent}
                          onChange={e => setEditContent(e.target.value)}
                          rows={5}
                          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical', width: '100%', fontFamily: 'inherit' }}
                        />
                        <div className="flex items-center gap-2">
                          <select
                            value={editType}
                            onChange={e => setEditType(e.target.value)}
                            style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', color: 'var(--text-muted)', fontSize: 12, outline: 'none', cursor: 'pointer' }}
                          >
                            {['note', 'link', 'article', 'book', 'video', 'tool'].map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                          <div style={{ flex: 1 }} />
                          <button
                            onClick={() => setEditingId(null)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 12, padding: '4px 8px' }}
                          >Cancel</button>
                          <button
                            onClick={() => saveEdit(r.id)}
                            disabled={!editTitle.trim() || editSaving}
                            style={{ background: editTitle.trim() ? 'var(--cyan)' : 'var(--surface)', border: 'none', borderRadius: 6, color: editTitle.trim() ? '#fff' : 'var(--text-faint)', cursor: editTitle.trim() ? 'pointer' : 'default', fontSize: 12, fontWeight: 600, padding: '4px 14px' }}
                          >{editSaving ? 'Saving…' : 'Save'}</button>
                        </div>
                      </div>
                    ) : (
                      <div className="pt-3 flex flex-col gap-2">
                        {r.content_or_url && (
                          <div>
                            <label style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>
                              {hasUrl ? 'URL' : 'Content'}
                            </label>
                            {hasUrl ? (
                              <a href={r.content_or_url} target="_blank" rel="noopener noreferrer" className="text-xs break-all" style={{ color: 'var(--cyan)', fontFamily: "var(--font-mono)" }}>{r.content_or_url}</a>
                            ) : (
                              <p className="text-sm leading-relaxed" style={{ color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{r.content_or_url}</p>
                            )}
                          </div>
                        )}
                        {r.type && (
                          <div>
                            <label style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>Type</label>
                            <p className="text-xs capitalize" style={{ color: 'var(--text-muted)' }}>{r.type}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
