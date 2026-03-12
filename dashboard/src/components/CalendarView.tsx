'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { format, parseISO, addDays, eachDayOfInterval } from 'date-fns';
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

const HOURS = Array.from({ length: 16 }, (_, i) => i + 7); // 7:00 to 22:00
const HOUR_HEIGHT = 56; // px per hour row

function fmtTime(isoStr: string): string {
  try { return format(new Date(isoStr), 'HH:mm'); } catch { return ''; }
}

function getHourMinute(isoStr: string): { hour: number; min: number } {
  try {
    const d = new Date(isoStr);
    return { hour: d.getHours(), min: d.getMinutes() };
  } catch {
    return { hour: 0, min: 0 };
  }
}

function statusColor(status: string): string {
  if (status === 'done') return 'var(--green)';
  if (status === 'cancelled') return 'var(--text-faint)';
  if (status === 'snoozed') return 'var(--amber)';
  return 'var(--cyan)';
}

// Always Running placeholder jobs
const ALWAYS_RUNNING = [
  { label: 'Reminder Poller', color: 'var(--green)' },
  { label: 'Daily ROI', color: 'var(--cyan)' },
  { label: 'Calendar Sync', color: 'var(--violet)' },
];

export default function CalendarView({ reminders, eventsMap, upcoming, today, view, rangeStart, rangeEnd }: Props) {
  const router = useRouter();
  const [selectedReminder, setSelectedReminder] = useState<Reminder | null>(null);

  const rangeStartDate = parseISO(rangeStart + 'T12:00:00');

  function navigate(direction: number) {
    const newDate = addDays(rangeStartDate, direction * 7);
    router.push(`/calendar?date=${format(newDate, 'yyyy-MM-dd')}&view=week`);
  }

  function goToday() {
    router.push(`/calendar?view=week`);
  }

  // Build 7-day range (Sun-Sat style: use Mon-Sun)
  const days = eachDayOfInterval({
    start: rangeStartDate,
    end: addDays(rangeStartDate, 6),
  });

  // Group reminders by date
  const remindersByDate: Record<string, Reminder[]> = {};
  for (const r of reminders) {
    const d = r.scheduled_at.slice(0, 10);
    if (!remindersByDate[d]) remindersByDate[d] = [];
    remindersByDate[d].push(r);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Always Running section */}
      <div>
        <p className="mb-2" style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
          Always Running
        </p>
        <div className="flex gap-2 flex-wrap">
          {ALWAYS_RUNNING.map((job) => (
            <span
              key={job.label}
              className="text-xs px-3 py-1 rounded-full"
              style={{ background: `${job.color}15`, color: job.color, border: `1px solid ${job.color}25` }}
            >
              {job.label}
            </span>
          ))}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}><ChevronLeft size={18} /></button>
          <button onClick={goToday} className="text-xs px-3 py-1 rounded" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}>Today</button>
          <button onClick={() => navigate(1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}><ChevronRight size={18} /></button>
          <span className="text-sm font-medium ml-2" style={{ color: 'var(--text)' }}>
            {format(rangeStartDate, 'MMM d')} — {format(addDays(rangeStartDate, 6), 'MMM d, yyyy')}
          </span>
        </div>
        <span className="text-xs px-3 py-1 rounded" style={{ background: 'var(--surface-3)', color: 'var(--text)', fontWeight: 600, border: '1px solid var(--border)' }}>
          Week
        </span>
      </div>

      {/* Week time grid */}
      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        {/* Day headers */}
        <div className="grid" style={{ gridTemplateColumns: '48px repeat(7, 1fr)', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          <div />
          {days.map((day) => {
            const dayStr = format(day, 'yyyy-MM-dd');
            const isToday = dayStr === today;
            return (
              <div key={dayStr} className="text-center py-2.5 flex flex-col items-center gap-0.5" style={{ borderLeft: '1px solid var(--border)' }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: isToday ? 'var(--cyan)' : 'var(--text-faint)' }}>
                  {format(day, 'EEE')}
                </span>
                <span
                  className="text-sm font-medium rounded-full px-2 py-0.5"
                  style={{ color: isToday ? 'var(--bg)' : 'var(--text-muted)', background: isToday ? 'var(--cyan)' : 'transparent' }}
                >
                  {format(day, 'd')}
                </span>
              </div>
            );
          })}
        </div>

        {/* All day events row */}
        {days.some((day) => {
          const dayStr = format(day, 'yyyy-MM-dd');
          return (eventsMap[dayStr] ?? []).some(e => e.allDay);
        }) && (
          <div className="grid" style={{ gridTemplateColumns: '48px repeat(7, 1fr)', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
            <div className="flex items-center justify-end pr-2" style={{ fontFamily: "var(--font-mono)", fontSize: '9px', color: 'var(--text-faint)' }}>ALL</div>
            {days.map((day) => {
              const dayStr = format(day, 'yyyy-MM-dd');
              const allDayEvents = (eventsMap[dayStr] ?? []).filter(e => e.allDay);
              return (
                <div key={dayStr} className="p-1 flex flex-col gap-0.5" style={{ borderLeft: '1px solid var(--border)', minHeight: 28 }}>
                  {allDayEvents.map((e) => (
                    <div key={e.id} className="text-xs truncate px-1.5 py-0.5 rounded" style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--green)', fontSize: '10px' }}>
                      {e.title}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* Time grid body */}
        <div className="relative grid" style={{ gridTemplateColumns: '48px repeat(7, 1fr)' }}>
          {/* Time labels column + hour lines */}
          <div style={{ position: 'relative' }}>
            {HOURS.map((h) => (
              <div
                key={h}
                className="flex items-start justify-end pr-2"
                style={{ height: HOUR_HEIGHT, fontFamily: "var(--font-mono)", fontSize: '9px', color: 'var(--text-faint)', paddingTop: 2, borderBottom: '1px solid var(--border)' }}
              >
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day) => {
            const dayStr = format(day, 'yyyy-MM-dd');
            const isToday = dayStr === today;
            const dayEvents = (eventsMap[dayStr] ?? []).filter(e => !e.allDay);
            const dayReminders = remindersByDate[dayStr] ?? [];

            return (
              <div
                key={dayStr}
                className="relative"
                style={{ borderLeft: '1px solid var(--border)', background: isToday ? 'rgba(6,182,212,0.03)' : 'transparent' }}
              >
                {/* Hour grid lines */}
                {HOURS.map((h) => (
                  <div key={h} style={{ height: HOUR_HEIGHT, borderBottom: '1px solid var(--border)' }} />
                ))}

                {/* Event cards (positioned absolutely) */}
                {dayEvents.map((e) => {
                  const start = getHourMinute(e.start);
                  const end = getHourMinute(e.end);
                  const topOffset = ((start.hour - HOURS[0]) + start.min / 60) * HOUR_HEIGHT;
                  const duration = ((end.hour - start.hour) + (end.min - start.min) / 60) * HOUR_HEIGHT;
                  const height = Math.max(duration, 20);

                  return (
                    <div
                      key={e.id}
                      className="absolute left-0.5 right-0.5 rounded px-1.5 py-0.5 overflow-hidden"
                      style={{
                        top: Math.max(topOffset, 0),
                        height,
                        background: 'rgba(16,185,129,0.15)',
                        borderLeft: '2px solid var(--green)',
                        fontSize: '10px',
                        color: 'var(--text)',
                        zIndex: 2,
                      }}
                    >
                      <div className="font-medium truncate" style={{ fontSize: '10px' }}>{e.title}</div>
                      <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "var(--font-mono)" }}>
                        {fmtTime(e.start)} — {fmtTime(e.end)}
                      </div>
                      {e.location && <div className="truncate" style={{ fontSize: '9px', color: 'var(--text-faint)' }}>{e.location}</div>}
                    </div>
                  );
                })}

                {/* Reminder cards */}
                {dayReminders.map((r) => {
                  const start = getHourMinute(r.scheduled_at);
                  const topOffset = ((start.hour - HOURS[0]) + start.min / 60) * HOUR_HEIGHT;

                  return (
                    <div
                      key={r.id}
                      className="absolute left-0.5 right-0.5 rounded px-1.5 py-0.5 cursor-pointer"
                      style={{
                        top: Math.max(topOffset, 0),
                        height: 22,
                        background: `${statusColor(r.status)}18`,
                        borderLeft: `2px solid ${statusColor(r.status)}`,
                        fontSize: '10px',
                        color: statusColor(r.status),
                        zIndex: 3,
                      }}
                      onClick={() => setSelectedReminder(r)}
                    >
                      <div className="flex items-center gap-1 truncate">
                        <Bell size={8} />
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: '9px' }}>{fmtTime(r.scheduled_at)}</span>
                        <span className="truncate">{r.title}</span>
                      </div>
                    </div>
                  );
                })}
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
            {selectedReminder.body && selectedReminder.body !== selectedReminder.title && (
              <div>
                <label style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>Body</label>
                <p className="text-sm" style={{ color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{selectedReminder.body}</p>
              </div>
            )}
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
                <label style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>Draft Message</label>
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
