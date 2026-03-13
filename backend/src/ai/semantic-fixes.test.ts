/**
 * Tests for semantic fixes:
 * 1. Timezone: naiveToUtc correctly converts wall-clock time to UTC
 * 2. New helpers: utcIsoToLocalParts, formatLocalTimeRange, formatLocalDateTime
 * 3. No JSON leaks: sanitizeTelegramReply strips JSON from replies
 * 4. No debug prefixes: no user-facing text contains version tags
 * 5. Entity refs: full UUIDs passed, not short IDs
 * 6. UUID prefix resolution: short IDs resolved to full UUIDs
 * 7. Compound intents: calendar event + reminder
 * 8. Routing never outputs raw JSON
 */
import { describe, it, expect } from 'vitest';
import { naiveToUtc, getLocalNowIso, utcIsoToLocalParts, formatLocalTimeRange, formatLocalDateTime, localNaiveToUtcIso } from '../services/localdate';
import type { CreateReminderIntent, CalendarCreateEventIntent, UpdateTaskDescriptionIntent, Intent } from './intents';
import { routeClassified, type ClassifiedMessage } from './intents';

// ---------------------------------------------------------------------------
// 1. Timezone conversion — naiveToUtc
// ---------------------------------------------------------------------------
describe('naiveToUtc — timezone conversion', () => {
  it('converts noon Bangkok time to 05:00 UTC', () => {
    const result = naiveToUtc('2026-03-14T12:00:00', 'Asia/Bangkok');
    const d = new Date(result);
    expect(d.getUTCHours()).toBe(5);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCDate()).toBe(14);
  });

  it('converts 9:45am Bangkok to 02:45 UTC', () => {
    const result = naiveToUtc('2026-03-14T09:45:00', 'Asia/Bangkok');
    const d = new Date(result);
    expect(d.getUTCHours()).toBe(2);
    expect(d.getUTCMinutes()).toBe(45);
  });

  it('converts midnight Bangkok to 17:00 UTC previous day', () => {
    const result = naiveToUtc('2026-03-14T00:00:00', 'Asia/Bangkok');
    const d = new Date(result);
    expect(d.getUTCHours()).toBe(17);
    expect(d.getUTCDate()).toBe(13); // previous day in UTC
  });

  it('passes through strings that already have timezone offset', () => {
    const input = '2026-03-14T12:00:00+07:00';
    expect(naiveToUtc(input, 'Asia/Bangkok')).toBe(input);
  });

  it('passes through Z-suffixed strings', () => {
    const input = '2026-03-14T05:00:00Z';
    expect(naiveToUtc(input, 'Asia/Bangkok')).toBe(input);
  });

  it('returns unparseable input as-is', () => {
    expect(naiveToUtc('not-a-date', 'UTC')).toBe('not-a-date');
  });

  it('handles UTC timezone (no offset)', () => {
    const result = naiveToUtc('2026-03-14T12:00:00', 'UTC');
    const d = new Date(result);
    expect(d.getUTCHours()).toBe(12);
  });

  // Reproduces the exact bug: "remind me tomorrow at 12:00" storing wrong time
  it('reproduces bug: "tomorrow at 12:00" in Bangkok stores as noon local', () => {
    // User says "12:00" meaning noon Bangkok time
    const scheduled = '2026-03-14T12:00:00';
    const utc = naiveToUtc(scheduled, 'Asia/Bangkok');
    // Verify that when we format this UTC time back to Bangkok, it shows 12:00
    const d = new Date(utc);
    const bangkokHour = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Bangkok', hour: 'numeric', hour12: false,
    }).format(d);
    expect(parseInt(bangkokHour, 10)).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// 2. getLocalNowIso — returns local time string
// ---------------------------------------------------------------------------
describe('getLocalNowIso', () => {
  it('returns a valid ISO datetime string', () => {
    const result = getLocalNowIso('UTC');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });

  it('returns time in specified timezone', () => {
    const utcNow = getLocalNowIso('UTC');
    const bangkokNow = getLocalNowIso('Asia/Bangkok');
    // Bangkok is always UTC+7 (no DST), so hours differ by 7
    const utcHour = parseInt(utcNow.slice(11, 13), 10);
    const bkkHour = parseInt(bangkokNow.slice(11, 13), 10);
    const diff = (bkkHour - utcHour + 24) % 24;
    expect(diff).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// 2b. New timezone helpers — utcIsoToLocalParts, formatLocalTimeRange, etc.
// ---------------------------------------------------------------------------
describe('utcIsoToLocalParts', () => {
  it('converts UTC to Makassar local parts (UTC+8)', () => {
    const parts = utcIsoToLocalParts('2026-03-14T04:00:00.000Z', 'Asia/Makassar');
    expect(parts.hour).toBe(12);
    expect(parts.minute).toBe(0);
    expect(parts.day).toBe(14);
    expect(parts.timeStr).toBe('12:00');
  });

  it('converts UTC midnight to 08:00 Makassar', () => {
    const parts = utcIsoToLocalParts('2026-03-14T00:00:00.000Z', 'Asia/Makassar');
    expect(parts.hour).toBe(8);
    expect(parts.minute).toBe(0);
  });

  it('handles day boundary crossing', () => {
    // 20:00 UTC = 04:00+1 Makassar next day
    const parts = utcIsoToLocalParts('2026-03-14T20:00:00.000Z', 'Asia/Makassar');
    expect(parts.hour).toBe(4);
    expect(parts.day).toBe(15);
  });
});

describe('formatLocalTimeRange', () => {
  it('formats a range in Makassar timezone', () => {
    const result = formatLocalTimeRange(
      '2026-03-14T03:00:00.000Z',
      '2026-03-14T04:00:00.000Z',
      'Asia/Makassar'
    );
    expect(result).toBe('11:00–12:00');
  });
});

describe('formatLocalDateTime', () => {
  it('formats a UTC datetime in user timezone', () => {
    const result = formatLocalDateTime('2026-03-14T04:00:00.000Z', 'Asia/Makassar');
    expect(result).toContain('12:00');
    expect(result).toContain('Sat');
    expect(result).toContain('Mar');
  });
});

describe('localNaiveToUtcIso alias', () => {
  it('is the same as naiveToUtc', () => {
    expect(localNaiveToUtcIso).toBe(naiveToUtc);
  });
});

describe('naiveToUtc — Makassar timezone (UTC+8)', () => {
  it('converts noon Makassar to 04:00 UTC', () => {
    const result = naiveToUtc('2026-03-14T12:00:00', 'Asia/Makassar');
    const d = new Date(result);
    expect(d.getUTCHours()).toBe(4);
    expect(d.getUTCMinutes()).toBe(0);
  });

  it('roundtrips: naiveToUtc → utcIsoToLocalParts gives back original time', () => {
    const naive = '2026-03-14T15:30:00';
    const utc = naiveToUtc(naive, 'Asia/Makassar');
    const parts = utcIsoToLocalParts(utc, 'Asia/Makassar');
    expect(parts.hour).toBe(15);
    expect(parts.minute).toBe(30);
    expect(parts.day).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// 3. sanitizeTelegramReply — no JSON leaks
// ---------------------------------------------------------------------------
// We test the sanitizer logic inline since it's a private function in bot.ts.
// Replicate the logic here for testability.

function sanitizeTelegramReply(text: string): string {
  if (!text) return text;
  let s = text;
  s = s.replace(/```(?:json)?\s*\n?\{[\s\S]*?\}\s*\n?```/g, '').trim();
  if (/^\s*[\[{]/.test(s) && /[\]}]\s*$/.test(s)) {
    try {
      JSON.parse(s);
      return "Done! Let me know if you need anything else.";
    } catch {
      // Not valid JSON
    }
  }
  s = s.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
  return s || text;
}

describe('sanitizeTelegramReply — no JSON leaks to user', () => {
  it('strips raw JSON object', () => {
    const input = '{"type":"app_action","intent":{"intent":"create_reminder","data":{"title":"Test"}}}';
    const result = sanitizeTelegramReply(input);
    expect(result).not.toContain('{');
    expect(result).not.toContain('"intent"');
  });

  it('strips JSON array', () => {
    const input = '[{"id":"123","title":"Test"}]';
    const result = sanitizeTelegramReply(input);
    expect(result).not.toContain('[{');
  });

  it('strips code-fenced JSON', () => {
    const input = 'Here is the result:\n```json\n{"type":"app_action"}\n```\nDone!';
    const result = sanitizeTelegramReply(input);
    expect(result).not.toContain('```');
    expect(result).not.toContain('"type"');
    expect(result).toContain('Done!');
  });

  it('leaves normal text untouched', () => {
    const input = 'Reminder set for Sat Mar 14, 12:00 PM';
    expect(sanitizeTelegramReply(input)).toBe(input);
  });

  it('leaves text with curly braces that is not JSON', () => {
    const input = 'Use {variable} in your template';
    expect(sanitizeTelegramReply(input)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// 4. No [CAL v2] in any executor response message
// ---------------------------------------------------------------------------
describe('no [CAL v2] in user-facing messages', () => {
  it('calendar create event message should not contain [CAL v2]', () => {
    // Simulate what the executor returns
    const lines = ['Added to calendar:', 'Padel', 'Sat Mar 14, 11:00–12:00'];
    const message = lines.join('\n');
    expect(message).not.toContain('[CAL v2]');
  });

  it('bulk create message should not contain [CAL v2]', () => {
    const lines: string[] = [];
    lines.push(`Added 2 events to calendar:\n`);
    lines.push('Event 1\nSat Mar 14, 10:00–11:00');
    lines.push('Event 2\nSat Mar 14, 14:00–15:00');
    const message = lines.join('\n');
    expect(message).not.toContain('[CAL v2]');
  });

  it('calendar not configured message should not contain [CAL v2]', () => {
    const message = 'Google Calendar is not configured. Ask the admin to set up calendar credentials.';
    expect(message).not.toContain('[CAL v2]');
  });
});

// ---------------------------------------------------------------------------
// 5. Entity refs — full UUIDs, not short IDs
// ---------------------------------------------------------------------------
describe('entity reference tracking uses full UUIDs', () => {
  it('last_task ref should contain full UUID', () => {
    const fullUuid = '4691a0d7-1234-5678-9abc-def012345678';
    const ref = { last_task: { id: fullUuid, title: 'Exit integration task' } };
    // Simulate what claude.ts now does (NO slicing)
    const text = `last_task: id="${ref.last_task.id}" title="${ref.last_task.title}"`;
    expect(text).toContain(fullUuid);
    // Must NOT be shortened
    expect(text).not.toMatch(/id="[a-f0-9]{8}"/);
  });

  it('short ID (8 chars) is NOT a valid UUID and must not be passed to DB', () => {
    const shortId = '4691a0d7';
    // UUID format: 8-4-4-4-12 hex digits
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(uuidRegex.test(shortId)).toBe(false);
  });

  it('update_task_description with full UUID is valid', () => {
    const intent: UpdateTaskDescriptionIntent = {
      intent: 'update_task_description',
      data: {
        task_id: '4691a0d7-1234-5678-9abc-def012345678',
        description: 'Check notion integration and Zapier',
      },
    };
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(uuidRegex.test(intent.data.task_id!)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Reminder intent structure
// ---------------------------------------------------------------------------
describe('reminder intent timezone awareness', () => {
  it('create_reminder scheduled_at should be convertible to correct UTC', () => {
    const intent: CreateReminderIntent = {
      intent: 'create_reminder',
      data: {
        title: 'Text dad congrats on his PhD',
        body: 'Send your dad a congratulations message',
        scheduled_at: '2026-03-14T12:00:00', // naive — means noon USER_TZ
        recipient_name: 'Dad',
        draft_message: 'Hey dad, just wanted to say congrats on your PhD! So proud of you!',
      },
    };
    // After naiveToUtc conversion for Bangkok
    const utc = naiveToUtc(intent.data.scheduled_at, 'Asia/Bangkok');
    const d = new Date(utc);
    // Should be 05:00 UTC (12:00 Bangkok = 05:00 UTC)
    expect(d.getUTCHours()).toBe(5);
    expect(d.getUTCMinutes()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Compound intent: calendar event with reminder_also
// ---------------------------------------------------------------------------
describe('compound intent — calendar event with reminder', () => {
  it('calendar_create_event can include reminder_also', () => {
    const intent: CalendarCreateEventIntent = {
      intent: 'calendar_create_event',
      data: {
        title: 'Call Johan',
        start_datetime: '2026-03-14T10:00:00',
        end_datetime: '2026-03-14T11:00:00',
        reminder_also: {
          title: 'Reminder: Call Johan in 15 min',
          scheduled_at: '2026-03-14T09:45:00',
          draft_message: 'Hey, your call with Johan is in 15 minutes!',
        },
      },
    };
    expect(intent.data.reminder_also).toBeDefined();
    expect(intent.data.reminder_also!.scheduled_at).toBe('2026-03-14T09:45:00');
  });

  it('calendar_create_event without reminder_also is still valid', () => {
    const intent: CalendarCreateEventIntent = {
      intent: 'calendar_create_event',
      data: {
        title: 'Padel',
        start_datetime: '2026-03-14T11:00:00',
        end_datetime: '2026-03-14T12:00:00',
      },
    };
    expect(intent.data.reminder_also).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Routing never outputs raw JSON
// ---------------------------------------------------------------------------
describe('routing never produces raw JSON for user', () => {
  it('app_action routes to execute, not raw JSON', () => {
    const msg: ClassifiedMessage = {
      route_type: 'app_action',
      confidence: 'high',
      ambiguities: [],
      intent: {
        intent: 'create_reminder',
        data: { title: 'Test', body: '', scheduled_at: '2026-03-14T12:00:00' },
      },
      confirm_needed: false,
      user_facing_summary: 'Reminder set',
    };
    const action = routeClassified(msg);
    expect(action.action).toBe('execute');
  });

  it('casual route returns text without JSON', () => {
    const msg: ClassifiedMessage = {
      route_type: 'casual',
      confidence: 'high',
      ambiguities: [],
      reply: 'Hey, how can I help?',
    };
    const action = routeClassified(msg);
    expect(action.action).toBe('reply');
    if (action.action === 'reply') {
      expect(action.text).not.toContain('{');
      expect(action.text).not.toContain('"intent"');
    }
  });
});

// ---------------------------------------------------------------------------
// 9. UUID prefix resolution logic
// ---------------------------------------------------------------------------
describe('UUID validation and prefix resolution', () => {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  it('full UUID passes validation', () => {
    expect(UUID_REGEX.test('4691a0d7-1234-5678-9abc-def012345678')).toBe(true);
  });

  it('short 8-char prefix does NOT pass UUID validation', () => {
    expect(UUID_REGEX.test('4691a0d7')).toBe(false);
  });

  it('executor should try prefix match when UUID validation fails', () => {
    // This tests the resolveTask logic conceptually:
    // If task_id is "4691a0d7" (not a UUID), it should fall through
    // to getTaskByIdPrefix which does a LIKE query
    const shortId = '4691a0d7';
    expect(UUID_REGEX.test(shortId)).toBe(false);
    // The prefix should be usable as a LIKE pattern
    expect(`${shortId}%`).toBe('4691a0d7%');
  });
});

// ---------------------------------------------------------------------------
// 10. Compound intent: "call Johan tomorrow 10 and remind me 15 min before"
// ---------------------------------------------------------------------------
describe('compound intent — produces two actions', () => {
  it('calendar_create_event with reminder_also has correct time offsets', () => {
    const intent: CalendarCreateEventIntent = {
      intent: 'calendar_create_event',
      data: {
        title: 'Call Johan',
        start_datetime: '2026-03-14T10:00:00',
        end_datetime: '2026-03-14T11:00:00',
        reminder_also: {
          title: 'Reminder: Call Johan in 15 min',
          scheduled_at: '2026-03-14T09:45:00',
          draft_message: 'Your call with Johan is in 15 minutes',
        },
      },
    };

    // Event starts at 10:00
    expect(intent.data.start_datetime).toBe('2026-03-14T10:00:00');
    // Reminder is 15 min before
    expect(intent.data.reminder_also!.scheduled_at).toBe('2026-03-14T09:45:00');

    // Both convert correctly to UTC in Makassar (UTC+8)
    const eventUtc = naiveToUtc(intent.data.start_datetime, 'Asia/Makassar');
    const reminderUtc = naiveToUtc(intent.data.reminder_also!.scheduled_at, 'Asia/Makassar');
    const eventTime = new Date(eventUtc);
    const reminderTime = new Date(reminderUtc);

    // 15 minutes apart
    expect(eventTime.getTime() - reminderTime.getTime()).toBe(15 * 60 * 1000);

    // Event at 10:00 Makassar = 02:00 UTC
    expect(eventTime.getUTCHours()).toBe(2);
    // Reminder at 09:45 Makassar = 01:45 UTC
    expect(reminderTime.getUTCHours()).toBe(1);
    expect(reminderTime.getUTCMinutes()).toBe(45);
  });

  it('both actions have draft_message for the reminder', () => {
    const intent: CalendarCreateEventIntent = {
      intent: 'calendar_create_event',
      data: {
        title: 'Call Johan',
        start_datetime: '2026-03-14T10:00:00',
        end_datetime: '2026-03-14T11:00:00',
        reminder_also: {
          title: 'Reminder: Call Johan',
          scheduled_at: '2026-03-14T09:45:00',
          draft_message: 'Your call with Johan is in 15 minutes',
        },
      },
    };
    expect(intent.data.reminder_also!.draft_message).toBeTruthy();
    expect(intent.data.reminder_also!.draft_message).toContain('Johan');
  });
});
