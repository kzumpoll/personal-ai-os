/**
 * Rule-based day plan generator.
 * Takes wake time, calendar events, and tasks → produces a scheduled ScheduleBlock[].
 *
 * Schedule rules:
 *   - Work starts 30 minutes after wake (morning routine)
 *   - No separate "Work start" block in the output schedule
 *   - First work block is always "Clear Inbox" (60 min)
 *   - Order: Clear Inbox → MIT → K1 → K2 → calendar events (interspersed) → other tasks
 *   - Default durations: Clear Inbox 60min, MIT 90min, K1 60min, K2 60min, tasks 30min
 *   - Plan until 22:30 by default
 */

import { CalendarEvent } from './calendar';
import { ScheduleBlock } from '../db/queries/day_plans';

function parseHHMM(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function eventStartMinutes(e: CalendarEvent): number {
  if (e.allDay) return 8 * 60; // treat all-day as 08:00
  // ISO string: "2026-03-07T09:30:00+07:00"
  const timeStr = e.start.slice(11, 16); // "09:30"
  return parseHHMM(timeStr);
}

function eventDurationMinutes(e: CalendarEvent): number {
  if (e.allDay) return 30;
  try {
    const start = new Date(e.start).getTime();
    const end = new Date(e.end).getTime();
    return Math.round((end - start) / 60000);
  } catch {
    return 60;
  }
}

interface TaskSlot {
  title: string;
  type: ScheduleBlock['type'];
  duration_min: number;
}

export function generateDayPlan(params: {
  wakeTime: string;           // HH:MM
  calendarEvents: CalendarEvent[];
  mit?: string;
  k1?: string;
  k2?: string;
  otherTasks?: string[];      // task titles
  workEnd?: string;           // HH:MM, default 22:30
}): { schedule: ScheduleBlock[]; overflow: string[]; work_start: string } {
  const { wakeTime, calendarEvents, mit, k1, k2, otherTasks = [], workEnd = '22:30' } = params;

  const wakeMin = parseHHMM(wakeTime);
  const workStartMin = wakeMin + 30; // 30 min morning routine (was 60)
  const workEndMin = parseHHMM(workEnd);

  const schedule: ScheduleBlock[] = [];
  const overflow: string[] = [];

  // --- Fixed: wake block (no work_start block) ---
  schedule.push({ time: toHHMM(wakeMin), title: 'Wake up', type: 'wake', duration_min: 30 });

  // --- Calendar events (fixed, sorted) ---
  const sortedEvents = [...calendarEvents]
    .filter((e) => !e.allDay) // skip all-day events from timeline; they go at top
    .sort((a, b) => eventStartMinutes(a) - eventStartMinutes(b));

  const allDayEvents = calendarEvents.filter((e) => e.allDay);

  // Add all-day events as non-blocking note blocks at work_start
  for (const e of allDayEvents) {
    schedule.push({ time: toHHMM(workStartMin), title: `${e.title} (all day)`, type: 'event', duration_min: 0 });
  }

  // Build a simple free-slot tracker
  let cursor = workStartMin;

  // Define tasks to schedule in order:
  // Clear Inbox is ALWAYS first, then MIT → K1 → K2 → other tasks
  const taskSlots: TaskSlot[] = [];
  taskSlots.push({ title: 'Clear Inbox', type: 'task', duration_min: 60 });
  if (mit) taskSlots.push({ title: mit, type: 'mit', duration_min: 90 });
  if (k1)  taskSlots.push({ title: k1,  type: 'k1',  duration_min: 60 });
  if (k2)  taskSlots.push({ title: k2,  type: 'k2',  duration_min: 60 });
  for (const t of otherTasks) {
    taskSlots.push({ title: t, type: 'task', duration_min: 30 });
  }

  // Merge calendar events into a sorted list of occupied intervals
  const occupied: Array<{ start: number; end: number; title: string }> = sortedEvents.map((e) => ({
    start: eventStartMinutes(e),
    end: eventStartMinutes(e) + eventDurationMinutes(e),
    title: e.title,
  }));

  // Insert lunch: first free 30-min slot between 12:00 and 15:00
  const lunchWindowStart = 12 * 60; // 12:00
  const lunchWindowEnd = 15 * 60;   // 15:00
  let lunchPlaced = false;
  for (let t = lunchWindowStart; t <= lunchWindowEnd - 30 && !lunchPlaced; t += 15) {
    const conflict = occupied.find((o) => t < o.end && t + 30 > o.start);
    if (!conflict) {
      occupied.push({ start: t, end: t + 30, title: 'Lunch' });
      schedule.push({ time: toHHMM(t), title: 'Lunch', type: 'break', duration_min: 30 });
      lunchPlaced = true;
    }
  }

  // Add calendar events to schedule
  for (const e of sortedEvents) {
    schedule.push({
      time: toHHMM(eventStartMinutes(e)),
      title: e.title,
      type: 'event',
      duration_min: eventDurationMinutes(e),
    });
  }

  // Place tasks in free slots, advancing cursor past occupied time
  let lastPlacedEnd = workStartMin;
  for (const slot of taskSlots) {
    let placed = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      // Check if cursor conflicts with any event
      const conflict = occupied.find(
        (o) => cursor < o.end && cursor + slot.duration_min > o.start
      );
      if (conflict) {
        cursor = conflict.end + 10; // 10min buffer after events
        continue;
      }
      // Check if it fits before workEnd
      if (cursor + slot.duration_min > workEndMin) {
        overflow.push(slot.title);
        placed = true;
        break;
      }
      // Place it
      schedule.push({ time: toHHMM(cursor), title: slot.title, type: slot.type, duration_min: slot.duration_min });
      lastPlacedEnd = cursor + slot.duration_min;
      cursor += slot.duration_min + 10; // 10min break between tasks
      placed = true;
      break;
    }
    if (!placed) overflow.push(slot.title);
  }

  // Add a free time block at the end if there's room before 22:30
  const eveningEnd = parseHHMM('22:30');
  if (lastPlacedEnd < eveningEnd - 30) {
    schedule.push({
      time: toHHMM(lastPlacedEnd + 10),
      title: 'Free time',
      type: 'free',
      duration_min: eveningEnd - lastPlacedEnd - 10,
    });
  }

  // Sort schedule by time (wake block first, then chronological)
  const typeOrder: Record<string, number> = { wake: 0 };
  schedule.sort((a, b) => {
    const ao = typeOrder[a.type] ?? parseHHMM(a.time) + 2;
    const bo = typeOrder[b.type] ?? parseHHMM(b.time) + 2;
    if (ao !== bo) return ao - bo;
    return parseHHMM(a.time) - parseHHMM(b.time);
  });

  return { schedule, overflow, work_start: toHHMM(workStartMin) };
}

/** Format a ScheduleBlock[] as a readable Telegram message */
export function formatAgendaForBot(
  schedule: ScheduleBlock[],
  overflow: string[],
  planDate: string
): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const parts = planDate.split('-').map(Number);
  const dateLabel = parts.length === 3 ? `${months[parts[1] - 1]} ${String(parts[2]).padStart(2, '0')}` : planDate;

  const typeEmoji: Record<string, string> = {
    wake: '☀️',
    event: '📅',
    mit: '🎯',
    k1: '▶️',
    k2: '▷',
    task: '•',
    break: '☕',
    free: '⬜',
  };

  const lines: string[] = [`Agenda for ${dateLabel}:`];
  for (const block of schedule) {
    if (block.duration_min === 0) {
      lines.push(`${block.time} ${typeEmoji[block.type] ?? '•'} ${block.title}`);
    } else {
      lines.push(`${block.time} ${typeEmoji[block.type] ?? '•'} ${block.title} (${block.duration_min}min)`);
    }
  }

  if (overflow.length) {
    lines.push('');
    lines.push(`Overflow (didn't fit):`);
    overflow.forEach((t) => lines.push(`  • ${t}`));
  }

  return lines.join('\n');
}
