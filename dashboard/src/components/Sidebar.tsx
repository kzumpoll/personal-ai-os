'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from './ThemeProvider';
import {
  CalendarDays,
  CheckSquare,
  LayoutDashboard,
  Zap,
  Lightbulb,
  MessageCircle,
  BookOpen,
  FolderKanban,
  Target,
  Bookmark,
  Sun,
  Moon,
  Search,
  BarChart2,
} from 'lucide-react';
import ClaudeCodeIndicator from './ClaudeCodeIndicator';

const navGroups = [
  {
    label: 'Operations',
    items: [
      { href: '/',               label: 'Today',          Icon: CalendarDays },
      { href: '/tasks',          label: 'Tasks',          Icon: CheckSquare },
      { href: '/command-center', label: 'Command Center', Icon: LayoutDashboard },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { href: '/intelligence', label: 'Intelligence', Icon: Zap },
      { href: '/ideas',        label: 'Ideas',        Icon: Lightbulb },
      { href: '/thoughts',     label: 'Thoughts',     Icon: MessageCircle },
      { href: '/journal',      label: 'Journal',      Icon: BookOpen },
      { href: '/review',       label: 'Review',       Icon: BarChart2 },
    ],
  },
  {
    label: 'Systems',
    items: [
      { href: '/projects',   label: 'Projects',   Icon: FolderKanban },
      { href: '/goals',      label: 'Goals',      Icon: Target },
      { href: '/resources',  label: 'Resources',  Icon: Bookmark },
      { href: '/search',     label: 'Search',     Icon: Search },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  return (
    <aside
      style={{ background: 'var(--surface)', borderRight: '1px solid var(--border)' }}
      className="w-52 shrink-0 flex flex-col py-5 px-3 overflow-y-auto"
    >
      {/* Brand */}
      <div className="px-3 mb-7">
        <p
          style={{
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--text)',
            letterSpacing: '-0.01em',
            lineHeight: 1.3,
          }}
        >
          Kemp&apos;s Life OS
        </p>
        <p
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '9px',
            letterSpacing: '0.1em',
            color: 'var(--cyan)',
            marginTop: 2,
          }}
        >
          COMMAND CENTER
        </p>
      </div>

      {navGroups.map((group) => (
        <div key={group.label} className="mb-6">
          <p
            className="px-3 mb-1.5"
            style={{
              fontSize: '10px',
              fontWeight: 500,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--text-faint)',
            }}
          >
            {group.label}
          </p>
          {group.items.map(({ href, label, Icon }) => {
            // Today page is "/" but may also have ?date= params
            const active = href === '/' ? pathname === '/' : pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-2.5 px-3 py-[7px] rounded-md transition-colors"
                style={{
                  background: active ? 'var(--surface-3)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text-muted)',
                  borderLeft: active ? '2px solid var(--cyan)' : '2px solid transparent',
                  fontSize: '13.5px',
                  fontWeight: active ? 500 : 400,
                }}
              >
                <Icon
                  size={15}
                  style={{ opacity: active ? 1 : 0.55, flexShrink: 0 }}
                  strokeWidth={active ? 2 : 1.5}
                />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      ))}

      {/* Footer */}
      <div
        className="mt-auto px-3 pt-4 flex flex-col gap-3"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <button
          onClick={toggle}
          className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 transition-colors"
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
            fontSize: '12px',
            cursor: 'pointer',
            textAlign: 'left',
          }}
          aria-label="Toggle theme"
        >
          {isDark
            ? <Sun size={13} style={{ flexShrink: 0 }} />
            : <Moon size={13} style={{ flexShrink: 0 }} />
          }
          <span style={{ fontSize: '12px' }}>{isDark ? 'Light mode' : 'Dark mode'}</span>
        </button>

        <ClaudeCodeIndicator />
      </div>
    </aside>
  );
}
