'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import DeleteButton from './DeleteButton';

interface Thought {
  id: string;
  title: string | null;
  content: string;
  created_at: string;
}

interface Props {
  thoughts: Thought[];
}

function fmtDate(d: string): string {
  const s = String(d).slice(0, 10);
  const parts = s.split('-').map(Number);
  if (parts.length !== 3) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parts[1] - 1]} ${String(parts[2]).padStart(2, '0')}`;
}

function getDisplayTitle(t: Thought): string {
  if (t.title) return t.title;
  const firstLine = t.content.split('\n')[0].trim();
  return firstLine.length <= 60 ? firstLine : firstLine.slice(0, 60) + '...';
}

function ThoughtDetailPanel({ thought, onClose }: { thought: Thought; onClose: () => void }) {
  return (
    <div
      className="fixed top-0 right-0 h-full flex flex-col"
      style={{
        width: 400, maxWidth: '100vw',
        background: 'var(--surface)', borderLeft: '1px solid var(--border)',
        zIndex: 50, boxShadow: '-4px 0 24px rgba(0,0,0,0.3)',
      }}
    >
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Thought</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}><X size={16} /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
        {thought.title && (
          <div>
            <label style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>Title</label>
            <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{thought.title}</p>
          </div>
        )}
        <div>
          <label style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>Content</label>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{thought.content}</p>
        </div>
        <div>
          <label style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>Date</label>
          <p className="text-xs" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}>{fmtDate(thought.created_at)}</p>
        </div>
      </div>
    </div>
  );
}

export default function ThoughtsTable({ thoughts }: Props) {
  const [selectedThought, setSelectedThought] = useState<Thought | null>(null);

  return (
    <>
      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        <div
          className="grid px-4 py-2"
          style={{
            gridTemplateColumns: '1fr 56px 20px', gap: '12px',
            background: 'var(--surface)', borderBottom: '1px solid var(--border)',
            fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)',
          }}
        >
          <span>Thought</span>
          <span style={{ textAlign: 'right' }}>Date</span>
          <span />
        </div>

        {thoughts.map((t, i) => (
          <div
            key={t.id}
            className="group px-4 py-2.5"
            style={{
              borderTop: i === 0 ? 'none' : '1px solid var(--border)',
              background: i % 2 === 0 ? 'var(--bg)' : 'var(--surface)',
              cursor: 'pointer',
            }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('button')) return;
              setSelectedThought(t);
            }}
          >
            <div className="grid items-start" style={{ gridTemplateColumns: '1fr 56px 20px', gap: '12px' }}>
              <p className="text-sm leading-snug" style={{ color: 'var(--text)' }}>{getDisplayTitle(t)}</p>
              <p className="text-xs text-right shrink-0" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)", lineHeight: '20px' }}>{fmtDate(t.created_at)}</p>
              <div onClick={(e) => e.stopPropagation()}>
                <DeleteButton id={t.id} endpoint="/api/thoughts" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {selectedThought && <ThoughtDetailPanel thought={selectedThought} onClose={() => setSelectedThought(null)} />}
    </>
  );
}
