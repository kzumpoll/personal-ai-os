'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from './ThemeProvider';
import {
  CalendarDays,
  Calendar,
  CheckSquare,
  LayoutDashboard,
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
  DollarSign,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import ClaudeCodeIndicator from './ClaudeCodeIndicator';

const navGroups = [
  {
    label: 'Operations',
    items: [
      { href: '/',               label: 'Today',          Icon: CalendarDays },
      { href: '/tasks',          label: 'Tasks',          Icon: CheckSquare },
      { href: '/calendar',       label: 'Calendar',       Icon: Calendar },
      { href: '/command-center', label: 'Command Center', Icon: LayoutDashboard },
    ],
  },
  {
    label: 'Thinking',
    items: [
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
      { href: '/finances',   label: 'Finances',   Icon: DollarSign },
      { href: '/search',     label: 'Search',     Icon: Search },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved === 'true') setCollapsed(true);
  }, []);

  const toggleCollapse = () => {
    setCollapsed(prev => {
      localStorage.setItem('sidebar-collapsed', String(!prev));
      return !prev;
    });
  };

  return (
    <aside
      style={{ background: 'var(--surface)', borderRight: '1px solid var(--border)', transition: 'width 0.15s ease' }}
      className={`${collapsed ? 'w-12' : 'w-52'} shrink-0 flex flex-col py-5 ${collapsed ? 'px-1' : 'px-3'} overflow-y-auto overflow-x-hidden`}
    >
      {/* Brand + collapse toggle */}
      <div className={`${collapsed ? 'px-0 flex justify-center' : 'px-3'} mb-7`}>
        {collapsed ? (
          <button onClick={toggleCollapse} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }} aria-label="Expand sidebar">
            <PanelLeftOpen size={16} />
          </button>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em', lineHeight: 1.3 }}>
                Kemp&apos;s Life OS
              </p>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.1em', color: 'var(--cyan)', marginTop: 2 }}>
                COMMAND CENTER
              </p>
            </div>
            <button onClick={toggleCollapse} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: 4 }} aria-label="Collapse sidebar">
              <PanelLeftClose size={14} />
            </button>
          </div>
        )}
      </div>

      {navGroups.map((group) => (
        <div key={group.label} className="mb-6">
          {!collapsed && (
            <p
              className="px-3 mb-1.5"
              style={{ fontSize: '10px', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-faint)' }}
            >
              {group.label}
            </p>
          )}
          {group.items.map(({ href, label, Icon }) => {
            const active = href === '/' ? pathname === '/' : pathname === href;
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'} ${collapsed ? 'px-0 py-2' : 'px-3 py-[7px]'} rounded-md transition-colors`}
                style={{
                  background: active ? 'var(--surface-3)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text-muted)',
                  borderLeft: active ? '2px solid var(--cyan)' : '2px solid transparent',
                  fontSize: '13.5px',
                  fontWeight: active ? 500 : 400,
                }}
              >
                <Icon size={15} style={{ opacity: active ? 1 : 0.55, flexShrink: 0 }} strokeWidth={active ? 2 : 1.5} />
                {!collapsed && <span>{label}</span>}
              </Link>
            );
          })}
        </div>
      ))}

      {/* Footer */}
      <div className={`mt-auto ${collapsed ? 'px-0' : 'px-3'} pt-4 flex flex-col gap-3`} style={{ borderTop: '1px solid var(--border)' }}>
        <button
          onClick={toggle}
          className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2'} w-full rounded-md px-2 py-1.5 transition-colors`}
          style={{ background: 'transparent', border: collapsed ? 'none' : '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer', textAlign: 'left' }}
          title={collapsed ? (isDark ? 'Light mode' : 'Dark mode') : undefined}
          aria-label="Toggle theme"
        >
          {isDark ? <Sun size={13} style={{ flexShrink: 0 }} /> : <Moon size={13} style={{ flexShrink: 0 }} />}
          {!collapsed && <span style={{ fontSize: '12px' }}>{isDark ? 'Light mode' : 'Dark mode'}</span>}
        </button>
        {!collapsed && <ClaudeCodeIndicator />}
      </div>
    </aside>
  );
}
