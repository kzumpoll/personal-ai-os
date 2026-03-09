/**
 * Timezone-aware date utilities for the dashboard (Vercel server components).
 *
 * All functions accept an optional `tz` parameter (IANA timezone string,
 * e.g. "Asia/Bangkok"). When omitted, they fall back to the USER_TZ env var,
 * then to the Node.js process timezone.
 *
 * Set USER_TZ=Asia/Bangkok in Vercel environment variables to fix the UTC
 * vs local date mismatch on the server.
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
