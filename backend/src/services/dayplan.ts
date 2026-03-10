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

function isPadel(title: string): boolean {
  return title.toLowerCase().includes('padel');
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

/**
 * Convert an ISO timestamp to minutes-since-midnight in USER_TZ.
 * This correctly handles events stored in any timezone (including UTC Z-suffixed).
 * Falls back to slicing position 11–16 only if USER_TZ is unset.
 */
function isoToLocalMinutes(iso: string): number {
  const tz = process.env.USER_TZ;
  if (tz) {
    try {
      const d = new Date(iso);
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(d);
      const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
      const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
      return h * 60 + m;
    } catch {
      // fall through to slice fallback
    }
  }
  // Fallback: works only if the ISO string already carries a matching offset
  return parseHHMM(iso.slice(11, 16));
}

function eventStartMinutes(e: CalendarEvent): number {
  if (e.allDay) return 8 * 60; // treat all-day as 08:00
  return isoToLocalMinutes(e.start);
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

  // Step 2: Padel travel buffers — 30 min before ("Travel to padel") + 30 min after ("Travel from padel").
  // Only applied to events containing "padel". No buffers for any other event type.
  for (const e of sortedEvents) {
    if (!isPadel(e.title)) continue;
    const eventStart = eventStartMinutes(e);
    const eventEnd = eventStart + eventDurationMinutes(e);

    // Before buffer
    const beforeStart = eventStart - 30;
    if (beforeStart >= workStartMin) {
      const conflict = occupied.find((o) => beforeStart < o.end && eventStart > o.start && o.title !== e.title);
      if (!conflict) {
        occupied.push({ start: beforeStart, end: eventStart, title: `Travel to padel (${e.title})` });
        schedule.push({ time: toHHMM(beforeStart), title: 'Travel to padel', type: 'break', duration_min: 30 });
      }
    }

    // After buffer
    const afterEnd = eventEnd + 30;
    if (afterEnd <= workEndMin) {
      const conflict = occupied.find((o) => eventEnd < o.end && afterEnd > o.start && o.title !== e.title);
      if (!conflict) {
        occupied.push({ start: eventEnd, end: afterEnd, title: `Travel from padel (${e.title})` });
        schedule.push({ time: toHHMM(eventEnd), title: 'Travel from padel', type: 'break', duration_min: 30 });
      }
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
  planDate: string,
  completions?: { mit_done?: boolean; k1_done?: boolean; k2_done?: boolean }
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

  const isDone = (type: string): boolean => {
    if (type === 'mit') return completions?.mit_done ?? false;
    if (type === 'k1')  return completions?.k1_done  ?? false;
    if (type === 'k2')  return completions?.k2_done  ?? false;
    return false;
  };

  const lines: string[] = [`Day Plan for ${dateLabel}:`];
  for (const block of schedule) {
    const done = isDone(block.type);
    const emoji = done ? '✅' : (typeEmoji[block.type] ?? '•');
    const title = done ? `${block.title} ✓` : block.title;
    if (block.duration_min === 0) {
      lines.push(`${block.time} ${emoji} ${title}`);
    } else {
      lines.push(`${block.time} ${emoji} ${title} (${block.duration_min}min)`);
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
