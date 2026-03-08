/**
 * selftest.ts — offline logic tests.
 *
 * Covers:
 *   1. list_tasks executor logic (no DB needed — mirrors fixed executor.ts)
 *   2. routeDraft routing logic (pure fn from intents.ts — no Claude API needed)
 *   3. captureToIntent mapping
 *   4. routeClassified 4-way routing
 *   5. parseBulkTaskLines parsing
 *   6. extractPositionalNumber parsing
 *   7. task list ref resolution logic
 *   8. fmtDate formatting (no DB, no timezone issues)
 *   9. debrief cancel logic
 *  10. complete_task null-check logic
 *  11. undo truthfulness logic
 *
 * Run: npm run selftest
 */

import assert from 'assert';
import {
  routeDraft, InterpretationDraft, Intent,
  captureToIntent, routeClassified, ClassifiedMessage, CaptureType,
} from './ai/intents';
import { parseBulkTaskLines, fmtDate } from './mutations/executor';
import { extractPositionalNumber, extractPositionalNumbers } from './telegram/session';

// ---------------------------------------------------------------------------
// Helpers for routeDraft tests
// ---------------------------------------------------------------------------

function makeDraft(
  overrides: Partial<InterpretationDraft> & { confidence: InterpretationDraft['confidence'] }
): InterpretationDraft {
  const baseIntent: Intent = { intent: 'list_tasks', data: { filter: 'today' } };
  return {
    intent: baseIntent,
    normalized_meaning: 'list today tasks',
    ambiguities: [],
    user_facing_summary: 'Here are your tasks for today.',
    confirm_needed: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Replica of the fixed list_tasks logic (no DB, no Claude)
// ---------------------------------------------------------------------------

interface Task {
  title: string;
  due_date: string | null;
}

function runListTasks(
  intentData: unknown,
  tasks: Task[]
): { success: boolean; message: string } {
  // Mirrors defensive check in executor.ts
  if (!intentData || typeof intentData !== 'object') {
    return {
      success: false,
      message:
        'Could not list tasks: the request was malformed. Please try again (e.g. "show tasks today").',
    };
  }

  const filter = (intentData as { filter?: string }).filter ?? 'today';

  let label: string;
  if (filter === 'overdue') {
    label = 'Overdue tasks';
  } else if (filter === 'all') {
    label = 'All open tasks';
  } else {
    // today, tomorrow, upcoming, or anything else
    label = "Today's tasks";
  }

  if (!tasks.length) return { success: true, message: `No ${label.toLowerCase()}.` };

  const lines = tasks.map(
    (t, i) => `${i + 1}. ${t.title}${t.due_date ? ` (${t.due_date})` : ''}`
  );
  return { success: true, message: `${label}:\n${lines.join('\n')}` };
}

// ---------------------------------------------------------------------------
// Minimal test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

console.log('\nlist_tasks selftest\n');

// a. list today with zero tasks
test('list today — zero tasks → success + empty message', () => {
  const result = runListTasks({ filter: 'today' }, []);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.message, "No today's tasks.");
});

// a2. default filter (no filter key) with zero tasks
test('list today — no filter key, zero tasks → success + empty message', () => {
  const result = runListTasks({}, []);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.message, "No today's tasks.");
});

// b. list today with some tasks
test('list today — two tasks → numbered list', () => {
  const tasks: Task[] = [
    { title: 'Write report', due_date: '2026-03-06' },
    { title: 'Review PR', due_date: null },
  ];
  const result = runListTasks({ filter: 'today' }, tasks);
  assert.strictEqual(result.success, true);
  assert.ok(result.message.startsWith("Today's tasks:"), `unexpected start: ${result.message}`);
  assert.ok(result.message.includes('1. Write report (2026-03-06)'));
  assert.ok(result.message.includes('2. Review PR'));
  // tasks with no due_date must not get a trailing "(null)" or "()"
  assert.ok(!result.message.includes('Review PR ('), `unexpected due_date: ${result.message}`);
});

// c. malformed list_tasks intent — data is undefined
test('malformed intent — data is undefined → user-friendly error', () => {
  const result = runListTasks(undefined, []);
  assert.strictEqual(result.success, false);
  assert.ok(result.message.toLowerCase().includes('malformed'), `message: ${result.message}`);
});

// c2. malformed list_tasks intent — data is null
test('malformed intent — data is null → user-friendly error', () => {
  const result = runListTasks(null, []);
  assert.strictEqual(result.success, false);
  assert.ok(result.message.toLowerCase().includes('malformed'), `message: ${result.message}`);
});

// c3. malformed list_tasks intent — data is a string (unexpected Claude output)
test('malformed intent — data is a string → user-friendly error', () => {
  const result = runListTasks('today', []);
  assert.strictEqual(result.success, false);
  assert.ok(result.message.toLowerCase().includes('malformed'), `message: ${result.message}`);
});

// ---------------------------------------------------------------------------
// routeDraft routing logic
// ---------------------------------------------------------------------------

console.log('\nrouteDraft routing selftest\n');

// High confidence, no confirm → execute
test('routeDraft: high + confirm:false → execute', () => {
  const decision = routeDraft(makeDraft({ confidence: 'high', confirm_needed: false }));
  assert.strictEqual(decision.action, 'execute');
  assert.ok('intent' in decision);
});

// High confidence + confirm_needed → confirm (destructive but clear)
test('routeDraft: high + confirm:true → confirm', () => {
  const decision = routeDraft(
    makeDraft({ confidence: 'high', confirm_needed: true, user_facing_summary: 'Mark task X done?' })
  );
  assert.strictEqual(decision.action, 'confirm');
  assert.ok('question' in decision);
  assert.strictEqual((decision as { action: string; question: string }).question, 'Mark task X done?');
});

// Medium confidence + confirm_needed → confirm (e.g. "berlin tea tastings could be cool")
test('routeDraft: medium + confirm:true → confirm with user_facing_summary as question', () => {
  const decision = routeDraft(
    makeDraft({
      confidence: 'medium',
      confirm_needed: true,
      user_facing_summary: 'Do you want me to save that as an idea?',
    })
  );
  assert.strictEqual(decision.action, 'confirm');
  assert.strictEqual(
    (decision as { action: string; question: string }).question,
    'Do you want me to save that as an idea?'
  );
});

// Medium confidence + no confirm → execute (e.g. likely-correct, non-destructive)
test('routeDraft: medium + confirm:false → execute', () => {
  const decision = routeDraft(makeDraft({ confidence: 'medium', confirm_needed: false }));
  assert.strictEqual(decision.action, 'execute');
});

// Low confidence → ask (use follow_up_question when present)
test('routeDraft: low + follow_up_question → ask with that question', () => {
  const decision = routeDraft(
    makeDraft({
      confidence: 'low',
      follow_up_question: 'Which tasks did you mean — could you list the numbers?',
      user_facing_summary: 'I am not sure what you want.',
    })
  );
  assert.strictEqual(decision.action, 'ask');
  assert.strictEqual(
    (decision as { action: string; question: string }).question,
    'Which tasks did you mean — could you list the numbers?'
  );
});

// Low confidence → fall back to user_facing_summary when no follow_up_question
test('routeDraft: low + no follow_up_question → ask with user_facing_summary', () => {
  const decision = routeDraft(
    makeDraft({ confidence: 'low', user_facing_summary: 'What did you mean by that?' })
  );
  assert.strictEqual(decision.action, 'ask');
  assert.strictEqual(
    (decision as { action: string; question: string }).question,
    'What did you mean by that?'
  );
});

// Low confidence always → ask, even if confirm_needed is set
test('routeDraft: low + confirm:true → still ask, not confirm', () => {
  const decision = routeDraft(makeDraft({ confidence: 'low', confirm_needed: true }));
  assert.strictEqual(decision.action, 'ask');
});

// ---------------------------------------------------------------------------
// captureToIntent — pure mapping from capture type to executor Intent
// ---------------------------------------------------------------------------

console.log('\ncaptureToIntent selftest\n');

const captureTests: Array<[CaptureType, string, string]> = [
  ['idea',     'berlin tea tastings',  'add_idea'],
  ['thought',  'people respond well',  'add_thought'],
  ['win',      'shipped the bot',      'add_win'],
  ['goal',     'launch in q2',         'add_goal'],
  ['resource', 'notion doc link',      'create_resource'],
];

for (const [type, content, expectedIntent] of captureTests) {
  test(`captureToIntent: ${type} → ${expectedIntent} with correct content`, () => {
    const intent = captureToIntent(type, content);
    assert.strictEqual(intent.intent, expectedIntent);
    // check the content is preserved in whichever field is used
    const data = (intent as unknown as { data: Record<string, string> }).data;
    const value = data.content ?? data.title;
    assert.strictEqual(value, content);
  });
}

// ---------------------------------------------------------------------------
// routeClassified — pure 4-way routing from ClassifiedMessage to BotAction
// ---------------------------------------------------------------------------

console.log('\nrouteClassified selftest\n');

function makeClassified(overrides: Partial<ClassifiedMessage> & { route_type: ClassifiedMessage['route_type'] }): ClassifiedMessage {
  return {
    confidence: 'high',
    ambiguities: [],
    ...overrides,
  };
}

// casual → reply
test('routeClassified: casual → reply with the reply text', () => {
  const action = routeClassified(makeClassified({ route_type: 'casual', reply: 'Hey there!' }));
  assert.strictEqual(action.action, 'reply');
  assert.strictEqual((action as { action: string; text: string }).text, 'Hey there!');
});

// casual fallback to user_facing_summary
test('routeClassified: casual with no reply → falls back to user_facing_summary', () => {
  const action = routeClassified(makeClassified({ route_type: 'casual', user_facing_summary: 'Hi!' }));
  assert.strictEqual(action.action, 'reply');
});

// assistant_answer with an answer → reply
test('routeClassified: assistant_answer with answer → reply', () => {
  const action = routeClassified(makeClassified({
    route_type: 'assistant_answer',
    answer: 'Focus on your MIT first.',
  }));
  assert.strictEqual(action.action, 'reply');
  assert.ok((action as { action: string; text: string }).text.includes('MIT'));
});

// assistant_answer with needs_tool and no answer → graceful fallback
test('routeClassified: assistant_answer + needs_tool + no answer → graceful "not connected" reply', () => {
  const action = routeClassified(makeClassified({
    route_type: 'assistant_answer',
    needs_tool: 'weather',
  }));
  assert.strictEqual(action.action, 'reply');
  const text = (action as { action: string; text: string }).text;
  assert.ok(text.includes('weather'), `expected "weather" in: ${text}`);
  assert.ok(!text.includes('undefined'), `should not contain "undefined": ${text}`);
});

// assistant_answer with needs_tool + answer: answer is ignored, graceful fallback used
test('routeClassified: assistant_answer + needs_tool + answer → graceful, ignores fabricated answer', () => {
  const action = routeClassified(makeClassified({
    route_type: 'assistant_answer',
    needs_tool: 'weather',
    answer: 'Canggu is typically warm this time of year.',
  }));
  assert.strictEqual(action.action, 'reply');
  const text = (action as { action: string; text: string }).text;
  assert.ok(text.includes('weather'), `expected "weather" in: ${text}`);
  assert.ok(!text.includes('Canggu'), `fabricated answer should be ignored when needs_tool is set: ${text}`);
});

// capture_candidate medium confidence → confirm_capture
test('routeClassified: capture_candidate medium → confirm_capture', () => {
  const action = routeClassified(makeClassified({
    route_type: 'capture_candidate',
    confidence: 'medium',
    confirm_needed: true,
    capture_type: 'idea',
    capture_content: 'berlin tea tastings',
    user_facing_summary: 'That sounds like an idea — want me to save it?',
  }));
  assert.strictEqual(action.action, 'confirm_capture');
  assert.strictEqual((action as { action: string; captureType: string }).captureType, 'idea');
  assert.strictEqual((action as { action: string; captureContent: string }).captureContent, 'berlin tea tastings');
});

// capture_candidate high + no confirm → execute directly
test('routeClassified: capture_candidate high + confirm:false → execute', () => {
  const action = routeClassified(makeClassified({
    route_type: 'capture_candidate',
    confidence: 'high',
    confirm_needed: false,
    capture_type: 'win',
    capture_content: 'shipped the bot feature',
  }));
  assert.strictEqual(action.action, 'execute');
  assert.strictEqual((action as { action: string; intent: Intent }).intent.intent, 'add_win');
});

// app_action high + no confirm → execute
test('routeClassified: app_action high + confirm:false → execute', () => {
  const baseIntent: Intent = { intent: 'list_tasks', data: { filter: 'today' } };
  const action = routeClassified(makeClassified({
    route_type: 'app_action',
    confidence: 'high',
    confirm_needed: false,
    intent: baseIntent,
    user_facing_summary: "Here are today's tasks.",
  }));
  assert.strictEqual(action.action, 'execute');
  assert.strictEqual((action as { action: string; intent: Intent }).intent.intent, 'list_tasks');
});

// app_action with confirm_needed → confirm_intent
test('routeClassified: app_action + confirm:true → confirm_intent', () => {
  const baseIntent: Intent = { intent: 'complete_task', data: { task_title: 'Review PR' } };
  const action = routeClassified(makeClassified({
    route_type: 'app_action',
    confidence: 'medium',
    confirm_needed: true,
    intent: baseIntent,
    user_facing_summary: 'Mark "Review PR" as done?',
  }));
  assert.strictEqual(action.action, 'confirm_intent');
  assert.ok((action as { action: string; question: string }).question.includes('Review PR'));
});

// app_action low confidence → ask (not execute)
test('routeClassified: app_action low confidence → ask, even if intent present', () => {
  const baseIntent: Intent = { intent: 'complete_task', data: { task_title: 'unknown' } };
  const action = routeClassified(makeClassified({
    route_type: 'app_action',
    confidence: 'low',
    intent: baseIntent,
    follow_up_question: 'Which task did you mean?',
  }));
  assert.strictEqual(action.action, 'ask');
  assert.strictEqual((action as { action: string; question: string }).question, 'Which task did you mean?');
});

// app_action with no intent → ask
test('routeClassified: app_action with no intent → ask', () => {
  const action = routeClassified(makeClassified({
    route_type: 'app_action',
    confidence: 'high',
    // no intent field
    user_facing_summary: 'Could you be more specific?',
  }));
  assert.strictEqual(action.action, 'ask');
});

// ---------------------------------------------------------------------------
// parseBulkTaskLines — pure text parser for multiline task lists
// ---------------------------------------------------------------------------

console.log('\nparseBulkTaskLines selftest\n');

test('parseBulkTaskLines: numbered list → titles only', () => {
  const result = parseBulkTaskLines('1. Build secure layer exit\n2. List bad habits\n3. Book Dubai');
  assert.deepStrictEqual(result, ['Build secure layer exit', 'List bad habits', 'Book Dubai']);
});

test('parseBulkTaskLines: bullet list with dashes → titles only', () => {
  const result = parseBulkTaskLines('- Build feature\n- Write tests\n- Deploy');
  assert.deepStrictEqual(result, ['Build feature', 'Write tests', 'Deploy']);
});

test('parseBulkTaskLines: bullet list with asterisks', () => {
  const result = parseBulkTaskLines('* Alpha\n* Beta\n* Gamma');
  assert.deepStrictEqual(result, ['Alpha', 'Beta', 'Gamma']);
});

test('parseBulkTaskLines: empty lines are skipped', () => {
  const result = parseBulkTaskLines('1. First\n\n2. Second\n\n3. Third');
  assert.deepStrictEqual(result, ['First', 'Second', 'Third']);
});

test('parseBulkTaskLines: single item → still parsed', () => {
  const result = parseBulkTaskLines('1. Only one');
  assert.deepStrictEqual(result, ['Only one']);
});

test('parseBulkTaskLines: all empty lines → empty array', () => {
  const result = parseBulkTaskLines('\n\n\n');
  assert.deepStrictEqual(result, []);
});

// ---------------------------------------------------------------------------
// extractPositionalNumber — pure number extractor
// ---------------------------------------------------------------------------

console.log('\nextractPositionalNumber selftest\n');

test('extractPositionalNumber: "mark 6 done" → 6', () => {
  assert.strictEqual(extractPositionalNumber('mark 6 done'), 6);
});

test('extractPositionalNumber: "mark task 3 done" → 3', () => {
  assert.strictEqual(extractPositionalNumber('mark task 3 done'), 3);
});

test('extractPositionalNumber: "complete 1" → 1', () => {
  assert.strictEqual(extractPositionalNumber('complete 1'), 1);
});

test('extractPositionalNumber: "no number here" → null', () => {
  assert.strictEqual(extractPositionalNumber('no number here'), null);
});

test('extractPositionalNumber: "mark 1 and 2 done" → first number (1)', () => {
  assert.strictEqual(extractPositionalNumber('mark 1 and 2 done'), 1);
});

test('extractPositionalNumber: "move task 10 to tomorrow" → 10', () => {
  assert.strictEqual(extractPositionalNumber('move task 10 to tomorrow'), 10);
});

// ---------------------------------------------------------------------------
// Task list ref resolution logic — pure simulation (no DB)
// ---------------------------------------------------------------------------

console.log('\ntask list ref resolution selftest\n');

// Simulate the resolve logic from bot.ts
function resolveTaskId(
  text: string,
  ref: { taskIds: string[] } | null
): { resolved: string | null; needsClarification: boolean } {
  const pos = extractPositionalNumber(text);
  if (pos === null) return { resolved: null, needsClarification: false };
  if (!ref) return { resolved: null, needsClarification: true };
  if (pos >= 1 && pos <= ref.taskIds.length) {
    return { resolved: ref.taskIds[pos - 1], needsClarification: false };
  }
  return { resolved: null, needsClarification: false }; // out of bounds → let executor handle
}

const mockTaskIds = ['uuid-1', 'uuid-2', 'uuid-3', 'uuid-4', 'uuid-5', 'uuid-6', 'uuid-7', 'uuid-8'];

test('task ref: "mark 6 done" with stored list → resolves to uuid-6', () => {
  const { resolved, needsClarification } = resolveTaskId('mark 6 done', { taskIds: mockTaskIds });
  assert.strictEqual(resolved, 'uuid-6');
  assert.strictEqual(needsClarification, false);
});

test('task ref: "mark 3 done" with today list → resolves to uuid-3', () => {
  const todayIds = ['uuid-a', 'uuid-b', 'uuid-c', 'uuid-d', 'uuid-e'];
  const { resolved } = resolveTaskId('mark 3 done', { taskIds: todayIds });
  assert.strictEqual(resolved, 'uuid-c');
});

test('task ref: "mark 6 done" with no stored list → needs clarification', () => {
  const { resolved, needsClarification } = resolveTaskId('mark 6 done', null);
  assert.strictEqual(resolved, null);
  assert.strictEqual(needsClarification, true);
});

test('task ref: "complete all" (no number) → no positional resolution needed', () => {
  const { resolved, needsClarification } = resolveTaskId('complete all', { taskIds: mockTaskIds });
  assert.strictEqual(resolved, null);
  assert.strictEqual(needsClarification, false);
});

// ---------------------------------------------------------------------------
// Retrieval intents route as app_action (not casual/assistant_answer)
// ---------------------------------------------------------------------------

console.log('\nretrieval intent routing selftest\n');

const retrievalIntents: Intent[] = [
  { intent: 'list_ideas', data: {} },
  { intent: 'list_thoughts', data: {} },
  { intent: 'list_resources', data: {} },
  { intent: 'list_wins', data: {} },
];

for (const intent of retrievalIntents) {
  test(`routeClassified: app_action ${intent.intent} → execute directly`, () => {
    const action = routeClassified(makeClassified({
      route_type: 'app_action',
      confidence: 'high',
      confirm_needed: false,
      intent,
    }));
    assert.strictEqual(action.action, 'execute');
    assert.strictEqual((action as { action: string; intent: Intent }).intent.intent, intent.intent);
  });
}

// ---------------------------------------------------------------------------
// fmtDate — no DB, no timezone issues
// ---------------------------------------------------------------------------

console.log('\nfmtDate selftest\n');

test('fmtDate: string "2026-03-07" → "Sat Mar 07"', () => {
  assert.strictEqual(fmtDate('2026-03-07'), 'Sat Mar 07');
});

test('fmtDate: string "2026-03-01" → "Sun Mar 01"', () => {
  assert.strictEqual(fmtDate('2026-03-01'), 'Sun Mar 01');
});

test('fmtDate: null → empty string', () => {
  assert.strictEqual(fmtDate(null), '');
});

test('fmtDate: undefined → empty string', () => {
  assert.strictEqual(fmtDate(undefined), '');
});

test('fmtDate: Date object (UTC midnight) → correct calendar date, no timezone suffix', () => {
  // pg returns DATE columns as Date objects at UTC midnight
  const d = new Date('2026-03-07T00:00:00.000Z');
  const result = fmtDate(d);
  assert.ok(!result.includes('GMT'), `should not contain timezone: ${result}`);
  assert.ok(!result.includes('0:00'), `should not contain time: ${result}`);
  assert.ok(result.includes('Mar 07'), `should contain "Mar 07": ${result}`);
});

test('fmtDate: does not show raw ISO timestamp string', () => {
  const result = fmtDate('2026-03-07');
  assert.ok(!result.includes('T'), `should not contain T: ${result}`);
  assert.ok(!result.includes('Z'), `should not contain Z: ${result}`);
});

// ---------------------------------------------------------------------------
// Debrief cancel logic — pure simulation (no Telegraf, no DB)
// ---------------------------------------------------------------------------

console.log('\ndebrief cancel selftest\n');

const CANCEL_WORDS = ['no', 'n', 'nope', 'cancel', 'nah', 'stop', "don't", 'exit', 'quit'];

function shouldCancelDebrief(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return CANCEL_WORDS.includes(lower);
}

test('debrief cancel: "cancel" → true', () => {
  assert.strictEqual(shouldCancelDebrief('cancel'), true);
});

test('debrief cancel: "no" → true', () => {
  assert.strictEqual(shouldCancelDebrief('no'), true);
});

test('debrief cancel: "stop" → true', () => {
  assert.strictEqual(shouldCancelDebrief('stop'), true);
});

test('debrief cancel: "exit" → true', () => {
  assert.strictEqual(shouldCancelDebrief('exit'), true);
});

test('debrief cancel: actual debrief content "MIT: Fix bug" → false', () => {
  assert.strictEqual(shouldCancelDebrief('MIT: Fix bug'), false);
});

test('debrief cancel: "yes" → false', () => {
  assert.strictEqual(shouldCancelDebrief('yes'), false);
});

test('debrief confirmation: "yes" → confirmed', () => {
  const lower = 'yes';
  const confirmed = lower === 'yes' || lower === 'y' || lower === 'confirm';
  assert.strictEqual(confirmed, true);
});

test('debrief confirmation: "no" → not confirmed → should cancel cleanly', () => {
  const lower: string = 'no'; // typed as string to avoid TS literal narrowing
  const confirmed = lower === 'yes' || lower === 'y' || lower === 'confirm';
  assert.strictEqual(confirmed, false);
  // anything not confirmed → session cleared, not saved
});

// ---------------------------------------------------------------------------
// complete_task null-check logic — simulate executor behavior
// ---------------------------------------------------------------------------

console.log('\ncomplete_task null-check selftest\n');

// Simulates the null check added to the complete_task executor case
function handleCompleteResult(
  updated: { status: string; title: string } | null,
  taskTitle: string
): { success: boolean; message: string } {
  if (!updated) {
    return { success: false, message: `Could not complete "${taskTitle}" — please try again.` };
  }
  return { success: true, message: `Completed: "${taskTitle}"` };
}

test('complete_task: updated=null → success:false with useful message', () => {
  const result = handleCompleteResult(null, 'Book Dubai');
  assert.strictEqual(result.success, false);
  assert.ok(result.message.includes('Book Dubai'), `should mention task: ${result.message}`);
  assert.ok(!result.message.toLowerCase().includes('something went wrong'), `should not be generic: ${result.message}`);
});

test('complete_task: updated returned → success:true', () => {
  const result = handleCompleteResult({ status: 'done', title: 'Book Dubai' }, 'Book Dubai');
  assert.strictEqual(result.success, true);
  assert.ok(result.message.includes('Book Dubai'));
});

// ---------------------------------------------------------------------------
// undo truthfulness — simulate rowCount checks
// ---------------------------------------------------------------------------

console.log('\nundo truthfulness selftest\n');

function handleUndoRowCount(
  action: string,
  rowCount: number
): { success: boolean; message: string } {
  if (rowCount === 0) {
    if (action === 'create') return { success: false, message: 'Could not undo: the record was already deleted or not found.' };
    return { success: false, message: 'Could not undo: record no longer exists.' };
  }
  if (action === 'create') return { success: true, message: 'Undone: last created item removed.' };
  if (action === 'complete') return { success: true, message: 'Undone: task marked incomplete.' };
  if (action === 'move_date') return { success: true, message: 'Undone: task date restored.' };
  return { success: false, message: `Cannot undo "${action}".` };
}

test('undo: rowCount=0 for create → success:false, not pretending success', () => {
  const result = handleUndoRowCount('create', 0);
  assert.strictEqual(result.success, false);
  assert.ok(!result.message.toLowerCase().includes('undone:'), `should not claim success: ${result.message}`);
});

test('undo: rowCount=1 for create → success:true', () => {
  const result = handleUndoRowCount('create', 1);
  assert.strictEqual(result.success, true);
});

test('undo: rowCount=0 for complete → success:false', () => {
  const result = handleUndoRowCount('complete', 0);
  assert.strictEqual(result.success, false);
});

test('undo: rowCount=1 for complete → success:true', () => {
  const result = handleUndoRowCount('complete', 1);
  assert.strictEqual(result.success, true);
  assert.ok(result.message.includes('incomplete'), `should confirm it was un-done: ${result.message}`);
});

// ---------------------------------------------------------------------------
// extractPositionalNumbers (plural) — multi-number extraction
// ---------------------------------------------------------------------------

console.log('\nextractPositionalNumbers selftest\n');

test('extractPositionalNumbers: "mark 7,8 done" → [7, 8]', () => {
  assert.deepStrictEqual(extractPositionalNumbers('mark 7,8 done'), [7, 8]);
});

test('extractPositionalNumbers: "mark 1 and 2 done" → [1, 2]', () => {
  assert.deepStrictEqual(extractPositionalNumbers('mark 1 and 2 done'), [1, 2]);
});

test('extractPositionalNumbers: "move 3, 4, 5 to tomorrow" → [3, 4, 5]', () => {
  assert.deepStrictEqual(extractPositionalNumbers('move 3, 4, 5 to tomorrow'), [3, 4, 5]);
});

test('extractPositionalNumbers: "mark 6 done" → [6] (single number)', () => {
  assert.deepStrictEqual(extractPositionalNumbers('mark 6 done'), [6]);
});

test('extractPositionalNumbers: "no numbers here" → []', () => {
  assert.deepStrictEqual(extractPositionalNumbers('no numbers here'), []);
});

test('extractPositionalNumbers: deduplicates repeated numbers', () => {
  assert.deepStrictEqual(extractPositionalNumbers('mark 3 and 3 done'), [3]);
});

// ---------------------------------------------------------------------------
// Bulk complete positional resolution logic
// ---------------------------------------------------------------------------

console.log('\nbulk complete resolution selftest\n');

function resolveBulkTaskIds(
  positions: number[],
  ref: { taskIds: string[] } | null
): { resolved: string[]; needsClarification: boolean } {
  if (!ref) return { resolved: [], needsClarification: true };
  const resolved = positions
    .filter((p) => p >= 1 && p <= ref.taskIds.length)
    .map((p) => ref.taskIds[p - 1]);
  return { resolved, needsClarification: false };
}

const mockIds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

test('bulk resolve: positions [7, 8] with 8 tasks → [g, h]', () => {
  const { resolved, needsClarification } = resolveBulkTaskIds([7, 8], { taskIds: mockIds });
  assert.deepStrictEqual(resolved, ['g', 'h']);
  assert.strictEqual(needsClarification, false);
});

test('bulk resolve: positions [1, 2] with stored list → [a, b]', () => {
  const { resolved } = resolveBulkTaskIds([1, 2], { taskIds: mockIds });
  assert.deepStrictEqual(resolved, ['a', 'b']);
});

test('bulk resolve: no stored list → needs clarification', () => {
  const { resolved, needsClarification } = resolveBulkTaskIds([1, 2], null);
  assert.deepStrictEqual(resolved, []);
  assert.strictEqual(needsClarification, true);
});

test('bulk resolve: out-of-range positions are skipped', () => {
  const { resolved } = resolveBulkTaskIds([3, 99], { taskIds: ['x', 'y', 'z'] });
  assert.deepStrictEqual(resolved, ['z']);
});

// ---------------------------------------------------------------------------
// group_action routing — must route to execute or confirm_intent, never reply
// ---------------------------------------------------------------------------

console.log('\ngroup_action routing selftest\n');

test('routeClassified: group_action confirm:true → confirm_intent', () => {
  const intent: Intent = {
    intent: 'group_action',
    data: { action: 'complete', group: 'overdue' },
  };
  const action = routeClassified({
    route_type: 'app_action',
    confidence: 'high',
    confirm_needed: true,
    intent,
    user_facing_summary: 'Mark all overdue tasks as done?',
    ambiguities: [],
  });
  assert.strictEqual(action.action, 'confirm_intent');
  assert.ok((action as { action: string; question: string }).question.toLowerCase().includes('overdue'));
});

test('routeClassified: complete_tasks_bulk high confirm:false → execute', () => {
  const intent: Intent = {
    intent: 'complete_tasks_bulk',
    data: { positions: [1, 2] },
  };
  const action = routeClassified({
    route_type: 'app_action',
    confidence: 'high',
    confirm_needed: false,
    intent,
    ambiguities: [],
  });
  assert.strictEqual(action.action, 'execute');
  assert.strictEqual((action as { action: string; intent: Intent }).intent.intent, 'complete_tasks_bulk');
});

test('routeClassified: move_tasks_bulk high confirm:false → execute', () => {
  const intent: Intent = {
    intent: 'move_tasks_bulk',
    data: { positions: [3, 4], new_due_date: '2026-03-08' },
  };
  const action = routeClassified({
    route_type: 'app_action',
    confidence: 'high',
    confirm_needed: false,
    intent,
    ambiguities: [],
  });
  assert.strictEqual(action.action, 'execute');
});

// ---------------------------------------------------------------------------
// Debrief save logic — pure simulation (no DB, no Claude)
// ---------------------------------------------------------------------------

console.log('\ndebrief save logic selftest\n');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(id: string): boolean { return UUID_RE.test(id); }

// Simulate save_debrief validation logic from executor.ts
function validateDebriefIds(ids: string[]): { valid: string[]; invalid: string[] } {
  return {
    valid: ids.filter(isValidUUID),
    invalid: ids.filter((id) => !isValidUUID(id)),
  };
}

// Simulate debrief task positional resolution from claude.ts prompt logic
function resolveDebriefPosition(
  position: number,
  tasks: Array<{ id: string; title: string }>
): string | null {
  if (position >= 1 && position <= tasks.length) return tasks[position - 1].id;
  return null;
}

const DEBRIEF_TASKS = [
  { id: 'aaaaaaaa-1111-2222-3333-444444444444', title: 'Finish proposal', due_date: '2026-03-06' },
  { id: 'bbbbbbbb-1111-2222-3333-444444444444', title: 'Review PR', due_date: '2026-03-06' },
  { id: 'cccccccc-1111-2222-3333-444444444444', title: 'Email client', due_date: '2026-03-07' },
  { id: 'dddddddd-1111-2222-3333-444444444444', title: 'Write tests', due_date: '2026-03-07' },
  { id: 'eeeeeeee-1111-2222-3333-444444444444', title: 'Deploy feature', due_date: '2026-03-08' },
];

// Test: debrief save with only MIT/K1/journal/wins — no task refs → all valid
test('debrief save: MIT+K1+journal+wins only — no task IDs → validates cleanly', () => {
  const taskCompletions: string[] = [];
  const taskChanges: string[] = [];
  const { valid, invalid } = validateDebriefIds([...taskCompletions, ...taskChanges]);
  assert.deepStrictEqual(valid, []);
  assert.deepStrictEqual(invalid, []);
});

// Test: debrief save with one valid positional task move (task 5 → full UUID resolved)
test('debrief save: positional "task 5" resolves to correct UUID', () => {
  const resolved = resolveDebriefPosition(5, DEBRIEF_TASKS);
  assert.strictEqual(resolved, 'eeeeeeee-1111-2222-3333-444444444444');
});

// Test: debrief save with positional task completion — resolved UUID passes validation
test('debrief save: resolved UUID from position passes isValidUUID', () => {
  const resolved = resolveDebriefPosition(1, DEBRIEF_TASKS);
  assert.ok(resolved !== null);
  assert.strictEqual(isValidUUID(resolved!), true);
});

// Test: 8-char prefix (old bug) fails UUID validation → not passed to DB
test('debrief save: 8-char prefix ID fails UUID validation → skipped safely', () => {
  const fakeId = 'aaaaaaaa'; // what Claude used to return from truncated context
  assert.strictEqual(isValidUUID(fakeId), false);
  const { invalid } = validateDebriefIds([fakeId]);
  assert.deepStrictEqual(invalid, [fakeId]);
});

// Test: full UUID passes validation
test('debrief save: full UUID passes validation', () => {
  const fullId = 'aaaaaaaa-1111-2222-3333-444444444444';
  assert.strictEqual(isValidUUID(fullId), true);
  const { valid } = validateDebriefIds([fullId]);
  assert.deepStrictEqual(valid, [fullId]);
});

// Test: mixed valid + invalid IDs are split correctly
test('debrief save: mixed IDs — valid and invalid separated correctly', () => {
  const ids = [
    'aaaaaaaa-1111-2222-3333-444444444444', // valid
    'bbbbbbbb',                              // invalid (8-char prefix)
    'cccccccc-1111-2222-3333-444444444444', // valid
  ];
  const { valid, invalid } = validateDebriefIds(ids);
  assert.strictEqual(valid.length, 2);
  assert.strictEqual(invalid.length, 1);
  assert.strictEqual(invalid[0], 'bbbbbbbb');
});

// Test: out-of-range position returns null (graceful, no UUID passed)
test('debrief save: out-of-range position returns null — not passed to DB', () => {
  const resolved = resolveDebriefPosition(99, DEBRIEF_TASKS);
  assert.strictEqual(resolved, null);
});

// Test: session clear logic — after debrief confirm, session must be cleared
test('debrief confirm: session cleared after successful save', () => {
  type State = 'debrief_awaiting_confirmation' | 'idle';
  let state: State = 'debrief_awaiting_confirmation';
  // Simulate bot.ts confirm branch: clearSession after executeIntent
  function handleConfirm(confirmed: boolean): State {
    if (confirmed) {
      state = 'idle'; // clearSession
      return state;
    }
    state = 'idle'; // also cleared on cancel
    return state;
  }
  assert.strictEqual(handleConfirm(true), 'idle');
});

test('debrief confirm: session cleared on cancel too', () => {
  type State = 'debrief_awaiting_confirmation' | 'idle';
  let state: State = 'debrief_awaiting_confirmation';
  function handleConfirm(confirmed: boolean): State {
    if (!confirmed) { state = 'idle'; }
    return state;
  }
  assert.strictEqual(handleConfirm(false), 'idle');
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
