'use client';

import { useState } from 'react';
import DeleteButton from './DeleteButton';

interface Thought {
  id: string;
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

/** First line or first 90 chars — whichever is shorter */
function preview(content: string): { text: string; truncated: boolean } {
  const firstLine = content.split('\n')[0].trim();
  if (firstLine.length <= 100) return { text: firstLine, truncated: firstLine !== content.trim() };
  return { text: firstLine.slice(0, 100) + '…', truncated: true };
}

export default function ThoughtsTable({ thoughts }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      {/* Header */}
      <div
        className="grid px-4 py-2"
        style={{
          gridTemplateColumns: '1fr 56px 20px',
          gap: '12px',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '9px',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--text-faint)',
        }}
      >
        <span>Thought</span>
        <span style={{ textAlign: 'right' }}>Date</span>
        <span />
      </div>

      {thoughts.map((t, i) => {
        const { text, truncated } = preview(t.content);
        const isExpanded = expanded.has(t.id);
        const canExpand = truncated || t.content.includes('\n');

        return (
          <div
            key={t.id}
            className="group px-4 py-2.5"
            style={{
              borderTop: i === 0 ? 'none' : '1px solid var(--border)',
              background: i % 2 === 0 ? 'var(--bg)' : 'var(--surface)',
              cursor: canExpand ? 'pointer' : 'default',
            }}
            onClick={() => canExpand && toggle(t.id)}
          >
            <div
              className="grid items-start"
              style={{ gridTemplateColumns: '1fr 56px 20px', gap: '12px' }}
            >
              <p
                className="text-sm leading-snug"
                style={{ color: 'var(--text)' }}
              >
                {isExpanded ? t.content : text}
              </p>

              <p
                className="text-xs text-right shrink-0"
                style={{
                  color: 'var(--text-faint)',
                  fontFamily: "'JetBrains Mono', monospace",
                  lineHeight: '20px',
                }}
              >
                {fmtDate(t.created_at)}
              </p>

              {/* stop propagation so delete click doesn't toggle expand */}
              <div onClick={(e) => e.stopPropagation()}>
                <DeleteButton id={t.id} endpoint="/api/thoughts" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
