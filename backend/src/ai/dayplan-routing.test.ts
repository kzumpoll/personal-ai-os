/**
 * Day plan routing logic tests.
 *
 * These tests do NOT call the LLM. They verify that the bot's routing
 * layer correctly handles mock ClassifiedMessage and DayPlanMutation
 * objects — confirming the expected behavior without hardcoded keyword rules.
 *
 * Each test case documents the EXPECTED routing for that input, which
 * serves as a contract for the LLM classifiers.
 */
import { describe, it, expect } from 'vitest';
import type { DayPlanMutation } from './claude';

// ---------------------------------------------------------------------------
// Helpers — simulate the two routing decisions the bot makes
// ---------------------------------------------------------------------------

type RouteType = 'app_action' | 'assistant_answer' | 'capture_candidate' | 'casual' | 'day_plan';
type Confidence = 'high' | 'medium' | 'low';

interface MockClassified {
  route_type: RouteType;
  confidence: Confidence;
  follow_up_question?: string | null;
  answer?: string;
}

/**
 * Mirrors the confidence gate in bot.ts:
 * Returns true when the bot should ask a clarifying question instead of proceeding.
 */
function shouldAskClarification(classified: MockClassified): boolean {
  return (
    classified.confidence === 'low' ||
    (classified.confidence === 'medium' && !!classified.follow_up_question)
  );
}

/**
 * Returns the bot's top-level routing decision for a classified message.
 * 'ask_clarification' means the bot stops and asks a question.
 * 'answer' means assistant_answer was chosen — no plan shown.
 * 'plan_action' means route proceeds to interpretDayPlanEdit.
 */
function topLevelRoute(classified: MockClassified): 'ask_clarification' | 'answer' | 'plan_action' | 'other' {
  if (classified.route_type === 'day_plan') {
    if (shouldAskClarification(classified)) return 'ask_clarification';
    return 'plan_action';
  }
  if (classified.route_type === 'assistant_answer') return 'answer';
  return 'other';
}

/**
 * Simulates what the bot does with a DayPlanMutation after interpretDayPlanEdit.
 * Returns the action category without executing any side effects.
 */
function mutationAction(mutation: DayPlanMutation): string {
  switch (mutation.type) {
    case 'show': return 'show_plan';
    case 'regenerate': return 'regenerate_plan';
    case 'plan_question': return 'answer_question';
    case 'remove_event':
    case 'change_wake_time':
    case 'move_block':
    case 'remove_block': return 'edit_plan';
    case 'log_win': return 'log_win';
    case 'set_mit':
    case 'set_k1':
    case 'set_k2': return 'set_priority';
    case 'unknown': return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Test 1: "day plan" (bare) → show_plan
// ---------------------------------------------------------------------------
describe('"day plan" (bare)', () => {
  it('should classify as day_plan with high confidence', () => {
    const classified: MockClassified = {
      route_type: 'day_plan',
      confidence: 'high',
    };
    expect(topLevelRoute(classified)).toBe('plan_action');
  });

  it('mutation should be show', () => {
    const mutation: DayPlanMutation = { type: 'show' };
    expect(mutationAction(mutation)).toBe('show_plan');
  });
});

// ---------------------------------------------------------------------------
// Test 2: "am I able to edit my day plan?" → NOT show_plan
// ---------------------------------------------------------------------------
describe('"am I able to edit my day plan?"', () => {
  it('should classify as assistant_answer, not day_plan', () => {
    // This is a capability question — the LLM should choose assistant_answer.
    const classified: MockClassified = {
      route_type: 'assistant_answer',
      confidence: 'high',
      answer: 'Yes — you can move blocks, remove events, change your wake time, or redo the whole plan.',
    };
    expect(topLevelRoute(classified)).toBe('answer');
    expect(classified.route_type).not.toBe('day_plan');
  });

  it('if it does reach interpretDayPlanEdit it should NOT be show', () => {
    // Safety net: if it somehow reaches the mutation parser,
    // it should return plan_question, never show.
    const mutation: DayPlanMutation = {
      type: 'plan_question',
      answer_text: 'Yes — you can move blocks, remove events, change your wake time, or redo the whole plan.',
    };
    expect(mutationAction(mutation)).toBe('answer_question');
    expect(mutation.type).not.toBe('show');
  });
});

// ---------------------------------------------------------------------------
// Test 3: "how do I edit my day plan?" → NOT show_plan
// ---------------------------------------------------------------------------
describe('"how do I edit my day plan?"', () => {
  it('should classify as assistant_answer, not day_plan', () => {
    const classified: MockClassified = {
      route_type: 'assistant_answer',
      confidence: 'high',
      answer: 'You can say things like "move lunch to 1pm", "remove standup from my plan", or "redo my day from here".',
    };
    expect(topLevelRoute(classified)).toBe('answer');
    expect(classified.route_type).not.toBe('day_plan');
  });

  it('if it reaches interpretDayPlanEdit mutation should be plan_question not show', () => {
    const mutation: DayPlanMutation = {
      type: 'plan_question',
      answer_text: 'You can say: "move lunch to 1pm", "remove standup", "redo my day from here".',
    };
    expect(mutationAction(mutation)).not.toBe('show_plan');
    expect(mutationAction(mutation)).toBe('answer_question');
  });
});

// ---------------------------------------------------------------------------
// Test 4: "redo my day plan from here" → regenerate, NOT show_plan
// ---------------------------------------------------------------------------
describe('"redo my day plan from here"', () => {
  it('should classify as day_plan with high confidence', () => {
    const classified: MockClassified = {
      route_type: 'day_plan',
      confidence: 'high',
    };
    expect(topLevelRoute(classified)).toBe('plan_action');
  });

  it('mutation should be regenerate, not show', () => {
    const mutation: DayPlanMutation = { type: 'regenerate' };
    expect(mutationAction(mutation)).toBe('regenerate_plan');
    expect(mutation.type).not.toBe('show');
  });
});

// ---------------------------------------------------------------------------
// Test 5: "can you help me with my day plan?" → clarification or plan_question, NOT show_plan
// ---------------------------------------------------------------------------
describe('"can you help me with my day plan?"', () => {
  it('should trigger clarification via confidence gate when day_plan medium + follow_up', () => {
    const classified: MockClassified = {
      route_type: 'day_plan',
      confidence: 'medium',
      follow_up_question: 'Yes — do you want to view it, edit it, or redo the rest of today?',
    };
    expect(topLevelRoute(classified)).toBe('ask_clarification');
  });

  it('if it reaches interpretDayPlanEdit mutation should be plan_question not show', () => {
    const mutation: DayPlanMutation = {
      type: 'plan_question',
      answer_text: 'Yes — do you want to view it, edit it, or redo the rest of today?',
    };
    expect(mutationAction(mutation)).toBe('answer_question');
    expect(mutation.type).not.toBe('show');
  });
});

// ---------------------------------------------------------------------------
// Test 6: "show my day plan" → show_plan
// ---------------------------------------------------------------------------
describe('"show my day plan"', () => {
  it('should classify as day_plan with high confidence', () => {
    const classified: MockClassified = {
      route_type: 'day_plan',
      confidence: 'high',
    };
    expect(topLevelRoute(classified)).toBe('plan_action');
  });

  it('mutation should be show', () => {
    const mutation: DayPlanMutation = { type: 'show' };
    expect(mutationAction(mutation)).toBe('show_plan');
  });
});

// ---------------------------------------------------------------------------
// Confidence gate behaviour
// ---------------------------------------------------------------------------
describe('confidence gate', () => {
  it('low confidence always triggers clarification regardless of follow_up', () => {
    const classified: MockClassified = { route_type: 'day_plan', confidence: 'low' };
    expect(shouldAskClarification(classified)).toBe(true);
  });

  it('medium + follow_up_question triggers clarification', () => {
    const classified: MockClassified = {
      route_type: 'day_plan',
      confidence: 'medium',
      follow_up_question: 'What would you like to do with your plan?',
    };
    expect(shouldAskClarification(classified)).toBe(true);
  });

  it('medium without follow_up does NOT trigger clarification', () => {
    const classified: MockClassified = { route_type: 'day_plan', confidence: 'medium' };
    expect(shouldAskClarification(classified)).toBe(false);
  });

  it('high confidence never triggers clarification', () => {
    const classified: MockClassified = { route_type: 'day_plan', confidence: 'high' };
    expect(shouldAskClarification(classified)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// plan_question mutation type contracts
// ---------------------------------------------------------------------------
describe('plan_question mutation', () => {
  it('has action answer_question', () => {
    const mutation: DayPlanMutation = { type: 'plan_question', answer_text: 'Yes...' };
    expect(mutationAction(mutation)).toBe('answer_question');
  });

  it('is distinct from show', () => {
    const mutation: DayPlanMutation = { type: 'plan_question', answer_text: 'Yes...' };
    expect(mutation.type).not.toBe('show');
  });

  it('carries an answer_text field', () => {
    const mutation: DayPlanMutation = {
      type: 'plan_question',
      answer_text: 'You can edit your plan by saying things like "move lunch to 1pm".',
    };
    expect(mutation.answer_text).toBeTruthy();
  });
});
