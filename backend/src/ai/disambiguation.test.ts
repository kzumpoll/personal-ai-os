/**
 * Disambiguation tests for reminder vs calendar and task description routing.
 *
 * These tests verify:
 * 1. Reminder intents are structurally correct (not calendar_create_event)
 * 2. Task description intents don't reference calendar lookup
 * 3. Clarify intent supports options array
 * 4. Entity refs are properly typed
 * 5. routeClassified handles clarify with low confidence correctly
 */
import { describe, it, expect } from 'vitest';
import type {
  CreateReminderIntent,
  UpdateTaskDescriptionIntent,
  CalendarCreateEventIntent,
  Intent,
} from './intents';
import { routeClassified, type ClassifiedMessage } from './intents';
import type { EntityRefs } from './claude';

// ---------------------------------------------------------------------------
// Test 1: Reminder intents are structurally distinct from calendar events
// ---------------------------------------------------------------------------
describe('reminder vs calendar event disambiguation', () => {
  it('create_reminder intent has correct structure', () => {
    const intent: CreateReminderIntent = {
      intent: 'create_reminder',
      data: {
        title: 'Send dad a message',
        body: 'Wish him luck for the interview',
        scheduled_at: '2026-03-12T12:00:00',
        recipient_name: 'Dad',
        draft_message: 'Hey dad, just wanted to wish you good luck today!',
      },
    };
    expect(intent.intent).toBe('create_reminder');
    expect(intent.data.draft_message).toBeDefined();
    expect(intent.data.scheduled_at).toContain('T');
  });

  it('create_reminder is a different intent type from calendar_create_event', () => {
    const reminder: CreateReminderIntent = {
      intent: 'create_reminder',
      data: { title: 'Call mom', body: '', scheduled_at: '2026-03-12T15:00:00' },
    };
    const calEvent: CalendarCreateEventIntent = {
      intent: 'calendar_create_event',
      data: {
        title: 'Call with mom',
        start_datetime: '2026-03-12T15:00:00',
        end_datetime: '2026-03-12T16:00:00',
      },
    };
    expect(reminder.intent).not.toBe(calEvent.intent);
    expect(reminder.intent).toBe('create_reminder');
    expect(calEvent.intent).toBe('calendar_create_event');
  });

  it('reminder with draft_message preserves the message', () => {
    const intent: CreateReminderIntent = {
      intent: 'create_reminder',
      data: {
        title: 'Message Johan',
        body: 'Wish him luck for tomorrow',
        scheduled_at: '2026-03-13T11:00:00',
        recipient_name: 'Johan',
        draft_message: 'Hey Johan, wishing you all the best for tomorrow!',
      },
    };
    expect(intent.data.draft_message).toContain('Johan');
    expect(intent.data.recipient_name).toBe('Johan');
  });

  it('routing a reminder app_action with high confidence executes directly', () => {
    const msg: ClassifiedMessage = {
      route_type: 'app_action',
      confidence: 'high',
      ambiguities: [],
      intent: {
        intent: 'create_reminder',
        data: { title: 'Test', body: '', scheduled_at: '2026-03-12T12:00:00' },
      },
      confirm_needed: false,
      user_facing_summary: 'Reminder set for today at noon',
    };
    const action = routeClassified(msg);
    expect(action.action).toBe('execute');
    if (action.action === 'execute') {
      expect(action.intent.intent).toBe('create_reminder');
    }
  });

  it('ambiguous message should route as ask when confidence is low', () => {
    const msg: ClassifiedMessage = {
      route_type: 'app_action',
      confidence: 'low',
      ambiguities: ['Could be calendar event or reminder'],
      intent: undefined,
      follow_up_question: 'Do you want this as a Google Calendar event or a Telegram reminder?',
    };
    const action = routeClassified(msg);
    expect(action.action).toBe('ask');
    if (action.action === 'ask') {
      expect(action.question).toContain('Calendar');
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2: Task description intents don't reference calendar
// ---------------------------------------------------------------------------
describe('task description update disambiguation', () => {
  it('update_task_description has correct structure', () => {
    const intent: UpdateTaskDescriptionIntent = {
      intent: 'update_task_description',
      data: {
        task_title: 'Invite Oscar',
        description: 'Send him a WhatsApp message with the event details',
      },
    };
    expect(intent.intent).toBe('update_task_description');
    expect(intent.data.description).toBeDefined();
    // Must NOT have any calendar-related fields
    expect((intent.data as Record<string, unknown>).event_id).toBeUndefined();
    expect((intent.data as Record<string, unknown>).start_datetime).toBeUndefined();
  });

  it('update_task_description with task_id routes to execute', () => {
    const msg: ClassifiedMessage = {
      route_type: 'app_action',
      confidence: 'high',
      ambiguities: [],
      intent: {
        intent: 'update_task_description',
        data: {
          task_id: '12345678-1234-1234-1234-123456789abc',
          description: 'Check notion integration and Zapier',
        },
      } as Intent,
      confirm_needed: false,
      user_facing_summary: 'Updating task description',
    };
    const action = routeClassified(msg);
    expect(action.action).toBe('execute');
    if (action.action === 'execute') {
      expect(action.intent.intent).toBe('update_task_description');
    }
  });

  it('update_task_description is NOT calendar_update_event', () => {
    const descIntent: UpdateTaskDescriptionIntent = {
      intent: 'update_task_description',
      data: { task_title: 'Exit integration', description: 'Check Zapier flows' },
    };
    expect(descIntent.intent).not.toBe('calendar_update_event');
    expect(descIntent.intent).not.toBe('calendar_create_event');
    expect(descIntent.intent).toBe('update_task_description');
  });
});

// ---------------------------------------------------------------------------
// Test 3: Clarify intent supports options
// ---------------------------------------------------------------------------
describe('clarify intent with options', () => {
  it('clarify with options has up to 3 suggested choices', () => {
    const clarify = {
      type: 'clarify' as const,
      question: 'Do you want this as a Google Calendar event or a Telegram reminder?',
      options: ['Calendar event', 'Telegram reminder'],
    };
    expect(clarify.options).toHaveLength(2);
    expect(clarify.options[0]).toBe('Calendar event');
    expect(clarify.options[1]).toBe('Telegram reminder');
  });

  it('clarify without options is still valid', () => {
    const clarify: { type: 'clarify'; question: string; options?: string[] } = {
      type: 'clarify' as const,
      question: 'Could you be more specific about which task?',
    };
    expect(clarify.question).toBeDefined();
    expect(clarify.options).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 4: Entity refs structure
// ---------------------------------------------------------------------------
describe('entity reference tracking', () => {
  it('EntityRefs supports last_task', () => {
    const refs: EntityRefs = {
      last_task: { id: '12345678-abcd', title: 'Exit integration task' },
    };
    expect(refs.last_task?.id).toBe('12345678-abcd');
    expect(refs.last_task?.title).toBe('Exit integration task');
  });

  it('EntityRefs supports last_calendar_event', () => {
    const refs: EntityRefs = {
      last_calendar_event: { id: 'gcal_abc123', title: 'Padel', start: '2026-03-12T11:00:00' },
    };
    expect(refs.last_calendar_event?.title).toBe('Padel');
  });

  it('EntityRefs supports last_reminder', () => {
    const refs: EntityRefs = {
      last_reminder: { id: 'rem-uuid', title: 'Call dad', fire_at: '2026-03-12T12:00:00' },
    };
    expect(refs.last_reminder?.fire_at).toContain('T');
  });

  it('all entity refs can be set simultaneously', () => {
    const refs: EntityRefs = {
      last_task: { id: 't1', title: 'Task 1' },
      last_calendar_event: { id: 'e1', title: 'Event 1', start: '2026-03-12T10:00:00' },
      last_reminder: { id: 'r1', title: 'Reminder 1', fire_at: '2026-03-12T15:00:00' },
    };
    expect(refs.last_task).toBeDefined();
    expect(refs.last_calendar_event).toBeDefined();
    expect(refs.last_reminder).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test 5: Routing never outputs raw JSON as user-facing text
// ---------------------------------------------------------------------------
describe('no raw JSON in user-facing output', () => {
  it('routeClassified for app_action returns execute, not raw JSON', () => {
    const msg: ClassifiedMessage = {
      route_type: 'app_action',
      confidence: 'high',
      ambiguities: [],
      intent: {
        intent: 'create_reminder',
        data: { title: 'Test', body: '', scheduled_at: '2026-03-12T12:00:00' },
      },
      confirm_needed: false,
      user_facing_summary: 'Reminder set',
    };
    const action = routeClassified(msg);
    // The action should never be a raw JSON dump
    expect(action.action).not.toBe('reply');
    expect(action.action).toBe('execute');
  });

  it('routeClassified for casual returns human text, not JSON', () => {
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
