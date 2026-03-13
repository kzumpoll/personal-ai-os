import { addDays, parseISO, format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import pool, { logDbError } from '@/lib/db';
import { getLocalToday } from '@/lib/date';
import { getEventsForDate, CalendarEvent } from '@/lib/calendar';
import PageHeader from '@/components/PageHeader';
import CalendarView from '@/components/CalendarView';

interface Reminder {
  id: string;
  title: string;
  body: string;
  scheduled_at: string;
  status: string;
  recipient_name: string | null;
  suggested_message: string | null;
  draft_message: string | null;
}

async function getData(dateParam?: string, view?: string) {
  const today = dateParam ?? getLocalToday();
  const base = parseISO(today + 'T12:00:00');

  // For week view: get the full week
  const weekStart = startOfWeek(base, { weekStartsOn: 1 }); // Monday
  const weekEnd = endOfWeek(base, { weekStartsOn: 1 });
  const monthStart = startOfMonth(base);
  const monthEnd = endOfMonth(base);

  const rangeStart = view === 'month' ? monthStart : weekStart;
  const rangeEnd = view === 'month' ? monthEnd : weekEnd;

  const startStr = format(rangeStart, 'yyyy-MM-dd');
  const endStr = format(addDays(rangeEnd, 1), 'yyyy-MM-dd');

  try {
    // Fetch reminders for range
    const { rows: reminders } = await pool.query<Reminder>(
      `SELECT id, title, body, scheduled_at, status, recipient_name, suggested_message, draft_message
       FROM reminders
       WHERE scheduled_at >= $1 AND scheduled_at < $2
       ORDER BY scheduled_at ASC`,
      [startStr + 'T00:00:00', endStr + 'T00:00:00']
    );

    // Fetch calendar events for each day in range
    const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
    const eventsMap: Record<string, CalendarEvent[]> = {};
    for (const day of days) {
      const dayStr = format(day, 'yyyy-MM-dd');
      try {
        eventsMap[dayStr] = await getEventsForDate(dayStr);
      } catch {
        eventsMap[dayStr] = [];
      }
    }

    // Fetch daily ROI reviews and inject as synthetic events at 08:00
    const { rows: roiReviews } = await pool.query<{ period_start: string; content: Record<string, unknown> }>(
      `SELECT period_start, content FROM reviews
       WHERE review_type = 'daily_roi' AND period_start >= $1 AND period_start < $2
       ORDER BY period_start ASC`,
      [startStr, endStr]
    );
    for (const roi of roiReviews) {
      const dayStr = typeof roi.period_start === 'string' ? roi.period_start.slice(0, 10) : String(roi.period_start).slice(0, 10);
      if (!eventsMap[dayStr]) eventsMap[dayStr] = [];
      const preview = typeof roi.content?.generated_list === 'string'
        ? roi.content.generated_list.slice(0, 80).replace(/\n/g, ' ') + '...'
        : 'Daily ROI';
      eventsMap[dayStr].unshift({
        id: `roi-${dayStr}`,
        title: `ROI: ${preview}`,
        start: `${dayStr}T08:00:00`,
        end: `${dayStr}T08:15:00`,
        allDay: false,
      });
    }

    // Upcoming reminders
    const { rows: upcoming } = await pool.query<Reminder>(
      `SELECT id, title, body, scheduled_at, status, recipient_name, suggested_message, draft_message
       FROM reminders
       WHERE status IN ('pending', 'snoozed') AND scheduled_at >= NOW()
       ORDER BY scheduled_at ASC LIMIT 20`
    );

    return { reminders, eventsMap, upcoming, today, rangeStart: startStr, rangeEnd: format(rangeEnd, 'yyyy-MM-dd') };
  } catch (err) {
    logDbError('calendar', err);
    return { reminders: [] as Reminder[], eventsMap: {} as Record<string, CalendarEvent[]>, upcoming: [] as Reminder[], today, rangeStart: startStr, rangeEnd: format(rangeEnd, 'yyyy-MM-dd') };
  }
}

export const dynamic = 'force-dynamic';

export default async function CalendarPage({ searchParams }: { searchParams: { date?: string; view?: string } }) {
  const view = searchParams.view ?? 'week';
  const { reminders, eventsMap, upcoming, today, rangeStart, rangeEnd } = await getData(searchParams.date, view);

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Calendar"
        subtitle={`${reminders.length} reminders this ${view}`}
      />
      <CalendarView
        reminders={reminders}
        eventsMap={eventsMap}
        upcoming={upcoming}
        today={today}
        view={view as 'week' | 'month'}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
      />
    </div>
  );
}
