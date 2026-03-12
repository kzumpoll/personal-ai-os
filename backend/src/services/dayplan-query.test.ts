/**
 * Tests for deterministic day plan querying (querySchedule + parseFlexibleTime).
 * These verify that simple schedule questions are answered without an LLM call.
 */
import { describe, it, expect } from 'vitest';
import { querySchedule, parseFlexibleTime } from './dayplan';
import type { ScheduleBlock } from '../db/queries/day_plans';

// ---------------------------------------------------------------------------
// Sample schedule used across tests
// ---------------------------------------------------------------------------

const sampleSchedule: ScheduleBlock[] = [
  { time: '07:00', title: 'Wake up', type: 'wake', duration_min: 30 },
  { time: '07:30', title: 'Clear Inbox', type: 'task', duration_min: 60 },
  { time: '08:30', title: 'Deep work on API', type: 'mit', duration_min: 90 },
  { time: '10:00', title: 'Team standup', type: 'event', duration_min: 30 },
  { time: '10:40', title: 'Review PRs', type: 'p1', duration_min: 60 },
  { time: '12:00', title: 'Lunch', type: 'break', duration_min: 30 },
  { time: '12:40', title: 'Write tests', type: 'p2', duration_min: 60 },
  { time: '14:00', title: 'Travel to padel', type: 'travel', duration_min: 30 },
  { time: '14:30', title: 'Padel with Marco', type: 'event', duration_min: 90 },
  { time: '16:00', title: 'Travel from padel', type: 'travel', duration_min: 30 },
  { time: '16:40', title: 'Admin tasks', type: 'task', duration_min: 30 },
];

// ---------------------------------------------------------------------------
// parseFlexibleTime
// ---------------------------------------------------------------------------

describe('parseFlexibleTime', () => {
  it('parses HH:MM 24h format', () => {
    expect(parseFlexibleTime('14:00')).toBe(840);
    expect(parseFlexibleTime('10:30')).toBe(630);
    expect(parseFlexibleTime('07:00')).toBe(420);
  });

  it('parses bare hour with am/pm', () => {
    expect(parseFlexibleTime('2pm')).toBe(840);
    expect(parseFlexibleTime('11am')).toBe(660);
    expect(parseFlexibleTime('12pm')).toBe(720);
    expect(parseFlexibleTime('12am')).toBe(0);
  });

  it('parses HH:MM with am/pm', () => {
    expect(parseFlexibleTime('2:30pm')).toBe(870);
    expect(parseFlexibleTime('11:30am')).toBe(690);
  });

  it('parses bare hours >= 7 as unambiguous', () => {
    expect(parseFlexibleTime('7')).toBe(420);
    expect(parseFlexibleTime('10')).toBe(600);
    expect(parseFlexibleTime('22')).toBe(1320);
  });

  it('returns null for ambiguous bare hours 1-6', () => {
    expect(parseFlexibleTime('1')).toBeNull();
    expect(parseFlexibleTime('2')).toBeNull();
    expect(parseFlexibleTime('6')).toBeNull();
  });

  it('returns null for invalid input', () => {
    expect(parseFlexibleTime('abc')).toBeNull();
    expect(parseFlexibleTime('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// querySchedule — time range queries
// ---------------------------------------------------------------------------

describe('querySchedule time range', () => {
  it('"between 10 and 11:30" returns blocks in range', () => {
    const result = querySchedule('between 10 and 11:30', sampleSchedule);
    expect(result).not.toBeNull();
    expect(result).toContain('Team standup');
    expect(result).toContain('Review PRs');
    expect(result).not.toContain('Lunch');
    expect(result).not.toContain('Wake up');
  });

  it('"and between 10 and 11:30?" follow-up form works', () => {
    const result = querySchedule('and between 10 and 11:30?', sampleSchedule);
    expect(result).not.toBeNull();
    expect(result).toContain('Team standup');
    expect(result).toContain('Review PRs');
  });

  it('"from 2pm to 4pm" returns blocks in range', () => {
    const result = querySchedule('from 2pm to 4pm', sampleSchedule);
    expect(result).not.toBeNull();
    expect(result).toContain('Travel to padel');
    expect(result).toContain('Padel with Marco');
    expect(result).not.toContain('Travel from padel'); // starts at 16:00 = 4pm, not before
  });

  it('reports free time in range', () => {
    const result = querySchedule('between 10 and 12', sampleSchedule);
    expect(result).not.toBeNull();
    expect(result).toContain('free');
  });

  it('empty range returns "Nothing scheduled"', () => {
    const result = querySchedule('between 7 and 7:30', sampleSchedule);
    // Only Wake up overlaps, which starts at 07:00 and ends at 07:30
    expect(result).not.toBeNull();
    expect(result).toContain('Wake up');
  });

  it('range with no blocks returns nothing-scheduled message', () => {
    const schedule: ScheduleBlock[] = [
      { time: '07:00', title: 'Wake up', type: 'wake', duration_min: 30 },
      { time: '18:00', title: 'Dinner', type: 'break', duration_min: 60 },
    ];
    const result = querySchedule('between 10 and 12', schedule);
    expect(result).not.toBeNull();
    expect(result).toContain('Nothing scheduled');
    expect(result).toContain('120min free');
  });

  it('returns null for ambiguous bare hours (e.g. "between 2 and 4")', () => {
    const result = querySchedule('between 2 and 4', sampleSchedule);
    expect(result).toBeNull(); // 2 and 4 are < 7, no am/pm → ambiguous
  });
});

// ---------------------------------------------------------------------------
// querySchedule — relative queries
// ---------------------------------------------------------------------------

describe('querySchedule relative', () => {
  it('"after lunch" returns blocks after lunch', () => {
    const result = querySchedule('after lunch', sampleSchedule);
    expect(result).not.toBeNull();
    expect(result).toContain('Write tests');
    expect(result).toContain('Travel to padel');
    expect(result).toContain('Padel with Marco');
    expect(result).not.toContain('Clear Inbox');
  });

  it('"what\'s after lunch?" works with prefix', () => {
    const result = querySchedule("what's after lunch?", sampleSchedule);
    expect(result).not.toBeNull();
    expect(result).toContain('Write tests');
  });

  it('"before padel" returns blocks before padel', () => {
    const result = querySchedule('before padel', sampleSchedule);
    expect(result).not.toBeNull();
    expect(result).toContain('Clear Inbox');
    expect(result).toContain('Lunch');
    // Travel to padel ends at 14:30 = padel start, so it should NOT appear
    expect(result).not.toContain('Padel with Marco');
  });

  it('"what\'s before padel?" works with prefix', () => {
    const result = querySchedule("what's before padel?", sampleSchedule);
    expect(result).not.toBeNull();
    expect(result).toContain('Lunch');
  });

  it('returns null for unknown block title', () => {
    const result = querySchedule('after yoga', sampleSchedule);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// querySchedule — non-matching messages return null
// ---------------------------------------------------------------------------

describe('querySchedule non-matching', () => {
  it('returns null for action requests', () => {
    expect(querySchedule('add a meeting at 3pm', sampleSchedule)).toBeNull();
    expect(querySchedule('move lunch to 1pm', sampleSchedule)).toBeNull();
  });

  it('returns null for greetings', () => {
    expect(querySchedule('hello', sampleSchedule)).toBeNull();
    expect(querySchedule('good morning', sampleSchedule)).toBeNull();
  });

  it('returns null for empty schedule', () => {
    expect(querySchedule('between 10 and 12', [])).toBeNull();
    expect(querySchedule('after lunch', [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fallback string must never appear
// ---------------------------------------------------------------------------

describe('old fallback removal', () => {
  it('"lost my train of thought" does not appear in querySchedule results', () => {
    const queries = [
      'between 10 and 11:30',
      'after lunch',
      'before padel',
      'hello',
      'add something',
    ];
    for (const q of queries) {
      const result = querySchedule(q, sampleSchedule);
      if (result !== null) {
        expect(result).not.toContain('lost my train of thought');
      }
    }
  });
});
