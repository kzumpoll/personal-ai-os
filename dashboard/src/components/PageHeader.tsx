import type { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: 'blue' | 'cyan' | 'violet' | 'green' | 'amber' | 'red';
  rightSlot?: ReactNode;
}

const badgeColors: Record<string, string> = {
  blue:   'rgba(59,130,246,0.15)',
  cyan:   'rgba(6,182,212,0.15)',
  violet: 'rgba(139,92,246,0.15)',
  green:  'rgba(16,185,129,0.15)',
  amber:  'rgba(245,158,11,0.15)',
  red:    'rgba(239,68,68,0.15)',
};

const badgeText: Record<string, string> = {
  blue:   'var(--blue)',
  cyan:   'var(--cyan)',
  violet: 'var(--violet)',
  green:  'var(--green)',
  amber:  'var(--amber)',
  red:    'var(--red)',
};

export default function PageHeader({ title, subtitle, badge, badgeColor = 'cyan', rightSlot }: Props) {
  return (
    <div className="mb-8 flex items-start justify-between">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1
            className="text-xl font-semibold"
            style={{ color: 'var(--text)', letterSpacing: '-0.01em' }}
          >
            {title}
          </h1>
          {badge && (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded"
              style={{
                background: badgeColors[badgeColor],
                color: badgeText[badgeColor],
                fontFamily: "var(--font-mono)",
                fontSize: '10px',
                letterSpacing: '0.06em',
              }}
            >
              {badge}
            </span>
          )}
        </div>
        {subtitle && (
          <p
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              fontFamily: "var(--font-mono)",
              letterSpacing: '0.02em',
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {rightSlot && (
        <div className="flex items-center gap-2 mt-1">
          {rightSlot}
        </div>
      )}
    </div>
  );
}
