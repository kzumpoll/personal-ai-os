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

  // Treat the naive string as a UTC instant to compute the local offset
  const refUtc = new Date(naive + 'Z');
  if (isNaN(refUtc.getTime())) return naive; // unparseable — return as-is

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(refUtc);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  const localAsUtcMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));

  // offset = localTime - utcTime
  const offsetMs = localAsUtcMs - refUtc.getTime();
  // The user meant this datetime in their local timezone → UTC = naive - offset
  const correctedUtc = new Date(refUtc.getTime() - offsetMs);
  return correctedUtc.toISOString();
}
