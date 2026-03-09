/**
 * Timezone-aware date utilities for the backend.
 *
 * Problem: Railway servers run in UTC. Without a timezone setting,
 * `new Date()` returns UTC time. For users in UTC+7, this means "today"
 * on the server could be yesterday or tomorrow from the user's perspective.
 *
 * Fix: Set USER_TZ=Asia/Bangkok (or any IANA timezone) in your Railway
 * environment variables. This file will use it automatically.
 *
 * Alternatively, set TZ=Asia/Bangkok in Railway env vars — Node.js
 * respects the TZ env var if set before process start.
 */

/** Returns today's date string (YYYY-MM-DD) in the user's configured timezone. */
export function getLocalToday(): string {
  const tz = process.env.USER_TZ || undefined;
  const d = new Date();
  if (tz) {
    // en-CA locale produces YYYY-MM-DD format reliably
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  }
  // Fallback: use local Node.js time (respects TZ env var if set at process start)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Returns tomorrow's date string (YYYY-MM-DD) in the user's configured timezone. */
export function getLocalTomorrow(): string {
  const today = getLocalToday();
  const d = new Date(today + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Returns a Date object set to noon of the given YYYY-MM-DD string (avoids DST shifts). */
export function toNoonDate(dateStr: string): Date {
  return new Date(dateStr + 'T12:00:00');
}
