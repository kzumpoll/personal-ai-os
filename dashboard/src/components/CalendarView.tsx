'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { format, parseISO, addDays, eachDayOfInterval, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { ChevronLeft, ChevronRight, X, Clock, Bell } from 'lucide-react';

interface Reminder {
  id: string;
  title: string;
  body: string;
  scheduled_at: string;
  status: string;
  recipient_name: string | null;
  suggested_message: string | null;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  location?: string;
}

interface Props {
  reminders: Reminder[];
  eventsMap: Record<string, CalendarEvent[]>;
  upcoming: Reminder[];
  today: string;
  view: 'week' | 'month';
  rangeStart: string;
  rangeEnd: string;
}

function fmtTime(isoStr: string): string {
  try {
    return format(new Date(isoStr), 'HH:mm');
  } catch { return ''; }
}

function statusColor(status: string): string {
  if (status === 'done') return 'var(--green)';
  if (status === 'cancelled') return 'var(--text-faint)';
  if (status === 'snoozed') return 'var(--amber)';
  return 'var(--cyan)';
}

export default function CalendarView({ reminders, eventsMap, upcoming, today, view, rangeStart, rangeEnd }: Props) {
  const router = useRouter();
  const [selectedReminder, setSelectedReminder] = useState<Reminder | null>(null);
  const [currentView, setCurrentView] = useState(view);

  const base = parseISO(today + 'T12:00:00');

  function navigate(direction: number) {
    const days = currentView === 'week' ? 7 : 30;
    const newDate = addDays(parseISO(rangeStart + 'T12:00:00'), direction * days);
    router.push(`/calendar?date=${format(newDate, 'yyyy-MM-dd')}&view=${currentView}`);
  }

  function goToday() {
    router.push(`/calendar?view=${currentView}`);
  }

  function switchView(v: 'week' | 'month') {
    setCurrentView(v);
    router.push(`/calendar?date=${rangeStart}&view=${v}`);
  }

  // Build days for current range
  const rangeStartDate = parseISO(rangeStart + 'T12:00:00');
  const rangeEndDate = parseISO(rangeEnd + 'T12:00:00');
  const days = eachDayOfInterval({ start: rangeStartDate, end: rangeEndDate });

  // Group reminders by date
  const remindersByDate: Record<string, Reminder[]> = {};
  for (const r of reminders) {
    const d = r.scheduled_at.slice(0, 10);
    if (!remindersByDate[d]) remindersByDate[d] = [];
    remindersByDate[d].push(r);
  }

  const isWeek = currentView === 'week';

  return (
    <div className="flex flex-col gap-6">
      {/* Nav bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}><ChevronLeft size={18} /></button>
          <button onClick={goToday} className="text-xs px-3 py-1 rounded" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}>Today</button>
          <button onClick={() => navigate(1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}><ChevronRight size={18} /></button>
          <span className="text-sm font-medium ml-2" style={{ color: 'var(--text)' }}>
            {format(rangeStartDate, 'MMM d')} — {format(rangeEndDate, 'MMM d, yyyy')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => switchView('week')}
            className="text-xs px-3 py-1 rounded"
            style={{ background: isWeek ? 'var(--surface-3)' : 'var(--surface)', border: '1px solid var(--border)', color: isWeek ? 'var(--text)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: isWeek ? 600 : 400 }}
          >Week</button>
          <button
            onClick={() => switchView('month')}
            className="text-xs px-3 py-1 rounded"
            style={{ background: !isWeek ? 'var(--surface-3)' : 'var(--surface)', border: '1px solid var(--border)', color: !isWeek ? 'var(--text)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: !isWeek ? 600 : 400 }}
          >Month</button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        {/* Day headers */}
        <div
          className="grid"
          style={{
            gridTemplateColumns: isWeek ? 'repeat(7, 1fr)' : 'repeat(7, 1fr)',
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="px-2 py-2 text-center" style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {days.map((day) => {
            const dayStr = format(day, 'yyyy-MM-dd');
            const isToday = dayStr === today;
            const dayReminders = remindersByDate[dayStr] ?? [];
            const dayEvents = eventsMap[dayStr] ?? [];

            return (
              <div
                key={dayStr}
                className="flex flex-col gap-0.5 p-1.5"
                style={{
                  minHeight: isWeek ? 120 : 80,
                  borderRight: '1px solid var(--border)',
                  borderBottom: '1px solid var(--border)',
                  background: isToday ? 'rgba(6,182,212,0.05)' : 'var(--bg)',
                }}
              >
                <span
                  className="text-xs font-medium self-end px-1 rounded-full"
                  style={{
                    color: isToday ? 'var(--bg)' : 'var(--text-muted)',
                    background: isToday ? 'var(--cyan)' : 'transparent',
                    fontSize: '11px',
                  }}
                >
                  {format(day, 'd')}
                </span>

                {/* Calendar events */}
                {dayEvents.slice(0, isWeek ? 4 : 2).map((e) => (
                  <div key={e.id} className="text-xs truncate px-1 py-0.5 rounded" style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--green)', fontSize: '10px' }}>
                    {!e.allDay && <span style={{ fontFamily: "var(--font-mono)" }}>{fmtTime(e.start)} </span>}
                    {e.title}
                  </div>
                ))}

                {/* Reminders */}
                {dayReminders.slice(0, isWeek ? 4 : 2).map((r) => (
                  <div
                    key={r.id}
                    className="text-xs truncate px-1 py-0.5 rounded cursor-pointer"
                    style={{
                      background: `${statusColor(r.status)}15`,
                      color: statusColor(r.status),
                      fontSize: '10px',
                    }}
                    onClick={() => setSelectedReminder(r)}
                  >
                    <Bell size={8} className="inline mr-0.5" style={{ verticalAlign: 'middle' }} />
                    {fmtTime(r.scheduled_at)} {r.title}
                  </div>
                ))}

                {(dayEvents.length + dayReminders.length) > (isWeek ? 4 : 2) && (
                  <span className="text-xs" style={{ color: 'var(--text-faint)', fontSize: '9px' }}>
                    +{dayEvents.length + dayReminders.length - (isWeek ? 4 : 2)} more
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Upcoming reminders list */}
      {upcoming.length > 0 && (
        <div>
          <p className="mb-3" style={{ fontFamily: "var(--font-mono)", fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Upcoming Reminders
          </p>
          <div className="flex flex-col gap-1.5">
            {upcoming.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-lg px-4 py-2.5 cursor-pointer"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                onClick={() => setSelectedReminder(r)}
              >
                <Clock size={13} style={{ color: statusColor(r.status), flexShrink: 0 }} />
                <span className="text-xs shrink-0" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)", minWidth: 90 }}>
                  {format(new Date(r.scheduled_at), 'MMM d HH:mm')}
                </span>
                <span className="text-sm flex-1 truncate" style={{ color: 'var(--text)' }}>{r.title}</span>
                <span className="text-xs px-2 py-0.5 rounded-full capitalize" style={{ color: statusColor(r.status), background: `${statusColor(r.status)}15` }}>
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reminder detail panel */}
      {selectedReminder && (
        <div
          className="fixed top-0 right-0 h-full flex flex-col"
          style={{
            width: 400, maxWidth: '100vw',
            background: 'var(--surface)', borderLeft: '1px solid var(--border)',
            zIndex: 50, boxShadow: '-4px 0 24px rgba(0,0,0,0.3)',
          }}
        >
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Reminder</span>
            <button onClick={() => setSelectedReminder(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}><X size={16} /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
            <div>
              <label style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>Title</label>
              <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{selectedReminder.title}</p>
            </div>
            <div>
              <label style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>Body</label>
              <p className="text-sm" style={{ color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{selectedReminder.body}</p>
            </div>
            <div>
              <label style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>Scheduled</label>
              <p className="text-sm" style={{ color: 'var(--text-muted)', fontFamily: "var(--font-mono)" }}>{format(new Date(selectedReminder.scheduled_at), 'MMM d, yyyy HH:mm')}</p>
            </div>
            <div>
              <label style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>Status</label>
              <span className="text-xs px-2 py-0.5 rounded-full capitalize" style={{ color: statusColor(selectedReminder.status), background: `${statusColor(selectedReminder.status)}15` }}>{selectedReminder.status}</span>
            </div>
            {selectedReminder.recipient_name && (
              <div>
                <label style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>Recipient</label>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{selectedReminder.recipient_name}</p>
              </div>
            )}
            {selectedReminder.suggested_message && (
              <div>
                <label style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>Suggested Message</label>
                <p className="text-sm rounded-lg p-3" style={{ color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--border)' }}>{selectedReminder.suggested_message}</p>
              </div>
            )}
            {selectedReminder.status === 'pending' && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={async () => {
                    await fetch(`/api/reminders/${selectedReminder.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }) });
                    setSelectedReminder(null);
                    router.refresh();
                  }}
                  className="text-xs px-3 py-1.5 rounded"
                  style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--green)', cursor: 'pointer' }}
                >Mark Done</button>
                <button
                  onClick={async () => {
                    await fetch(`/api/reminders/${selectedReminder.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) });
                    setSelectedReminder(null);
                    router.refresh();
                  }}
                  className="text-xs px-3 py-1.5 rounded"
                  style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)', cursor: 'pointer' }}
                >Cancel</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
