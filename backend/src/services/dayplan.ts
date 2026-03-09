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
 *   - Lunch: always 30 min, placed in first free slot between 12:00–15:00
 *   - Pre-event buffer: 30 min "Prep / Leave" block added before physical activity events
 */

import { CalendarEvent } from './calendar';
import { ScheduleBlock } from '../db/queries/day_plans';

// Physical activity keywords that trigger a 30-min prep/travel buffer before the event
const PHYSICAL_KEYWORDS = [
  'padel', 'training', 'gym', 'workout', 'lesson', 'tennis', 'football',
  'soccer', 'swimming', 'yoga', 'pilates', 'crossfit', 'boxing', 'hiking',
  'cycling', 'run', 'jog', 'class', 'basketball', 'volleyball',
];

function needsPrepBuffer(title: string): boolean {
  const lower = title.toLowerCase();
  return PHYSICAL_KEYWORDS.some((k) => lower.includes(k));
}

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
  ignoredEventIds?: string[]; // exact Google Calendar event IDs to exclude
}): { schedule: ScheduleBlock[]; overflow: string[]; work_start: string } {
  const {
    wakeTime, calendarEvents, mit, k1, k2,
    otherTasks = [], workEnd = '22:30',
    ignoredEventIds = [],
  } = params;

  const wakeMin = parseHHMM(wakeTime);
  const workStartMin = wakeMin + 30; // 30 min morning routine
  const workEndMin = parseHHMM(workEnd);

  const schedule: ScheduleBlock[] = [];
  const overflow: string[] = [];

  // --- Fixed: wake block ---
  schedule.push({ time: toHHMM(wakeMin), title: 'Wake up', type: 'wake', duration_min: 30 });

  // --- Filter out ignored events (matched by exact Google Calendar event ID) ---
  const ignoredSet = new Set(ignoredEventIds);
  const filteredEvents = calendarEvents.filter((e) => !ignoredSet.has(e.id));

  // --- Calendar events (fixed, sorted) ---
  const sortedEvents = [...filteredEvents]
    .filter((e) => !e.allDay)
    .sort((a, b) => eventStartMinutes(a) - eventStartMinutes(b));

  const allDayEvents = filteredEvents.filter((e) => e.allDay);

  // Add all-day events as non-blocking note blocks at work_start
  for (const e of allDayEvents) {
    schedule.push({ time: toHHMM(workStartMin), title: `${e.title} (all day)`, type: 'event', duration_min: 0 });
  }

  // Build a simple free-slot tracker
  let cursor = workStartMin;

  // Define tasks to schedule in order
  const taskSlots: TaskSlot[] = [];
  taskSlots.push({ title: 'Clear Inbox', type: 'task', duration_min: 60 });
  if (mit) taskSlots.push({ title: mit, type: 'mit', duration_min: 90 });
  if (k1)  taskSlots.push({ title: k1,  type: 'k1',  duration_min: 60 });
  if (k2)  taskSlots.push({ title: k2,  type: 'k2',  duration_min: 60 });
  for (const t of otherTasks) {
    taskSlots.push({ title: t, type: 'task', duration_min: 30 });
  }

  // Step 1: Add ALL calendar events to occupied first (deterministic priority order)
  const occupied: Array<{ start: number; end: number; title: string }> = [];

  for (const e of sortedEvents) {
    const eventStart = eventStartMinutes(e);
    const eventEnd = eventStart + eventDurationMinutes(e);
    occupied.push({ start: eventStart, end: eventEnd, title: e.title });
  }

  // Step 2: Add prep buffers for physical activity events, only where they don't conflict
  for (const e of sortedEvents) {
    if (!needsPrepBuffer(e.title)) continue;
    const eventStart = eventStartMinutes(e);
    const bufferStart = eventStart - 30;
    if (bufferStart < workStartMin) continue;
    const conflict = occupied.find((o) => bufferStart < o.end && eventStart > o.start && o.title !== e.title);
    if (!conflict) {
      occupied.push({ start: bufferStart, end: eventStart, title: `Prep / Leave (${e.title})` });
      schedule.push({ time: toHHMM(bufferStart), title: `Prep / Leave`, type: 'break', duration_min: 30 });
    }
  }

  // Step 3: Insert lunch — first free 30-min slot between 12:00 and 15:00
  const lunchWindowStart = 12 * 60;
  const lunchWindowEnd = 15 * 60;
  let lunchPlaced = false;
  for (let t = lunchWindowStart; t <= lunchWindowEnd - 30 && !lunchPlaced; t += 15) {
    const conflict = occupied.find((o) => t < o.end && t + 30 > o.start);
    if (!conflict) {
      occupied.push({ start: t, end: t + 30, title: 'Lunch' });
      schedule.push({ time: toHHMM(t), title: 'Lunch', type: 'break', duration_min: 30 });
      lunchPlaced = true;
    }
  }

  // Step 4: Add calendar events to schedule (display only — already in occupied)
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
      const conflict = occupied.find(
        (o) => cursor < o.end && cursor + slot.duration_min > o.start
      );
      if (conflict) {
        cursor = conflict.end + 10; // 10min buffer after events
        continue;
      }
      if (cursor + slot.duration_min > workEndMin) {
        overflow.push(slot.title);
        placed = true;
        break;
      }
      schedule.push({ time: toHHMM(cursor), title: slot.title, type: slot.type, duration_min: slot.duration_min });
      lastPlacedEnd = cursor + slot.duration_min;
      cursor += slot.duration_min + 10;
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

/**
 * Compare two versions of a day plan and return a human-readable summary of what changed.
 * Returns null if there are no meaningful differences.
 */
export function diffDayPlans(
  oldSchedule: ScheduleBlock[],
  oldOverflow: string[],
  newSchedule: ScheduleBlock[],
  newOverflow: string[],
  oldWakeTime: string | null,
  newWakeTime: string | null
): string | null {
  const changes: string[] = [];

  if (oldWakeTime && newWakeTime && oldWakeTime !== newWakeTime) {
    changes.push(`Wake time: ${oldWakeTime} → ${newWakeTime}`);
  }

  const oldByTitle = new Map(oldSchedule.map((b) => [b.title, b.time]));
  const newByTitle = new Map(newSchedule.map((b) => [b.title, b.time]));

  // Blocks removed
  for (const [title] of oldByTitle) {
    if (!newByTitle.has(title) && title !== 'Free time' && title !== 'Wake up') {
      changes.push(`Removed: ${title}`);
    }
  }

  // Blocks added
  for (const [title] of newByTitle) {
    if (!oldByTitle.has(title) && title !== 'Free time' && title !== 'Wake up') {
      changes.push(`Added: ${title}`);
    }
  }

  // Blocks that shifted time
  for (const [title, newTime] of newByTitle) {
    const oldTime = oldByTitle.get(title);
    if (oldTime && oldTime !== newTime) {
      changes.push(`${title} moved to ${newTime}`);
    }
  }

  // Overflow changes
  const addedOverflow = newOverflow.filter((t) => !oldOverflow.includes(t));
  const removedOverflow = oldOverflow.filter((t) => !newOverflow.includes(t));
  for (const t of addedOverflow)   changes.push(`${t} moved to overflow (unscheduled)`);
  for (const t of removedOverflow) changes.push(`${t} moved back into schedule`);

  if (changes.length === 0) return null;
  return changes.map((c) => `• ${c}`).join('\n');
}
