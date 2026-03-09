/**
 * Timezone-aware date utilities for the dashboard (Vercel server components).
 *
 * Problem: Vercel server functions run in UTC. Without a timezone setting,
 * `new Date()` returns UTC time, so users in UTC+7 would see yesterday's date
 * until 07:00 local time.
 *
 * Fix: Set USER_TZ=Asia/Bangkok (or any IANA timezone) in Vercel environment
 * variables. This function will use it automatically. The variable is safe to
 * use server-side only (no NEXT_PUBLIC_ prefix needed).
 *
 * Alternatively, set TZ=Asia/Bangkok in Vercel env vars — Node.js respects
 * the TZ env var if set before process start.
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
