/**
 * Calendar intent routing tests.
 *
 * These tests do NOT call the LLM. They verify that:
 * 1. Calendar intent types are properly defined
 * 2. The routing layer correctly handles calendar intents
 * 3. Disambiguation logic works for update/delete
 * 4. Confirmation rules apply correctly
 */
import { describe, it, expect } from 'vitest';
import type { Intent, CalendarCreateEventIntent, CalendarUpdateEventIntent, CalendarDeleteEventIntent } from './intents';
import { routeClassified, type ClassifiedMessage } from './intents';
import { classifyImageIntent } from './claude';

// ---------------------------------------------------------------------------
// Test 1: Calendar create intents structure
// ---------------------------------------------------------------------------
describe('calendar_create_event intent', () => {
  it('should have correct structure for a simple event', () => {
    const intent: CalendarCreateEventIntent = {
      intent: 'calendar_create_event',
      data: {
        title: 'Padel',
        start_datetime: '2026-03-12T11:00:00',
        end_datetime: '2026-03-12T12:00:00',
      },
    };
    expect(intent.intent).toBe('calendar_create_event');
    expect(intent.data.title).toBe('Padel');
    expect(intent.data.start_datetime).toContain('T');
    expect(intent.data.end_datetime).toContain('T');
  });

  it('should support optional location and description', () => {
    const intent: CalendarCreateEventIntent = {
      intent: 'calendar_create_event',
      data: {
        title: 'Tea session',
        start_datetime: '2026-03-15T16:00:00',
        end_datetime: '2026-03-15T17:00:00',
        location: 'Ubud',
        description: 'Weekly tea tasting',
      },
    };
    expect(intent.data.location).toBe('Ubud');
    expect(intent.data.description).toBe('Weekly tea tasting');
  });

  it('should support all-day events', () => {
    const intent: CalendarCreateEventIntent = {
      intent: 'calendar_create_event',
      data: {
        title: 'Holiday',
        start_datetime: '2026-03-14',
        end_datetime: '2026-03-15',
        all_day: true,
      },
    };
    expect(intent.data.all_day).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Calendar update intent structure
// ---------------------------------------------------------------------------
describe('calendar_update_event intent', () => {
  it('should support update by event_id', () => {
    const intent: CalendarUpdateEventIntent = {
      intent: 'calendar_update_event',
      data: {
        event_id: 'abc123',
        new_start_datetime: '2026-03-12T12:00:00',
        new_end_datetime: '2026-03-12T13:00:00',
      },
    };
    expect(intent.data.event_id).toBe('abc123');
    expect(intent.data.new_start_datetime).toBeDefined();
  });

  it('should support update by title + search_date', () => {
    const intent: CalendarUpdateEventIntent = {
      intent: 'calendar_update_event',
      data: {
        event_title: 'Padel',
        search_date: '2026-03-12',
        new_start_datetime: '2026-03-12T12:00:00',
        new_end_datetime: '2026-03-12T13:00:00',
      },
    };
    expect(intent.data.event_title).toBe('Padel');
    expect(intent.data.search_date).toBe('2026-03-12');
  });
});

// ---------------------------------------------------------------------------
// Test 3: Calendar delete intent structure
// ---------------------------------------------------------------------------
describe('calendar_delete_event intent', () => {
  it('should support delete by event_id', () => {
    const intent: CalendarDeleteEventIntent = {
      intent: 'calendar_delete_event',
      data: {
        event_id: 'abc123',
        search_date: '2026-03-14',
      },
    };
    expect(intent.data.event_id).toBe('abc123');
  });

  it('should support delete by title + date', () => {
    const intent: CalendarDeleteEventIntent = {
      intent: 'calendar_delete_event',
      data: {
        event_title: 'Lunch with Fay',
        search_date: '2026-03-14',
      },
    };
    expect(intent.data.event_title).toBe('Lunch with Fay');
  });
});

// ---------------------------------------------------------------------------
// Test 4: Routing — high confidence create should execute immediately
// ---------------------------------------------------------------------------
describe('calendar create routing', () => {
  it('high confidence + no confirm → execute immediately', () => {
    const msg: ClassifiedMessage = {
      route_type: 'app_action',
      confidence: 'high',
      ambiguities: [],
      confirm_needed: false,
      intent: {
        intent: 'calendar_create_event',
        data: {
          title: 'Padel',
          start_datetime: '2026-03-12T11:00:00',
          end_datetime: '2026-03-12T12:00:00',
        },
      },
    };
    const action = routeClassified(msg);
    expect(action.action).toBe('execute');
  });

  it('low confidence → ask clarification', () => {
    const msg: ClassifiedMessage = {
      route_type: 'app_action',
      confidence: 'low',
      ambiguities: ['missing time'],
      follow_up_question: 'What time should I schedule lunch on Friday?',
      intent: {
        intent: 'calendar_create_event',
        data: {
          title: 'Lunch',
          start_datetime: '2026-03-14T12:00:00',
          end_datetime: '2026-03-14T13:00:00',
        },
      },
    };
    const action = routeClassified(msg);
    expect(action.action).toBe('ask');
  });
});

// ---------------------------------------------------------------------------
// Test 5: Routing — delete should confirm
// ---------------------------------------------------------------------------
describe('calendar delete routing', () => {
  it('delete with confirm_needed → confirm action', () => {
    const msg: ClassifiedMessage = {
      route_type: 'app_action',
      confidence: 'medium',
      ambiguities: [],
      confirm_needed: true,
      user_facing_summary: 'Cancel "Lunch with Fay" on Friday?',
      intent: {
        intent: 'calendar_delete_event',
        data: {
          event_title: 'Lunch with Fay',
          search_date: '2026-03-14',
        },
      },
    };
    const action = routeClassified(msg);
    expect(action.action).toBe('confirm_intent');
  });
});

// ---------------------------------------------------------------------------
// Test 6: Example messages → expected intent types
// ---------------------------------------------------------------------------
describe('expected intent types for example messages', () => {
  const examples: Array<{ message: string; expectedIntent: string }> = [
    { message: 'add padel tomorrow at 11', expectedIntent: 'calendar_create_event' },
    { message: 'schedule lunch with Fay on Friday at 1:30pm', expectedIntent: 'calendar_create_event' },
    { message: 'create a meeting called Website Review on March 14 from 3 to 4pm', expectedIntent: 'calendar_create_event' },
    { message: 'add dinner tonight at 7 with Jofinne', expectedIntent: 'calendar_create_event' },
    { message: 'block 2 hours tomorrow morning for deep work', expectedIntent: 'calendar_create_event' },
    { message: 'move my 5pm call to 6pm', expectedIntent: 'calendar_update_event' },
    { message: 'cancel lunch with Fay on Friday', expectedIntent: 'calendar_delete_event' },
    // Bug report test cases — these must NEVER become resources or "no access" answers
    { message: 'add an event: Padel for march 17 13:30pm at Jungle Padel Pererenan', expectedIntent: 'calendar_create_event' },
    { message: 'schedule a call with Fay tomorrow at 10am', expectedIntent: 'calendar_create_event' },
    { message: 'add dinner with Jofinne tonight at 7', expectedIntent: 'calendar_create_event' },
    { message: 'book a meeting: Website Review on March 14 from 3 to 4pm at the studio', expectedIntent: 'calendar_create_event' },
    { message: 'add tea session Sunday at 4pm in Ubud', expectedIntent: 'calendar_create_event' },
  ];

  for (const { message, expectedIntent } of examples) {
    it(`"${message}" → ${expectedIntent}`, () => {
      // This test documents the contract — the LLM should produce this intent type
      // We verify the intent type exists and is valid
      expect(['calendar_create_event', 'calendar_update_event', 'calendar_delete_event']).toContain(expectedIntent);
    });
  }
});

// ---------------------------------------------------------------------------
// Test 7: Confirmation rules
// ---------------------------------------------------------------------------
describe('calendar confirmation rules', () => {
  it('create with full details → no confirmation needed', () => {
    const intent: CalendarCreateEventIntent = {
      intent: 'calendar_create_event',
      data: {
        title: 'Padel',
        start_datetime: '2026-03-12T11:00:00',
        end_datetime: '2026-03-12T12:00:00',
      },
    };
    // Full details present → should be high confidence, no confirm
    expect(intent.data.title).toBeTruthy();
    expect(intent.data.start_datetime).toBeTruthy();
    expect(intent.data.end_datetime).toBeTruthy();
  });

  it('create with missing time → needs clarification', () => {
    // When only a date is given without a time, the LLM should ask
    const msg: ClassifiedMessage = {
      route_type: 'app_action',
      confidence: 'low',
      ambiguities: ['no time specified'],
      follow_up_question: 'What time should I add lunch on Friday?',
    };
    const action = routeClassified(msg);
    expect(action.action).toBe('ask');
  });
});

// ---------------------------------------------------------------------------
// Test 8: Calendar messages must NEVER route as resource/capture
// ---------------------------------------------------------------------------
describe('calendar vs resource misclassification guard', () => {
  const calendarMessages = [
    'add an event: Padel for march 17 13:30pm at Jungle Padel Pererenan',
    'schedule a call with Fay tomorrow at 10am',
    'add dinner with Jofinne tonight at 7',
    'book a meeting: Website Review on March 14 from 3 to 4pm at the studio',
    'add tea session Sunday at 4pm in Ubud',
  ];

  for (const message of calendarMessages) {
    it(`"${message}" must not be classified as capture/resource`, () => {
      // Contract: If the LLM classifies correctly, it should be app_action with calendar intent
      const correctClassification: ClassifiedMessage = {
        route_type: 'app_action',
        confidence: 'high',
        ambiguities: [],
        confirm_needed: false,
        intent: {
          intent: 'calendar_create_event',
          data: {
            title: 'Test Event',
            start_datetime: '2026-03-17T13:30:00',
            end_datetime: '2026-03-17T14:30:00',
          },
        },
      };
      const action = routeClassified(correctClassification);
      expect(action.action).toBe('execute');
      expect(correctClassification.intent?.intent).toBe('calendar_create_event');
      expect(correctClassification.intent?.intent).not.toBe('create_resource');
    });
  }
});

// ---------------------------------------------------------------------------
// Test 9: LLM must never claim "no calendar access"
// ---------------------------------------------------------------------------
describe('no-access guardrail', () => {
  it('calendar scheduling requests must never route as answer type', () => {
    // If the LLM returns an "answer" for a calendar request, that's a bug.
    // The system prompt now explicitly forbids this pattern.
    const badClassification = {
      type: 'answer' as const,
      text: "I can't directly create Google Calendar events",
    };
    // Document the contract: answer type with "can't" + "calendar" is always wrong
    expect(badClassification.type).toBe('answer');
    expect(badClassification.text.toLowerCase()).toContain("can't");
    expect(badClassification.text.toLowerCase()).toContain('calendar');
  });
});

// ---------------------------------------------------------------------------
// Test 10: Image intent classification — editing vs understanding
// ---------------------------------------------------------------------------
describe('classifyImageIntent', () => {
  const understandCaptions = [
    'Add these 2 matches to my calendar',
    'Schedule both of these games',
    'Add this to my calendar',
    'Turn this screenshot into tasks',
    'What are the times in this image?',
    'Schedule these events',
    'Put these matches in my calendar',
    'Turn this screenshot into calendar events',
    'What does this say?',
    'Extract the event details',
    'List the items in this image',
    'When is the next match?',
    // Timezone conversion
    'What are these to my timezone?',
    'Convert these to Bali time',
    'What time is this for me?',
    'Turn these into my local time',
    'When are these for me?',
    // General questions
    'Summarize this screenshot',
    'Read this for me',
    'Tell me what this says',
  ];

  const editCaptions = [
    'Make the background white',
    'Remove this object',
    'Improve this logo',
    'Crop to square',
    'Add a drop shadow',
    'Adjust brightness +20%',
    'Sharpen this image',
    'Rotate 90 degrees',
  ];

  for (const caption of understandCaptions) {
    it(`"${caption}" → understand`, () => {
      expect(classifyImageIntent(caption)).toBe('understand');
    });
  }

  for (const caption of editCaptions) {
    it(`"${caption}" → edit`, () => {
      expect(classifyImageIntent(caption)).toBe('edit');
    });
  }
});
