/**
 * Rule-based day plan generator.
 * Takes wake time, calendar events, and tasks → produces a scheduled ScheduleBlock[].
 *
 * Schedule rules:
 *   - Work starts 30 minutes after wake (morning routine)
 *   - No separate "Work start" block in the output schedule
 *   - First work block is always "Clear Inbox" (60 min)
 *   - Order: Clear Inbox → MIT → P1 → P2 → calendar events (interspersed) → other tasks
 *   - Default durations: Clear Inbox 60min, MIT 90min, P1 60min, P2 60min, tasks 30min
 *   - Plan until 22:30 by default
 *   - Lunch: always 30 min, placed in first free slot between 12:00–15:00
 *   - Pre-event buffer: 30 min "Prep / Leave" block added before physical activity events
 */

import { CalendarEvent } from './calendar';
import { ScheduleBlock } from '../db/queries/day_plans';

function isPadel(title: string): boolean {
  return title.toLowerCase().includes('padel');
}

// Shared emoji map — used by formatAgendaForBot and querySchedule
const TYPE_EMOJI: Record<string, string> = {
  wake: '☀️',
  event: '📅',
  mit: '🎯',
  p1: '▶️',
  p2: '▷',
  task: '•',
  break: '🍽️',
  travel: '🚗',
};

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
  p1?: string;
  p2?: string;
  otherTasks?: string[];      // task titles
  workEnd?: string;           // HH:MM, default 22:30
  ignoredEventIds?: string[]; // exact Google Calendar event IDs to exclude
}): { schedule: ScheduleBlock[]; overflow: string[]; work_start: string } {
  const {
    wakeTime, calendarEvents, mit, p1, p2,
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

  // Define tasks to schedule in order
  const taskSlots: TaskSlot[] = [];
  taskSlots.push({ title: 'Clear Inbox', type: 'task', duration_min: 60 });
  if (mit) taskSlots.push({ title: mit, type: 'mit', duration_min: 90 });
  if (p1)  taskSlots.push({ title: p1,  type: 'p1',  duration_min: 60 });
  if (p2)  taskSlots.push({ title: p2,  type: 'p2',  duration_min: 60 });
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
        schedule.push({ time: toHHMM(beforeStart), title: 'Travel to padel', type: 'travel', duration_min: 30 });
      }
    }

    // After buffer
    const afterEnd = eventEnd + 30;
    if (afterEnd <= workEndMin) {
      const conflict = occupied.find((o) => eventEnd < o.end && afterEnd > o.start && o.title !== e.title);
      if (!conflict) {
        occupied.push({ start: eventEnd, end: afterEnd, title: `Travel from padel (${e.title})` });
        schedule.push({ time: toHHMM(eventEnd), title: 'Travel from padel', type: 'travel', duration_min: 30 });
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

  // Build list of free gaps by subtracting occupied from [workStartMin, workEndMin]
  const sortedOcc = [...occupied].sort((a, b) => a.start - b.start);
  const gaps: Array<{ start: number; end: number }> = [];
  let gapCursor = workStartMin;
  for (const occ of sortedOcc) {
    if (occ.start > gapCursor) {
      gaps.push({ start: gapCursor, end: occ.start });
    }
    if (occ.end > gapCursor) gapCursor = occ.end;
  }
  if (gapCursor < workEndMin) {
    gaps.push({ start: gapCursor, end: workEndMin });
  }

  // Place tasks into gaps chronologically, skipping gaps < 15 min
  let gapIdx = 0;
  let gapPos = gaps.length > 0 ? gaps[0].start : workEndMin;
  for (const slot of taskSlots) {
    let placed = false;
    while (gapIdx < gaps.length) {
      const gap = gaps[gapIdx];
      const available = gap.end - gapPos;
      if (available < 15) { gapIdx++; gapPos = gapIdx < gaps.length ? gaps[gapIdx].start : workEndMin; continue; }
      if (slot.duration_min <= available) {
        schedule.push({ time: toHHMM(gapPos), title: slot.title, type: slot.type, duration_min: slot.duration_min });
        occupied.push({ start: gapPos, end: gapPos + slot.duration_min, title: slot.title });
        gapPos += slot.duration_min + 10; // 10-min buffer between tasks
        if (gapPos >= gap.end) { gapIdx++; gapPos = gapIdx < gaps.length ? gaps[gapIdx].start : workEndMin; }
        placed = true;
        break;
      }
      // Task doesn't fit in this gap — try next gap
      gapIdx++;
      gapPos = gapIdx < gaps.length ? gaps[gapIdx].start : workEndMin;
    }
    if (!placed) overflow.push(slot.title);
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
  completions?: { mit_done?: boolean; p1_done?: boolean; p2_done?: boolean }
): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const parts = planDate.split('-').map(Number);
  const dateLabel = parts.length === 3 ? `${months[parts[1] - 1]} ${String(parts[2]).padStart(2, '0')}` : planDate;

  const typeEmoji = TYPE_EMOJI;

  const isDone = (type: string): boolean => {
    if (type === 'mit') return completions?.mit_done ?? false;
    if (type === 'p1')  return completions?.p1_done  ?? false;
    if (type === 'p2')  return completions?.p2_done  ?? false;
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
    if (!newByTitle.has(title) && title !== 'Wake up') {
      changes.push(`Removed: ${title}`);
    }
  }

  // Blocks added
  for (const [title] of newByTitle) {
    if (!oldByTitle.has(title) && title !== 'Wake up') {
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

// ---------------------------------------------------------------------------
// Deterministic day plan querying — answer simple schedule questions without LLM
// ---------------------------------------------------------------------------

/**
 * Parse a flexible time string into minutes-since-midnight.
 * Accepts: "10:30", "14:00", "2pm", "2:30pm", "11am", "11:30am", bare hours >= 7.
 * Returns null for ambiguous bare hours 1–6 (no am/pm).
 */
export function parseFlexibleTime(s: string): number | null {
  const t = s.trim().toLowerCase();

  // HH:MM with am/pm: "2:30pm", "11:30am"
  const ampmMinMatch = t.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/);
  if (ampmMinMatch) {
    let h = parseInt(ampmMinMatch[1], 10);
    const m = parseInt(ampmMinMatch[2], 10);
    if (ampmMinMatch[3] === 'pm' && h < 12) h += 12;
    if (ampmMinMatch[3] === 'am' && h === 12) h = 0;
    return h * 60 + m;
  }

  // Bare hour with am/pm: "2pm", "11am"
  const ampmMatch = t.match(/^(\d{1,2})\s*(am|pm)$/);
  if (ampmMatch) {
    let h = parseInt(ampmMatch[1], 10);
    if (ampmMatch[2] === 'pm' && h < 12) h += 12;
    if (ampmMatch[2] === 'am' && h === 12) h = 0;
    return h * 60;
  }

  // HH:MM 24h: "14:00", "10:30"
  const hhmmMatch = t.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmmMatch) {
    const h = parseInt(hhmmMatch[1], 10);
    const m = parseInt(hhmmMatch[2], 10);
    return h * 60 + m;
  }

  // Bare hour: only accept >= 7 (unambiguous daytime)
  const bareMatch = t.match(/^(\d{1,2})$/);
  if (bareMatch) {
    const h = parseInt(bareMatch[1], 10);
    if (h >= 7 && h <= 23) return h * 60;
    return null; // ambiguous 1–6
  }

  return null;
}

function formatBlock(block: ScheduleBlock): string {
  const emoji = TYPE_EMOJI[block.type] ?? '•';
  const dur = block.duration_min > 0 ? ` (${block.duration_min}min)` : '';
  return `${block.time} ${emoji} ${block.title}${dur}`;
}

/**
 * Answer a simple schedule query deterministically from the schedule blocks.
 * Returns a formatted answer string, or null if the message is not a plan query.
 */
export function querySchedule(message: string, schedule: ScheduleBlock[]): string | null {
  if (schedule.length === 0) return null;

  const msg = message.trim().toLowerCase();

  // --- Time range: "between X and Y" / "from X to Y" ---
  const rangeMatch =
    msg.match(/(?:and\s+)?(?:between|from)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(?:and|to)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/) ??
    msg.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/);
  if (rangeMatch) {
    const startMin = parseFlexibleTime(rangeMatch[1]);
    const endMin = parseFlexibleTime(rangeMatch[2]);
    if (startMin === null || endMin === null) return null; // ambiguous time → let LLM handle
    return formatRangeAnswer(schedule, startMin, endMin);
  }

  // --- Relative: "after lunch", "what's after lunch", "after padel" ---
  const afterMatch = msg.match(/(?:what(?:'?s| is)\s+)?after\s+(.+?)[\s?.!]*$/);
  if (afterMatch) {
    const target = afterMatch[1].trim();
    const block = findBlockByTitle(schedule, target);
    if (!block) return null;
    const afterMin = parseHHMM(block.time) + block.duration_min;
    const after = schedule.filter((b) => parseHHMM(b.time) >= afterMin);
    if (after.length === 0) return `Nothing scheduled after ${block.title}.`;
    return `After ${block.title}:\n${after.map(formatBlock).join('\n')}`;
  }

  // --- Relative: "before padel", "what's before padel" ---
  const beforeMatch = msg.match(/(?:what(?:'?s| is)\s+)?before\s+(.+?)[\s?.!]*$/);
  if (beforeMatch) {
    const target = beforeMatch[1].trim();
    const block = findBlockByTitle(schedule, target);
    if (!block) return null;
    const blockStart = parseHHMM(block.time);
    const before = schedule.filter((b) => parseHHMM(b.time) + b.duration_min <= blockStart);
    if (before.length === 0) return `Nothing scheduled before ${block.title}.`;
    return `Before ${block.title}:\n${before.map(formatBlock).join('\n')}`;
  }

  // --- "what's next" / "next up" ---
  if (/(?:what(?:'?s| is)\s+next|next\s+up)\b/.test(msg)) {
    const nowMin = getCurrentMinutes();
    const next = schedule.find((b) => parseHHMM(b.time) >= nowMin && b.type !== 'wake');
    if (!next) return 'Nothing left on today\'s plan.';
    return `Next up:\n${formatBlock(next)}`;
  }

  return null;
}

function findBlockByTitle(schedule: ScheduleBlock[], query: string): ScheduleBlock | null {
  const q = query.toLowerCase();
  return schedule.find((b) => b.title.toLowerCase().includes(q)) ?? null;
}

function formatRangeAnswer(schedule: ScheduleBlock[], startMin: number, endMin: number): string {
  const blocks = schedule.filter((b) => {
    const bStart = parseHHMM(b.time);
    const bEnd = bStart + b.duration_min;
    // Block overlaps with the query range
    return bEnd > startMin && bStart < endMin;
  });

  const startStr = toHHMM(startMin);
  const endStr = toHHMM(endMin);

  if (blocks.length === 0) {
    const freeMin = endMin - startMin;
    return `Nothing scheduled between ${startStr} and ${endStr} — ${freeMin}min free.`;
  }

  // Calculate free time in range
  let scheduledMin = 0;
  for (const b of blocks) {
    const bStart = Math.max(parseHHMM(b.time), startMin);
    const bEnd = Math.min(parseHHMM(b.time) + b.duration_min, endMin);
    if (bEnd > bStart) scheduledMin += bEnd - bStart;
  }
  const freeMin = (endMin - startMin) - scheduledMin;

  const lines = [`Between ${startStr} and ${endStr}:`];
  for (const b of blocks) lines.push(formatBlock(b));
  if (freeMin > 0) lines.push(`(${freeMin}min free)`);
  return lines.join('\n');
}

function getCurrentMinutes(): number {
  const tz = process.env.USER_TZ;
  if (tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(new Date());
      const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
      const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
      return h * 60 + m;
    } catch { /* fall through */ }
  }
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}
