import { format, addDays, parseISO } from 'date-fns';
import { getOverdueTasks, getTasksForDate, getTasksInRange } from '../db/queries/tasks';
import { getActiveGoals } from '../db/queries/goals';
import { getJournalByDate } from '../db/queries/journals';
import { getEventsForDate, CalendarEvent } from '../services/calendar';
import { getLocalToday, getLocalYesterday, getLocalTomorrow, getLocalHour } from '../services/localdate';

export interface ContextPack {
  today: string;
  tomorrow: string;
  overdue: Array<{ id: string; title: string; due_date: string | null }>;
  todayTasks: Array<{ id: string; title: string }>;
  tomorrowTasks: Array<{ id: string; title: string }>;
  next7Tasks: Array<{ id: string; title: string; due_date: string | null }>;
  goals: Array<{ id: string; title: string; target_date: string | null }>;
  todayJournal: { mit: string | null; k1: string | null; k2: string | null } | null;
  calendarEvents: CalendarEvent[];
}

function dateStr(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

export async function buildContextPack(now?: Date): Promise<ContextPack> {
  // Use timezone-aware today if no explicit date is provided (fixes UTC vs local timezone mismatch)
  const todayStr = now ? format(now, 'yyyy-MM-dd') : getLocalToday();
  const todayDate = parseISO(todayStr + 'T12:00:00');
  const tomorrowDate = addDays(todayDate, 1);
  const next7Start = addDays(tomorrowDate, 1);
  const next7End = addDays(todayDate, 7);

  const today = todayStr;
  const tomorrow = dateStr(tomorrowDate);

  const [overdue, todayTasks, tomorrowTasks, next7Tasks, goals, todayJournal, calendarEvents] = await Promise.all([
    getOverdueTasks(15),
    getTasksForDate(today, 15),
    getTasksForDate(tomorrow, 15),
    getTasksInRange(dateStr(next7Start), dateStr(next7End), 15),
    getActiveGoals(10),
    getJournalByDate(today),
    getEventsForDate(today),
  ]);

  return {
    today,
    tomorrow,
    overdue: overdue.map((t) => ({ id: t.id, title: t.title, due_date: t.due_date })),
    todayTasks: todayTasks.map((t) => ({ id: t.id, title: t.title })),
    tomorrowTasks: tomorrowTasks.map((t) => ({ id: t.id, title: t.title })),
    next7Tasks: next7Tasks.map((t) => ({ id: t.id, title: t.title, due_date: t.due_date })),
    goals: goals.map((g) => ({ id: g.id, title: g.title, target_date: g.target_date })),
    todayJournal: todayJournal
      ? { mit: todayJournal.mit, k1: todayJournal.k1, k2: todayJournal.k2 }
      : null,
    calendarEvents,
  };
}

export function contextPackToString(ctx: ContextPack): string {
  const lines: string[] = [`Today: ${ctx.today}`, `Tomorrow: ${ctx.tomorrow}`, ''];

  if (ctx.overdue.length) {
    lines.push(`OVERDUE (${ctx.overdue.length}):`);
    ctx.overdue.forEach((t) => lines.push(`  [${t.id.slice(0, 8)}] ${t.title} (due: ${t.due_date})`));
    lines.push('');
  }

  if (ctx.todayTasks.length) {
    lines.push(`TODAY (${ctx.todayTasks.length}):`);
    ctx.todayTasks.forEach((t) => lines.push(`  [${t.id.slice(0, 8)}] ${t.title}`));
    lines.push('');
  }

  if (ctx.tomorrowTasks.length) {
    lines.push(`TOMORROW (${ctx.tomorrowTasks.length}):`);
    ctx.tomorrowTasks.forEach((t) => lines.push(`  [${t.id.slice(0, 8)}] ${t.title}`));
    lines.push('');
  }

  if (ctx.next7Tasks.length) {
    lines.push(`NEXT 7 DAYS (${ctx.next7Tasks.length}):`);
    ctx.next7Tasks.forEach((t) =>
      lines.push(`  [${t.id.slice(0, 8)}] ${t.title} (due: ${t.due_date})`)
    );
    lines.push('');
  }

  if (ctx.goals.length) {
    lines.push(`GOALS (${ctx.goals.length}):`);
    ctx.goals.forEach((g) =>
      lines.push(`  [${g.id.slice(0, 8)}] ${g.title}${g.target_date ? ` (target: ${g.target_date})` : ''}`)
    );
    lines.push('');
  }

  if (ctx.todayJournal) {
    lines.push(`TODAY'S JOURNAL:`);
    if (ctx.todayJournal.mit) lines.push(`  MIT: ${ctx.todayJournal.mit}`);
    if (ctx.todayJournal.k1) lines.push(`  K1: ${ctx.todayJournal.k1}`);
    if (ctx.todayJournal.k2) lines.push(`  K2: ${ctx.todayJournal.k2}`);
    lines.push('');
  }

  if (ctx.calendarEvents.length) {
    lines.push(`TODAY'S CALENDAR (${ctx.calendarEvents.length}):`);
    ctx.calendarEvents.forEach((e) => {
      if (e.allDay) {
        lines.push(`  • ${e.title} (all day)`);
      } else {
        const startStr = e.start.slice(11, 16);
        const endStr = e.end.slice(11, 16);
        lines.push(`  • ${startStr}–${endStr} ${e.title}${e.location ? ` @ ${e.location}` : ''}`);
      }
    });
  }

  return lines.join('\n').trim();
}

export function determineDebriefDates(): { debriefDate: string; planDate: string } {
  // All date strings are derived from getLocalToday/Yesterday/Tomorrow, which respect
  // USER_TZ env var. This ensures debrief dates match the user's local day, not UTC.
  const tz = process.env.USER_TZ || undefined;
  const hour = getLocalHour(tz);
  const today = getLocalToday(tz);
  const yesterday = getLocalYesterday(tz);
  const tomorrow = getLocalTomorrow(tz);

  if (hour >= 14) {
    // After 2pm local time: debrief today, plan tomorrow
    return { debriefDate: today, planDate: tomorrow };
  } else {
    // Before 2pm local time: debrief yesterday, plan today
    return { debriefDate: yesterday, planDate: today };
  }
}
