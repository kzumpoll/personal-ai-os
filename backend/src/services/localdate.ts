/**
 * Timezone-aware date utilities for the backend.
 *
 * All functions accept an optional `tz` parameter (IANA timezone string,
 * e.g. "Asia/Bangkok"). When omitted, they fall back to the USER_TZ env var,
 * then to the Node.js process timezone (which respects the TZ env var).
 *
 * Set USER_TZ=Asia/Bangkok in Railway environment variables to fix the UTC
 * vs local date mismatch for all date calculations.
 */

/** Returns today's date string (YYYY-MM-DD) in the given or configured timezone. */
export function getLocalToday(tz?: string): string {
  const timezone = tz ?? process.env.USER_TZ ?? undefined;
  const d = new Date();
  if (timezone) {
    // en-CA locale produces YYYY-MM-DD format reliably
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  }
  // Fallback: Node.js local time (respects TZ env var if set at process start)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Returns tomorrow's date string (YYYY-MM-DD) in the given or configured timezone. */
export function getLocalTomorrow(tz?: string): string {
  const today = getLocalToday(tz);
  const d = new Date(today + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Returns yesterday's date string (YYYY-MM-DD) in the given or configured timezone. */
export function getLocalYesterday(tz?: string): string {
  const today = getLocalToday(tz);
  const d = new Date(today + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Returns a Date object set to noon of the given YYYY-MM-DD string (avoids DST shifts). */
export function toNoonDate(dateStr: string): Date {
  return new Date(dateStr + 'T12:00:00');
}

/**
 * Returns the current local hour (0–23) in the given or configured timezone.
 * Used by determineDebriefDates to decide before/after 14:00.
 */
export function getLocalHour(tz?: string): number {
  const timezone = tz ?? process.env.USER_TZ ?? undefined;
  const now = new Date();
  if (timezone) {
    const hourStr = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).format(now);
    // en-US hour12:false returns "0"–"23" but may return "24" for midnight in some envs
    const h = parseInt(hourStr, 10);
    return isNaN(h) ? now.getHours() : h % 24;
  }
  return now.getHours();
}

/**
 * Returns the current local time as ISO 8601 string in the given timezone.
 * Example: "2026-03-13T14:30:00" (no offset — represents wall-clock time).
 */
export function getLocalNowIso(tz?: string): string {
  const timezone = tz ?? process.env.USER_TZ ?? undefined;
  const now = new Date();
  if (timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
  }
  return now.toISOString().slice(0, 19);
}

/**
 * Interprets a naive ISO datetime (without timezone offset) as being in the
 * given IANA timezone and returns a UTC ISO string suitable for TIMESTAMPTZ storage.
 *
 * If the input already has a timezone offset or 'Z' suffix, it is returned as-is.
 *
 * Example: naiveToUtc("2026-03-14T12:00:00", "Asia/Bangkok")
 *   → "2026-03-14T05:00:00.000Z"  (12:00 Bangkok = 05:00 UTC)
 */
export function naiveToUtc(naive: string, tz?: string): string {
  const timezone = tz ?? process.env.USER_TZ ?? 'UTC';
  // Already has offset or Z → pass through
  if (/[+-]\d{2}:\d{2}$/.test(naive) || /Z$/i.test(naive)) return naive;

  return naiveIsoToUtc(naive, timezone);
}

/** Alias for naiveToUtc — clearer name for callsites. */
export const localNaiveToUtcIso = naiveToUtc;

/**
 * Core conversion: interprets a naive ISO datetime as wall-clock time in the
 * given IANA timezone and returns a UTC ISO string.
 *
 * Uses a two-pass approach for DST safety:
 *   Pass 1 — treat the naive string as UTC, measure the timezone offset at that
 *            instant, and compute a first UTC estimate.
 *   Pass 2 — measure the offset again at the *estimated* UTC instant. If the
 *            offset changed (DST boundary fell between the two), use the second
 *            offset for the final result.
 *
 * This is correct for all IANA timezones including those with DST. Asia/Makassar
 * (WITA, fixed UTC+8) has no DST, but the algorithm works generically so that
 * reminders and events remain correct if USER_TZ ever changes.
 */
function naiveIsoToUtc(naive: string, timezone: string): string {
  const refUtc = new Date(naive + 'Z');
  if (isNaN(refUtc.getTime())) return naive; // unparseable — return as-is

  const offsetAtInstant = (instant: Date): number => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(instant);
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
    const localMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return localMs - instant.getTime();
  };

  // Pass 1: offset at the naive-as-UTC instant
  const offset1 = offsetAtInstant(refUtc);
  const estimate = new Date(refUtc.getTime() - offset1);

  // Pass 2: offset at the estimated UTC instant (may differ across DST boundary)
  const offset2 = offsetAtInstant(estimate);
  const correctedUtc = new Date(refUtc.getTime() - offset2);
  return correctedUtc.toISOString();
}

/**
 * Converts a wall-clock datetime string to UTC, **always stripping any Z suffix
 * or UTC offset first**. Use this instead of naiveToUtc when the source is known
 * to represent wall-clock time in USER_TZ (e.g. datetimes returned by the LLM
 * interpreter, which is instructed to return naive ISO strings but sometimes
 * appends Z or an offset anyway).
 *
 * Design note: we store reminders as TIMESTAMPTZ (UTC) + a separate `timezone`
 * column so the DB value is unambiguous. The scheduler compares against NOW() in
 * UTC, which is DST-proof. Display always converts back to the stored timezone.
 * This is cleaner than storing local time + computing UTC at send time because
 * the trigger query stays a simple `scheduled_at <= NOW()` with no per-row TZ
 * math, and the stored instant never becomes ambiguous during DST "fall back"
 * repeats (which don't affect Makassar today but would affect any DST timezone).
 */
export function wallClockToUtc(input: string, tz?: string): string {
  const timezone = tz ?? process.env.USER_TZ ?? 'UTC';
  // Strip any trailing Z or ±HH:MM offset — we know this is wall-clock time
  const naive = input.replace(/Z$/i, '').replace(/[+-]\d{2}:\d{2}$/, '');
  return naiveIsoToUtc(naive, timezone);
}

/**
 * Converts a UTC ISO string to local date/time parts in the given timezone.
 * Returns { year, month, day, hour, minute, second, weekday } for flexible formatting.
 */
export function utcIsoToLocalParts(utcIso: string, tz?: string): {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
  weekday: string; dateStr: string; timeStr: string;
} {
  const timezone = tz ?? process.env.USER_TZ ?? 'UTC';
  const d = new Date(utcIso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const second = Number(get('second'));
  const weekday = get('weekday');
  const dateStr = `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { year, month, day, hour, minute, second, weekday, dateStr, timeStr };
}

/**
 * Formats a UTC time range as local time in USER_TZ.
 * Example: formatLocalTimeRange("2026-03-14T03:00:00Z", "2026-03-14T04:00:00Z", "Asia/Makassar")
 *   → "11:00–12:00"
 */
export function formatLocalTimeRange(startUtc: string, endUtc: string, tz?: string): string {
  const s = utcIsoToLocalParts(startUtc, tz);
  const e = utcIsoToLocalParts(endUtc, tz);
  return `${s.timeStr}–${e.timeStr}`;
}

/**
 * Formats a UTC ISO string as a human-readable local datetime.
 * Example: "Sat Mar 14, 12:00 PM"
 */
export function formatLocalDateTime(utcIso: string, tz?: string): string {
  const timezone = tz ?? process.env.USER_TZ ?? 'UTC';
  return new Date(utcIso).toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
