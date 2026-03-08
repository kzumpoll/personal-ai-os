import { describe, it, expect } from 'vitest';
import { parseDebriefResponse, extractFirstJsonBlock } from './claude';

const VALID_SAVE_DEBRIEF = {
  intent: 'save_debrief',
  data: {
    entry_date: '2026-03-09',
    debrief_date: '2026-03-08',
    mit: 'Ship the auth fix',
    k1: 'Review PRs',
    wake_time: '07:00',
    wins: ['Finished the debrief feature'],
    task_completions: ['550e8400-e29b-41d4-a716-446655440001'],
    task_due_date_changes: [{ id: '550e8400-e29b-41d4-a716-446655440005', due_date: '2026-03-11' }],
    task_deletions: ['550e8400-e29b-41d4-a716-446655440009'],
  },
};

// ─── extractFirstJsonBlock ────────────────────────────────────────────────────

describe('extractFirstJsonBlock', () => {
  it('returns null when no { present', () => {
    expect(extractFirstJsonBlock('no braces here')).toBeNull();
  });

  it('extracts a simple flat object', () => {
    const result = extractFirstJsonBlock('prefix {"a":1} suffix');
    expect(result).toBe('{"a":1}');
  });

  it('extracts nested object', () => {
    const result = extractFirstJsonBlock('{"a":{"b":2},"c":3}');
    expect(result).toBe('{"a":{"b":2},"c":3}');
  });

  it('handles strings containing braces', () => {
    const result = extractFirstJsonBlock('{"msg":"hello {world}"}');
    expect(result).toBe('{"msg":"hello {world}"}');
  });

  it('stops at first complete block when multiple present', () => {
    const result = extractFirstJsonBlock('{"first":1}{"second":2}');
    expect(result).toBe('{"first":1}');
  });
});

// ─── parseDebriefResponse ─────────────────────────────────────────────────────

describe('parseDebriefResponse', () => {
  it('parses a clean save_debrief JSON', () => {
    const raw = JSON.stringify(VALID_SAVE_DEBRIEF);
    const result = parseDebriefResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.repaired).toBe(false);
    expect(result!.intent.intent).toBe('save_debrief');
    const data = (result!.intent as typeof VALID_SAVE_DEBRIEF).data;
    expect(data.mit).toBe('Ship the auth fix');
    expect(data.task_deletions).toEqual(['550e8400-e29b-41d4-a716-446655440009']);
    expect(data.task_due_date_changes?.[0].due_date).toBe('2026-03-11');
  });

  it('repairs fenced JSON (```json ... ```)', () => {
    const raw = '```json\n' + JSON.stringify(VALID_SAVE_DEBRIEF) + '\n```';
    const result = parseDebriefResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.repaired).toBe(true);
    expect(result!.intent.intent).toBe('save_debrief');
  });

  it('repairs fenced JSON without language tag (``` ... ```)', () => {
    const raw = '```\n' + JSON.stringify(VALID_SAVE_DEBRIEF) + '\n```';
    const result = parseDebriefResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.repaired).toBe(true);
    expect(result!.intent.intent).toBe('save_debrief');
  });

  it('repairs intent:unknown wrapper with bare nested save_debrief in data.message', () => {
    const raw = JSON.stringify({
      intent: 'unknown',
      data: {
        message: JSON.stringify(VALID_SAVE_DEBRIEF),
      },
    });
    const result = parseDebriefResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.repaired).toBe(false); // strategy 1 handles it (direct parse + extractSaveDebrief)
    expect(result!.intent.intent).toBe('save_debrief');
  });

  it('repairs intent:unknown wrapper with fenced nested JSON in data.message', () => {
    // Exact reproduction of the reported bug
    const raw = JSON.stringify({
      intent: 'unknown',
      data: {
        message: '```json\n' + JSON.stringify(VALID_SAVE_DEBRIEF) + '\n```\nNotes: Some commentary here.',
      },
    });
    const result = parseDebriefResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.intent.intent).toBe('save_debrief');
  });

  it('repairs JSON embedded in prose (strategy 3 — extract first block)', () => {
    const raw = 'Here is what I parsed:\n' + JSON.stringify(VALID_SAVE_DEBRIEF) + '\nLet me know if this looks right.';
    const result = parseDebriefResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.repaired).toBe(true);
    expect(result!.intent.intent).toBe('save_debrief');
  });

  it('repairs JSON with extra commentary after the closing brace', () => {
    const raw = JSON.stringify(VALID_SAVE_DEBRIEF) + '\n\nNotes: The delete action was ambiguous so I included it in task_deletions.';
    const result = parseDebriefResponse(raw);
    // Strategy 1: JSON.parse of the full text fails (trailing text), so falls to strategy 3
    expect(result).not.toBeNull();
    expect(result!.intent.intent).toBe('save_debrief');
  });

  it('returns null for completely unparseable output', () => {
    const raw = 'I could not understand the debrief. Please try again with a clearer format.';
    const result = parseDebriefResponse(raw);
    expect(result).toBeNull();
  });

  it('returns null for valid JSON that is not save_debrief', () => {
    const raw = JSON.stringify({ intent: 'list_tasks', data: { filter: 'today' } });
    const result = parseDebriefResponse(raw);
    expect(result).toBeNull();
  });

  it('handles debrief with task_due_date_changes (e.g. "5. to mar 11") and task_deletions (e.g. "9. delete")', () => {
    // Simulates what Claude should return after parsing a debrief containing those instructions
    const payload = {
      intent: 'save_debrief',
      data: {
        entry_date: '2026-03-09',
        debrief_date: '2026-03-08',
        mit: 'Main task',
        task_due_date_changes: [{ id: '550e8400-e29b-41d4-a716-446655440005', due_date: '2026-03-11' }],
        task_deletions: ['550e8400-e29b-41d4-a716-446655440009'],
      },
    };
    const result = parseDebriefResponse(JSON.stringify(payload));
    expect(result).not.toBeNull();
    expect(result!.intent.intent).toBe('save_debrief');
    const data = (result!.intent as typeof payload).data;
    expect(data.task_due_date_changes[0].due_date).toBe('2026-03-11');
    expect(data.task_deletions[0]).toBe('550e8400-e29b-41d4-a716-446655440009');
  });
});
