/**
 * Google Calendar service — read-only, main calendar only.
 *
 * Auth priority (first found wins):
 *   1. GOOGLE_CREDENTIALS_JSON + GOOGLE_TOKEN_JSON  — env vars holding the raw JSON strings.
 *      Use this in production (Railway). Set each var to the full JSON content.
 *   2. GOOGLE_CREDENTIALS_PATH + GOOGLE_TOKEN_PATH  — file paths (local dev fallback).
 *      Run `npx tsx src/scripts/google-auth.ts` once to generate the token file.
 *
 * If neither is configured all functions return [] gracefully.
 */

import fs from 'fs';
import { google, calendar_v3 } from 'googleapis';
import { format } from 'date-fns';

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;   // ISO or date string
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
}

export interface CalendarDiagnostics {
  configured: boolean;
  reason?: string;        // why it's not configured
  event_count?: number;   // events fetched today (if configured + successful)
  fetch_error?: string;   // set if configured but fetch failed
}

// Internal type for detailed auth result
type AuthResult =
  | { auth: InstanceType<typeof google.auth.OAuth2>; reason?: never }
  | { auth: null; reason: string };

function buildAuthWithReason(): AuthResult {
  try {
    let credentials: Record<string, unknown> | null = null;
    let token: Record<string, unknown> | null = null;

    // Priority 1: env vars (production / Railway)
    if (process.env.GOOGLE_CREDENTIALS_JSON || process.env.GOOGLE_TOKEN_JSON) {
      if (!process.env.GOOGLE_CREDENTIALS_JSON) {
        return { auth: null, reason: 'GOOGLE_CREDENTIALS_JSON missing (GOOGLE_TOKEN_JSON is set but credentials are not)' };
      }
      if (!process.env.GOOGLE_TOKEN_JSON) {
        return { auth: null, reason: 'GOOGLE_TOKEN_JSON missing (GOOGLE_CREDENTIALS_JSON is set but token is not)' };
      }
      try {
        credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
      } catch {
        return { auth: null, reason: 'json_parse_error: GOOGLE_CREDENTIALS_JSON is not valid JSON' };
      }
      try {
        token = JSON.parse(process.env.GOOGLE_TOKEN_JSON);
      } catch {
        return { auth: null, reason: 'json_parse_error: GOOGLE_TOKEN_JSON is not valid JSON' };
      }
    }
    // Priority 2: file paths (local dev)
    else {
      const credPath = process.env.GOOGLE_CREDENTIALS_PATH;
      const tokenPath = process.env.GOOGLE_TOKEN_PATH;
      if (!credPath && !tokenPath) {
        return { auth: null, reason: 'no credentials configured — set GOOGLE_CREDENTIALS_JSON + GOOGLE_TOKEN_JSON for production' };
      }
      if (!credPath) return { auth: null, reason: 'GOOGLE_CREDENTIALS_PATH not set' };
      if (!tokenPath) return { auth: null, reason: 'GOOGLE_TOKEN_PATH not set' };
      if (!fs.existsSync(credPath)) return { auth: null, reason: `credentials file not found: ${credPath}` };
      if (!fs.existsSync(tokenPath)) return { auth: null, reason: `token file not found: ${tokenPath}` };
      try { credentials = JSON.parse(fs.readFileSync(credPath, 'utf-8')); }
      catch { return { auth: null, reason: `json_parse_error: credentials file at ${credPath} is not valid JSON` }; }
      try { token = JSON.parse(fs.readFileSync(tokenPath, 'utf-8')); }
      catch { return { auth: null, reason: `json_parse_error: token file at ${tokenPath} is not valid JSON` }; }
    }

    if (!credentials || !token) return { auth: null, reason: 'credentials or token resolved to null' };

    const clientData = (credentials.installed ?? credentials.web) as {
      client_id?: string;
      client_secret?: string;
      redirect_uris?: string[];
    } | undefined;

    if (!clientData?.client_id || !clientData?.client_secret) {
      return { auth: null, reason: 'credentials JSON missing client_id or client_secret' };
    }

    const auth = new google.auth.OAuth2(
      clientData.client_id,
      clientData.client_secret,
      clientData.redirect_uris?.[0]
    );
    auth.setCredentials(token);
    return { auth };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { auth: null, reason: `unexpected error during auth init: ${msg}` };
  }
}

function buildAuth(): InstanceType<typeof google.auth.OAuth2> | null {
  return buildAuthWithReason().auth;
}

/**
 * Convert a YYYY-MM-DD date + HH:MM:SS time in a given IANA timezone to a UTC Date.
 * Example: localTimeToUtc('2026-03-07', '00:00:00', 'Asia/Bangkok') → 2026-03-06T17:00:00.000Z
 */
function localTimeToUtc(dateStr: string, timeStr: string, tz: string): Date {
  // Step 1: treat the naive time as UTC to get a rough reference point
  const naive = new Date(`${dateStr}T${timeStr}.000Z`);

  // Step 2: find what clock time this UTC moment shows in the target timezone
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(naive);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');

  // Step 3: compute the timezone offset as: naiveUTC - localAsUtc
  // e.g. UTC+7: naive=00:00Z, local shows 07:00 → localAsUtcMs=07:00Z → offset=-7h
  const localAsUtcMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offsetMs = naive.getTime() - localAsUtcMs;

  // Step 4: shift the naive UTC time by the offset to get the correct UTC boundary
  // e.g. 00:00Z + (-7h) = 17:00Z previous day = midnight Bangkok ✓
  return new Date(naive.getTime() + offsetMs);
}

/**
 * Fetch events for a specific date (YYYY-MM-DD) from the primary calendar.
 * Uses USER_TZ timezone so that midnight boundaries match the user's local day,
 * not the server's UTC day. Returns [] if credentials are not configured or the API call fails.
 */
export async function getEventsForDate(date: string): Promise<CalendarEvent[]> {
  const result = buildAuthWithReason();
  if (!result.auth) return [];

  try {
    const calendar = google.calendar({ version: 'v3', auth: result.auth });
    const tz = process.env.USER_TZ ?? 'UTC';
    const dayStart = localTimeToUtc(date, '00:00:00', tz);
    const dayEnd = localTimeToUtc(date, '23:59:59', tz);

    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      timeZone: tz,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 20,
    });

    const events = (res.data.items ?? []).map((e) => parseEvent(e));
    console.log(`[calendar] fetched ${events.length} event(s) for ${date}`);
    return events;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[calendar] getEventsForDate(${date}) failed: ${msg}`);
    return [];
  }
}

function parseEvent(e: calendar_v3.Schema$Event): CalendarEvent {
  const allDay = Boolean(e.start?.date && !e.start?.dateTime);
  const start = e.start?.dateTime ?? e.start?.date ?? '';
  const end = e.end?.dateTime ?? e.end?.date ?? '';
  return {
    id: e.id ?? '',
    title: e.summary ?? '(No title)',
    start,
    end,
    allDay,
    location: e.location ?? undefined,
    description: e.description ?? undefined,
  };
}

/**
 * Format events for display in Telegram messages.
 */
export function formatEventsForBot(events: CalendarEvent[], date: string): string {
  if (events.length === 0) return `No calendar events for ${date}.`;
  const lines = events.map((e) => {
    if (e.allDay) return `• ${e.title} (all day)`;
    const startStr = formatTime(e.start);
    const endStr = formatTime(e.end);
    return `• ${startStr}–${endStr} ${e.title}${e.location ? ` @ ${e.location}` : ''}`;
  });
  return `Calendar — ${format(new Date(date + 'T12:00:00'), 'MMM d')}:\n${lines.join('\n')}`;
}

function formatTime(iso: string): string {
  try {
    const tz = process.env.USER_TZ;
    const d = new Date(iso);
    if (tz) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(d);
      const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
      const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
      return `${h}:${m}`;
    }
    // Fallback: slice the local-time part from the ISO string if it has an offset
    // e.g. "2026-03-10T09:30:00+08:00" → "09:30"
    return iso.slice(11, 16);
  } catch {
    return iso.slice(11, 16);
  }
}

/**
 * Returns true if the Google Calendar is configured and accessible.
 */
export function isCalendarConfigured(): boolean {
  return buildAuth() !== null;
}

/**
 * Returns a diagnostics object for startup logging and /debug/calendar.
 * Attempts to fetch today's events to confirm the auth token is valid.
 */
export async function getCalendarDiagnostics(): Promise<CalendarDiagnostics> {
  const authResult = buildAuthWithReason();
  if (!authResult.auth) {
    return { configured: false, reason: authResult.reason };
  }

  const today = format(new Date(), 'yyyy-MM-dd');
  try {
    const calendar = google.calendar({ version: 'v3', auth: authResult.auth });
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date(`${today}T00:00:00`).toISOString(),
      timeMax: new Date(`${today}T23:59:59`).toISOString(),
      singleEvents: true,
      maxResults: 20,
    });
    return { configured: true, event_count: res.data.items?.length ?? 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[calendar] diagnostics fetch failed: ${msg}`);
    return { configured: true, fetch_error: msg };
  }
}

/**
 * Simple boolean live-connection check.
 */
export async function verifyCalendarConnection(): Promise<boolean> {
  const diag = await getCalendarDiagnostics();
  return diag.configured && !diag.fetch_error;
}
