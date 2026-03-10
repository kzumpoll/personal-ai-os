/**
 * Google Calendar reader for the Next.js dashboard (server-side only).
 *
 * Auth priority (first found wins):
 *   1. GOOGLE_CREDENTIALS_JSON + GOOGLE_TOKEN_JSON  — set these in Vercel for production.
 *   2. GOOGLE_CREDENTIALS_PATH + GOOGLE_TOKEN_PATH  — file paths for local dev.
 *
 * Returns [] gracefully if credentials are not configured.
 */
import fs from 'fs';
import { google, calendar_v3 } from 'googleapis';

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
}

function buildAuth() {
  try {
    let credentials: Record<string, unknown> | null = null;
    let token: Record<string, unknown> | null = null;

    // Priority 1: env vars (Vercel / production)
    if (process.env.GOOGLE_CREDENTIALS_JSON && process.env.GOOGLE_TOKEN_JSON) {
      credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
      token = JSON.parse(process.env.GOOGLE_TOKEN_JSON);
    }
    // Priority 2: file paths (local dev)
    else {
      const credPath = process.env.GOOGLE_CREDENTIALS_PATH;
      const tokenPath = process.env.GOOGLE_TOKEN_PATH;
      if (!credPath || !tokenPath) return null;
      if (!fs.existsSync(credPath) || !fs.existsSync(tokenPath)) return null;
      credentials = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
      token = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
    }

    if (!credentials || !token) return null;
    const { client_id, client_secret, redirect_uris } =
      (credentials.installed ?? credentials.web) as { client_id: string; client_secret: string; redirect_uris: string[] };
    const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    auth.setCredentials(token);
    return auth;
  } catch {
    return null;
  }
}

/**
 * Convert a YYYY-MM-DD date + HH:MM:SS time in a given IANA timezone to a UTC Date.
 */
function localTimeToUtc(dateStr: string, timeStr: string, tz: string): Date {
  const naive = new Date(`${dateStr}T${timeStr}.000Z`);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(naive);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const localAsUtcMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offsetMs = naive.getTime() - localAsUtcMs;
  return new Date(naive.getTime() + offsetMs);
}

export async function getEventsForDate(date: string): Promise<CalendarEvent[]> {
  const auth = buildAuth();
  if (!auth) return [];
  try {
    const cal = google.calendar({ version: 'v3', auth });
    const tz = process.env.USER_TZ ?? 'UTC';
    const dayStart = localTimeToUtc(date, '00:00:00', tz);
    const dayEnd   = localTimeToUtc(date, '23:59:59', tz);
    const res = await cal.events.list({
      calendarId: 'primary',
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      timeZone: tz,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 20,
    });
    return (res.data.items ?? []).map(parseEvent);
  } catch {
    return [];
  }
}

function parseEvent(e: calendar_v3.Schema$Event): CalendarEvent {
  const allDay = Boolean(e.start?.date && !e.start?.dateTime);
  return {
    id: e.id ?? '',
    title: e.summary ?? '(No title)',
    start: e.start?.dateTime ?? e.start?.date ?? '',
    end: e.end?.dateTime ?? e.end?.date ?? '',
    allDay,
    location: e.location ?? undefined,
  };
}

export function formatEventTime(iso: string): string {
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
    // Fallback: slice local-time part from offset-bearing ISO string
    return iso.slice(11, 16);
  } catch {
    return iso.slice(11, 16);
  }
}

export function isCalendarConfigured(): boolean {
  return buildAuth() !== null;
}
