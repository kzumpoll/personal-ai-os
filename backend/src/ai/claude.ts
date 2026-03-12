import Anthropic from '@anthropic-ai/sdk';
import { Intent, InterpretationDraft, CaptureType } from './intents';
import { ContextPack, contextPackToString } from './context';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface DayPlanMutation {
  type: 'show' | 'remove_event' | 'change_wake_time' | 'move_block' | 'remove_block' | 'regenerate' | 'log_win' | 'set_mit' | 'set_p1' | 'set_p2' | 'complete_mit' | 'complete_p1' | 'complete_p2' | 'plan_question' | 'add_block' | 'rename_block' | 'resize_block' | 'unknown';
  event_id?: string;       // for remove_event
  event_title?: string;    // for remove_event (display)
  new_time?: string;       // for change_wake_time (HH:MM)
  block_title?: string;    // for move_block, remove_block, rename_block, resize_block, add_block
  new_start?: string;      // for move_block, add_block (HH:MM)
  new_title?: string;      // for rename_block
  duration_min?: number;   // for add_block, resize_block
  win_content?: string;    // for log_win
  mit_value?: string;      // for set_mit
  p1_value?: string;       // for set_p1
  p2_value?: string;       // for set_p2
  target_date?: string;    // for set_mit/p1/p2 (YYYY-MM-DD)
  answer_text?: string;    // for plan_question
  message?: string;        // for unknown
}

// ─── Unified User Intent ──────────────────────────────────────────────────────
// Single structured result returned by the unified interpretUserIntent call.
export type UserIntent =
  | { type: 'day_plan_mutation'; mutation: DayPlanMutation }
  | { type: 'app_action'; intent: Intent; confirm_needed: boolean; confidence: 'high' | 'medium' | 'low'; user_facing_summary: string; follow_up_question?: string }
  | { type: 'capture'; capture_type: CaptureType; content: string; confirm_question: string }
  | { type: 'answer'; text: string; needs_tool?: string; tool_params?: Record<string, unknown> }
  | { type: 'casual'; reply: string }
  | { type: 'clarify'; question: string; options?: string[] };


const DRAFT_SYSTEM_PROMPT = `You are a personal AI OS assistant. Parse user messages and return a structured interpretation draft.

Always respond with a single JSON object. Never add prose outside the JSON.

Output format:
{
  "intent": { <full intent object — see schema below> },
  "normalized_meaning": "plain English summary of what was understood",
  "confidence": "high" | "medium" | "low",
  "ambiguities": ["describe any ambiguity here, or leave empty array"],
  "user_facing_summary": "friendly natural sentence: what you will do, or what you need clarified",
  "confirm_needed": false,
  "follow_up_question": "one concise question — include only when confidence is low"
}

Intent schema (the "intent" field must always be one of these):
  create_task:    { "intent": "create_task",    "data": { "title": "...", "notes"?: "...", "due_date"?: "YYYY-MM-DD", "project_id"?: "..." } }
  list_tasks:     { "intent": "list_tasks",     "data": { "filter"?: "overdue"|"today"|"tomorrow"|"upcoming"|"all" } }
  complete_task:  { "intent": "complete_task",  "data": { "task_id"?: "UUID", "task_title"?: "..." } }
  move_task_date: { "intent": "move_task_date", "data": { "task_id"?: "UUID", "task_title"?: "...", "new_due_date": "YYYY-MM-DD" } }
  add_thought:    { "intent": "add_thought",    "data": { "content": "..." } }
  add_idea:       { "intent": "add_idea",       "data": { "content": "...", "actionability"?: "..." } }
  add_win:        { "intent": "add_win",        "data": { "content": "...", "entry_date"?: "YYYY-MM-DD" } }
  add_goal:       { "intent": "add_goal",       "data": { "title": "...", "description"?: "...", "target_date"?: "YYYY-MM-DD" } }
  create_resource:{ "intent": "create_resource","data": { "title": "...", "content_or_url"?: "...", "type"?: "..." } }
  daily_debrief:  { "intent": "daily_debrief",  "data": {} }
  undo_last:      { "intent": "undo_last",       "data": {} }
  unknown:        { "intent": "unknown",         "data": { "message": "..." } }

ALWAYS include the "data" field, even if empty (e.g. "data": {}).

Confidence + confirm_needed rules:
  "high" + confirm_needed: false  → execute immediately. Use for: list/view requests, clear single-step commands.
  "high" + confirm_needed: true   → confirm first. Use for: destructive/irreversible actions that are unambiguous.
  "medium" + confirm_needed: true → confirm first. Use for: vague statements that could be ideas/thoughts ("X could be cool"), or actions where key detail is inferred.
  "medium" + confirm_needed: false→ execute. Use for: likely correct but non-destructive (e.g. reading tasks) where a guess is fine.
  "low" + confirm_needed: false   → ask a clarifying question. Use for: genuinely unclear messages. Include follow_up_question.

Natural language tolerance:
  "show tasks", "what do i have today", "what's on today", "show tasks for today" → list_tasks filter:today, HIGH, confirm:false
  "what do i need to do today", "what is on today" → list_tasks filter:today, HIGH, confirm:false
  "mark 1 done" → complete_task (match task 1 from context TODAY list by position), HIGH, confirm:false
  "mark 1 and 2 done" → complete_task for task 1, MEDIUM, confirm:true — note in summary that task 2 also needs doing
  "mark 1,2,,7,8,2728 done" → LOW confidence — follow_up_question asking which tasks they mean
  "X could be cool", "i had an idea about X", "been thinking about X" → add_idea, MEDIUM, confirm:true
  "remember X", "note X" → add_thought, HIGH, confirm:false

Numbered task references (e.g. "1", "2", "3") refer to the positional order of tasks in the TODAY list from context.
Use the full UUID from context when resolving task IDs. For dates, resolve relative terms using the Today date in context.`;

const SYSTEM_PROMPT = `You are a personal AI operating system assistant. Parse user messages and return structured JSON intents.

Always respond with a single JSON object. Never add prose outside the JSON.

Available intents:
- create_task: { title, notes?, due_date? (YYYY-MM-DD), project_id? }
- list_tasks: { filter?: 'overdue'|'today'|'tomorrow'|'upcoming'|'all' }
- complete_task: { task_id? (8-char prefix from context), task_title? }
- move_task_date: { task_id? (8-char prefix), task_title?, new_due_date (YYYY-MM-DD) }
- add_thought: { content }
- add_idea: { content, actionability? }
- add_win: { content, entry_date? (YYYY-MM-DD) }
- add_goal: { title, description?, target_date? (YYYY-MM-DD) }
- create_resource: { title, content_or_url?, type? }
- daily_debrief: {}
- undo_last: {}
- unknown: { message }

Use task IDs from the context when matching tasks by name.
For dates, resolve relative terms (today, tomorrow, next Monday, etc.) using the "Today" date in context.
For task IDs: use the full UUID from context, not the 8-char prefix, in the output.`;

export async function interpretMessage(
  userMessage: string,
  context: ContextPack
): Promise<Intent> {
  const contextStr = contextPackToString(context);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Context:\n${contextStr}\n\nMessage: ${userMessage}`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    // Strip markdown code blocks if present
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    return JSON.parse(cleaned) as Intent;
  } catch {
    return { intent: 'unknown', data: { message: text } };
  }
}

export async function interpretWithDraft(
  userMessage: string,
  context: ContextPack
): Promise<InterpretationDraft> {
  const contextStr = contextPackToString(context);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 768,
    system: DRAFT_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Context:\n${contextStr}\n\nMessage: ${userMessage}`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const draft = JSON.parse(cleaned) as InterpretationDraft;

    // Guarantee intent.data always exists — prevents the undefined-filter crash
    if (draft.intent && !draft.intent.data) {
      (draft.intent as unknown as Record<string, unknown>).data = {};
    }
    if (!Array.isArray(draft.ambiguities)) {
      draft.ambiguities = [];
    }
    return draft;
  } catch {
    return {
      intent: { intent: 'unknown', data: { message: text } },
      normalized_meaning: 'Could not parse AI response',
      confidence: 'low',
      ambiguities: ['Failed to parse interpretation'],
      user_facing_summary: "I didn't quite catch that — could you rephrase?",
      confirm_needed: false,
      follow_up_question: "I didn't quite catch that — could you rephrase?",
    };
  }
}


// ---------------------------------------------------------------------------
// Debrief response parser — exported for testing
// ---------------------------------------------------------------------------

/**
 * Extract the first balanced {...} JSON block from a string.
 * Handles nested objects and string literals with escape sequences.
 */
export function extractFirstJsonBlock(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Scan text for a JSON block that has "intent": "save_debrief".
 * Used as a last-resort extraction when the block is embedded in prose.
 */
function findEmbeddedSaveDebrief(text: string): string | null {
  const marker = 'save_debrief';
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const idx = text.indexOf(marker, searchFrom);
    if (idx === -1) break;
    // Walk back to the nearest { before this occurrence
    const lastBrace = text.lastIndexOf('{', idx);
    if (lastBrace !== -1) {
      const block = extractFirstJsonBlock(text.slice(lastBrace));
      if (block) {
        try {
          const parsed = JSON.parse(block) as Record<string, unknown>;
          if (parsed.intent === 'save_debrief') return block;
        } catch { /* continue */ }
      }
    }
    searchFrom = idx + 1;
  }
  return null;
}

/**
 * Given a parsed JSON object, try to extract a valid save_debrief intent from it.
 * Handles:
 *   - Direct { intent: "save_debrief", data: {...} }
 *   - { intent: "unknown", data: { message: "...embedded save_debrief JSON..." } }
 */
function extractSaveDebrief(parsed: Record<string, unknown>): Intent | null {
  if (parsed.intent === 'save_debrief' && parsed.data && typeof parsed.data === 'object') {
    return parsed as unknown as Intent;
  }
  if (parsed.intent === 'unknown' && parsed.data && typeof parsed.data === 'object') {
    const msg = (parsed.data as Record<string, unknown>).message;
    if (typeof msg === 'string') {
      try {
        const inner = JSON.parse(msg.trim()) as Record<string, unknown>;
        if (inner.intent === 'save_debrief') return inner as unknown as Intent;
      } catch { /* try block extraction */ }
      const block = extractFirstJsonBlock(msg);
      if (block) {
        try {
          const inner = JSON.parse(block) as Record<string, unknown>;
          if (inner.intent === 'save_debrief') return inner as unknown as Intent;
        } catch { /* try embedded scan */ }
      }
      const embedded = findEmbeddedSaveDebrief(msg);
      if (embedded) {
        try {
          const inner = JSON.parse(embedded) as Record<string, unknown>;
          if (inner.intent === 'save_debrief') return inner as unknown as Intent;
        } catch { /* give up */ }
      }
    }
  }
  return null;
}

/**
 * Parse a raw model output string into a save_debrief Intent.
 * Tries multiple recovery strategies before giving up.
 * Returns { intent, repaired: boolean } or null if all strategies fail.
 *
 * Strategy order:
 *   1. Direct JSON.parse → validate save_debrief
 *   2. Strip markdown fences → parse → validate
 *   3. Extract first balanced {} block → parse → validate
 *   4. Scan raw string for embedded save_debrief block
 */
export function parseDebriefResponse(raw: string): { intent: Intent; repaired: boolean } | null {
  const trimmed = raw.trim();

  // Strategy 1: direct parse
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const recovered = extractSaveDebrief(parsed);
    if (recovered) return { intent: recovered, repaired: false };
  } catch { /* try next */ }

  // Strategy 2: strip markdown fences
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
  if (stripped !== trimmed) {
    try {
      const parsed = JSON.parse(stripped) as Record<string, unknown>;
      const recovered = extractSaveDebrief(parsed);
      if (recovered) return { intent: recovered, repaired: true };
    } catch { /* try next */ }
  }

  // Strategy 3: extract first balanced JSON block from raw text
  const block = extractFirstJsonBlock(raw);
  if (block) {
    try {
      const parsed = JSON.parse(block) as Record<string, unknown>;
      const recovered = extractSaveDebrief(parsed);
      if (recovered) return { intent: recovered, repaired: true };
    } catch { /* try next */ }
  }

  // Strategy 4: scan raw for any embedded save_debrief JSON
  const embedded = findEmbeddedSaveDebrief(raw);
  if (embedded) {
    try {
      const parsed = JSON.parse(embedded) as Record<string, unknown>;
      const recovered = extractSaveDebrief(parsed);
      if (recovered) return { intent: recovered, repaired: true };
    } catch { /* give up */ }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Debrief system prompt — raw JSON only, no prose, no fences
// ---------------------------------------------------------------------------

const DEBRIEF_SYSTEM_PROMPT = `You are a debrief data extractor. Your ONLY job is to interpret the user's debrief message and return a single JSON object.

The input may be a messy voice transcript with filler words, corrections, digressions, and long reflections. This is normal. Your job is to extract the structured intent from the mess.

Handling messy input:
- Voice transcripts often contain: "um", "like", "actually no", "wait", corrections mid-sentence
- "move 2, no leave 2" → the correction ("no leave 2") wins — do NOT move task 2
- "3 done, 5 to saturday, 7 to saturday" → parse each action even without explicit labels
- Long rambling paragraphs about reflections → summarize into open_journal
- If the user mentions accomplishments → extract as wins
- Partial information is fine — extract what you can, omit what you can't

CRITICAL OUTPUT RULES — these are absolute and must never be violated:
- Output RAW JSON only. Nothing else.
- No markdown code fences. No backticks. No \`\`\`json blocks.
- No prose, notes, explanations, or commentary before or after the JSON.
- Do NOT wrap in {"intent":"unknown",...} — if uncertain about a field, omit it.
- Your entire response must start with { and end with }.
- Never add a "Notes:" section or any text after the closing brace.
- ALWAYS return intent "save_debrief" even if only some fields could be extracted.`;

export async function interpretDebriefReply(
  userReply: string,
  debriefDate: string,
  planDate: string,
  context: ContextPack,
  debriefTasks: Array<{ id: string; title: string; due_date: string | null }> = []
): Promise<Intent> {
  const contextStr = contextPackToString(context);

  const taskListStr = debriefTasks.length
    ? debriefTasks
        .map((t, i) => `${i + 1}. [${t.id}] ${t.title}${t.due_date ? ` (due: ${t.due_date})` : ''}`)
        .join('\n')
    : 'No open tasks.';

  const prompt = `You are parsing a daily debrief reply. The user is debriefing ${debriefDate} and planning ${planDate}.

IMPORTANT: The input may be a messy voice transcript — rambling, corrections, filler words. This is normal. Extract what you can.

Task reference list (use FULL UUIDs from this list, never 8-char prefixes):
${taskListStr}

Extract from their message:
- wake_time (HH:MM for ${planDate}; "7am"→"07:00", "6:30"→"06:30", "around 8"→"08:00")
- work_start (HH:MM, optional)
- MIT (Most Important Task for ${planDate} — may be described loosely, match to a task or use verbatim)
- P1, P2 (next 2 priority tasks for ${planDate})
- open_journal (reflections, notes, thoughts from ${debriefDate} — summarize rambling into coherent paragraphs)
- wins (list of wins/accomplishments from ${debriefDate} — even if mentioned in passing)
- task_completions (full UUIDs of tasks marked done — match by position number, name, or description)
- task_due_date_changes (tasks to reschedule — use full UUIDs, new date YYYY-MM-DD)
- task_deletions (tasks to permanently delete — use full UUIDs)

Task action rules:
- "3. done" or "complete 3" or "finished 3" → task_completions
- "5. to saturday" or "move 5 to march 14" → task_due_date_changes
- "move 2, no leave 2" → the LAST instruction wins (leave 2 alone)
- "9. delete" or "delete 9" → task_deletions
- Numbers refer to the position in the task list above
- "tomorrow" → ${planDate}; "saturday" / "sunday" / weekday names → resolve from ${planDate}
- Resolve all relative dates using today = ${planDate}

Additional context: ${contextStr}

Return this exact JSON shape (omit fields that are not mentioned; do not include empty arrays):
{
  "intent": "save_debrief",
  "data": {
    "entry_date": "${planDate}",
    "debrief_date": "${debriefDate}",
    "wake_time": "HH:MM",
    "work_start": "HH:MM",
    "mit": "...",
    "p1": "...",
    "p2": "...",
    "mit_start_action": "one-sentence first step for MIT (max 15 words)",
    "p1_start_action": "one-sentence first step for P1 (max 15 words)",
    "p2_start_action": "one-sentence first step for P2 (max 15 words)",
    "open_journal": "...",
    "wins": ["...", "..."],
    "task_completions": ["full-uuid-1"],
    "task_due_date_changes": [{ "id": "full-uuid", "due_date": "YYYY-MM-DD" }],
    "task_deletions": ["full-uuid-to-delete"]
  }
}

ALWAYS return intent "save_debrief" with whatever fields you can extract. Never return "unknown".

User reply: ${userReply}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: DEBRIEF_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  const result = parseDebriefResponse(text);

  if (result) {
    if (result.repaired) {
      console.warn('[interpretDebriefReply] repaired malformed output (recovered save_debrief from wrapper/fences)');
    }
    return result.intent;
  }

  // First attempt failed to produce valid JSON. Retry with a recovery prompt
  // that gets the raw output and asks Claude to fix it.
  console.warn('[interpretDebriefReply] first attempt parse failure — retrying with recovery prompt');
  console.warn('[interpretDebriefReply] raw output (first 500 chars):', text.slice(0, 500));

  try {
    const recoveryResponse = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `You are a JSON repair tool. The previous attempt to extract debrief data produced invalid output. Fix it.

Output ONLY a valid JSON object starting with { and ending with }.
The JSON must have "intent": "save_debrief" and a "data" object.
Extract whatever structured data you can from the original input. Partial data is fine.
Never return intent "unknown". Always return "save_debrief".`,
      messages: [
        { role: 'user', content: `Original user input:\n${userReply}\n\nFailed model output:\n${text}\n\nTask list:\n${taskListStr}\n\nDebrief date: ${debriefDate}\nPlan date: ${planDate}\n\nReturn a valid save_debrief JSON.` },
      ],
    });

    const retryText = recoveryResponse.content[0].type === 'text' ? recoveryResponse.content[0].text : '';
    const retryResult = parseDebriefResponse(retryText);

    if (retryResult) {
      console.log('[interpretDebriefReply] recovery succeeded');
      return retryResult.intent;
    }

    // Even recovery failed — build a minimal save_debrief from whatever we have
    console.error('[interpretDebriefReply] recovery also failed — building minimal intent');
    console.error('[interpretDebriefReply] retry raw:', retryText.slice(0, 300));
  } catch (retryErr) {
    console.error('[interpretDebriefReply] recovery call failed:', retryErr instanceof Error ? retryErr.message : retryErr);
  }

  // Last resort: return a minimal save_debrief so the user at least gets to see
  // a confirmation screen they can correct, rather than a hard failure.
  return {
    intent: 'save_debrief',
    data: {
      entry_date: planDate,
      debrief_date: debriefDate,
      open_journal: userReply.slice(0, 2000),
    },
  } as Intent;
}


/** Short month-day formatter — kept inline to avoid importing executor.ts */
function fmtShortDate(d: string | null | undefined): string {
  if (!d) return '?';
  const s = String(d).slice(0, 10);
  const parts = s.split('-').map(Number);
  if (parts.length !== 3) return s;
  const [, m, day] = parts;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${String(day).padStart(2, '0')}`;
}

export async function confirmDebriefSummary(
  intent: Intent,
  debriefTasks: Array<{ id: string; title: string; due_date?: string | null }> = []
): Promise<string> {
  if (intent.intent !== 'save_debrief') return 'Could not interpret debrief — please try again or correct below.';

  const d = intent.data;
  const debriefStr = fmtShortDate(d.debrief_date ?? d.entry_date);
  const planStr = fmtShortDate(d.entry_date);
  const lines: string[] = [
    `Proposed Debrief Summary`,
    `Debrief: ${debriefStr} → Plan: ${planStr}`,
    '─────────────────────',
  ];

  if (d.wake_time) lines.push(`\nWake: ${d.wake_time}`);

  if (d.mit) {
    const taskNum = debriefTasks.findIndex((t) => t.id === d.mit || t.title === d.mit);
    lines.push(`\nMIT:\n${taskNum >= 0 ? `Task ${taskNum + 1} — ` : ''}${d.mit}`);
    if (d.mit_start_action) lines.push(`→ ${d.mit_start_action}`);
  }
  if (d.p1) {
    const taskNum = debriefTasks.findIndex((t) => t.id === d.p1 || t.title === d.p1);
    lines.push(`\nP1:\n${taskNum >= 0 ? `Task ${taskNum + 1} — ` : ''}${d.p1}`);
    if (d.p1_start_action) lines.push(`→ ${d.p1_start_action}`);
  }
  if (d.p2) {
    const taskNum = debriefTasks.findIndex((t) => t.id === d.p2 || t.title === d.p2);
    lines.push(`\nP2:\n${taskNum >= 0 ? `Task ${taskNum + 1} — ` : ''}${d.p2}`);
    if (d.p2_start_action) lines.push(`→ ${d.p2_start_action}`);
  }

  if (d.open_journal) lines.push(`\nJournal:\n${d.open_journal}`);
  if (d.wins?.length) lines.push(`\nWins:\n${d.wins.map((w) => `- ${w}`).join('\n')}`);

  // Task changes section
  const taskChanges: string[] = [];

  if (d.task_due_date_changes?.length) {
    for (const c of d.task_due_date_changes) {
      const idx = debriefTasks.findIndex((t) => t.id === c.id);
      const name = idx >= 0 ? `${idx + 1}` : String(c.id).slice(0, 8);
      taskChanges.push(`${name} → ${fmtShortDate(c.due_date)}`);
    }
  }

  if (d.task_completions?.length) {
    for (const id of d.task_completions) {
      const idx = debriefTasks.findIndex((t) => t.id === id);
      const name = idx >= 0 ? `${idx + 1}` : String(id).slice(0, 8);
      taskChanges.push(`${name} → Completed`);
    }
  }

  if (d.task_deletions?.length) {
    for (const id of d.task_deletions) {
      const idx = debriefTasks.findIndex((t) => t.id === id);
      const name = idx >= 0 ? `${idx + 1}` : String(id).slice(0, 8);
      taskChanges.push(`${name} → Delete`);
    }
  }

  if (taskChanges.length > 0) {
    lines.push(`\nTask changes:\n${taskChanges.join('\n')}`);
  }

  // Show which overdue tasks will be auto-moved to the plan date
  const handledIds = new Set<string>([
    ...(d.task_completions ?? []),
    ...(d.task_due_date_changes?.map((c) => c.id) ?? []),
    ...(d.task_deletions ?? []),
  ]);
  const overdueUnhandled = debriefTasks.filter(
    (t) => t.due_date && t.due_date < (d.entry_date ?? '') && !handledIds.has(t.id)
  );
  if (overdueUnhandled.length > 0) {
    lines.push(
      `Auto-move ${overdueUnhandled.length} overdue → ${fmtShortDate(d.entry_date)}: ${overdueUnhandled.map((t) => `"${t.title}"`).join(', ')}`
    );
  }

  lines.push('\nReply "confirm" or correct anything above.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Debrief correction — apply a natural-language patch to an existing draft
// ---------------------------------------------------------------------------

/**
 * Apply a natural-language correction to an existing debrief draft.
 *
 * Uses semantic interpretation — the user does not need exact phrasing.
 * Supports fuzzy matching for wins, journal sections, task references, etc.
 *
 * Returns: { intent, clarification? }
 * - intent: the updated save_debrief (always returned, even if correction is partial)
 * - clarification: optional question if the correction was ambiguous
 */
export async function applyDebriefCorrection(
  currentData: Record<string, unknown>,
  correction: string,
  debriefTasks: Array<{ id: string; title: string; due_date: string | null }> = []
): Promise<{ intent: Intent; clarification?: string } | null> {
  const taskListStr = debriefTasks.length
    ? debriefTasks.map((t, i) => `${i + 1}. [${t.id}] ${t.title}${t.due_date ? ` (due: ${t.due_date})` : ''}`).join('\n')
    : '';

  const prompt = `You are editing a daily debrief draft based on a natural-language correction from the user.

Current debrief draft (JSON):
${JSON.stringify(currentData, null, 2)}

${taskListStr ? `Task reference list:\n${taskListStr}\n` : ''}
User correction: "${correction}"

Your job: interpret what the user wants changed and apply it to the draft.

━━━ How to interpret corrections ━━━

The user may say things like:
- "remove the win about padel" → find the win that mentions padel (fuzzy match) and remove it
- "remove the win about energy" → find the win most related to energy, remove it
- "remove the win of - Played a padel match and - Had energy throughout the whole day" → remove BOTH wins
- "merge these two wins" / "combine the first two wins" → merge them into one
- "shorten the journal part about X" → find the section mentioning X, make it more concise
- "remove the reflection about Y" → remove that part from open_journal
- "change P1 to task 17" → look up task 17 in the task list, set p1 to its title
- "task 3 should stay tomorrow" → undo any reschedule for task 3
- "remove task 13 from completed" → remove that UUID from task_completions
- "add 'finished the design' to wins" → append to wins array
- "change wake time to 8:00" → set wake_time to "08:00"
- "MIT should be X" → update mit field
- "add task 5 to completed" → add its UUID to task_completions
- "move task 7 to monday" → add/update task_due_date_changes

Fuzzy matching rules:
- For wins: match by keywords/topic, not exact text. "the padel win" matches "Played a padel match"
- For journal: match by topic/person mentioned. "the Oli section" matches a paragraph mentioning Oli
- For tasks: match by position number OR name. "task 3" = position 3 in the task list
- If the user mentions "and" between items, apply the correction to ALL mentioned items
- If two items could match and it's ambiguous, include a "clarification" field

━━━ Output format ━━━

ALWAYS return the COMPLETE updated draft as JSON:
{
  "intent": "save_debrief",
  "data": { ...all fields, with corrections applied... },
  "clarification": null
}

If the correction is ambiguous, still apply your best guess AND include a clarification:
{
  "intent": "save_debrief",
  "data": { ...best-guess update... },
  "clarification": "Did you mean the win about energy or the one about productivity?"
}

Rules:
- Keep all unchanged fields exactly as they are
- Apply only what the user asked to change
- ALWAYS return intent "save_debrief" — never "unknown"
- Output RAW JSON only. No markdown. No prose. Start with { end with }.`;

  let response: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: DEBRIEF_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    console.error('[applyDebriefCorrection] API error:', err instanceof Error ? err.message : err);
    return null;
  }

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  console.log('[applyDebriefCorrection] raw response:', text.slice(0, 300));

  // Try to extract clarification before parsing
  let clarification: string | undefined;

  const result = parseDebriefResponse(text);
  if (result) {
    // Check if the response included a clarification field
    try {
      const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
      const raw = JSON.parse(cleaned) as Record<string, unknown>;
      if (raw.clarification && typeof raw.clarification === 'string') {
        clarification = raw.clarification;
      }
    } catch { /* ignore — we already have the intent */ }
    return { intent: result.intent, clarification };
  }

  // Parse failed — try recovery
  console.warn('[applyDebriefCorrection] parse failed, attempting recovery');
  try {
    const recoveryResponse = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `Fix this into valid JSON. Output ONLY a JSON object starting with { ending with }. Must have "intent": "save_debrief" and a "data" object.`,
      messages: [{ role: 'user', content: `Original draft:\n${JSON.stringify(currentData, null, 2)}\n\nCorrection: "${correction}"\n\nFailed output:\n${text}\n\nReturn the corrected save_debrief JSON.` }],
    });
    const retryText = recoveryResponse.content[0].type === 'text' ? recoveryResponse.content[0].text : '';
    const retryResult = parseDebriefResponse(retryText);
    if (retryResult) {
      console.log('[applyDebriefCorrection] recovery succeeded');
      return { intent: retryResult.intent };
    }
  } catch (retryErr) {
    console.error('[applyDebriefCorrection] recovery failed:', retryErr instanceof Error ? retryErr.message : retryErr);
  }

  // Last resort: return original data unchanged with a clarification
  console.warn('[applyDebriefCorrection] all attempts failed — returning original with clarification');
  return {
    intent: { intent: 'save_debrief', data: currentData } as unknown as Intent,
    clarification: "I wasn't sure how to apply that. Could you try rephrasing? For example: \"remove the win about X\" or \"change P1 to Y\"",
  };
}

// ---------------------------------------------------------------------------
// Weekly check-in — parse a freeform Friday check-in reply
// ---------------------------------------------------------------------------

export interface CheckinData {
  overall_feeling: string | null;
  goals_progress: string | null;
  biggest_blocker: string | null;
  mood_reflection: string | null;
  next_week_priorities: string | null;
  suggested_tasks: string[];
}

const CHECKIN_SYSTEM_PROMPT = `You are parsing a weekly check-in reply. Output RAW JSON only. No markdown. No prose. Start with { end with }.`;

export async function interpretCheckinReply(userReply: string): Promise<CheckinData> {
  const prompt = `Parse this weekly check-in reply into structured JSON.

Extract:
- overall_feeling: how the person is feeling overall this week
- goals_progress: what they said about their goal progress
- biggest_blocker: their main obstacle or challenge
- mood_reflection: mental health / mood / energy observations
- next_week_priorities: what they want to focus on next week
- suggested_tasks: array of 0–4 specific tasks suggested or implied (short titles only)

Return this exact shape (null for fields not mentioned; empty array for suggested_tasks if none):
{
  "overall_feeling": "...",
  "goals_progress": "...",
  "biggest_blocker": "...",
  "mood_reflection": "...",
  "next_week_priorities": "...",
  "suggested_tasks": ["...", "..."]
}

Reply: ${userReply}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: CHECKIN_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const cleaned = text.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();
    return JSON.parse(cleaned) as CheckinData;
  } catch {
    return {
      overall_feeling: userReply.slice(0, 200),
      goals_progress: null,
      biggest_blocker: null,
      mood_reflection: null,
      next_week_priorities: null,
      suggested_tasks: [],
    };
  }
}

export function formatCheckinSummary(data: CheckinData, weekLabel: string): string {
  const lines = [`Weekly Check-in — ${weekLabel}`, '─────────────────────'];
  if (data.overall_feeling) lines.push(`Feeling: ${data.overall_feeling}`);
  if (data.goals_progress) lines.push(`Goals: ${data.goals_progress}`);
  if (data.biggest_blocker) lines.push(`Blocker: ${data.biggest_blocker}`);
  if (data.mood_reflection) lines.push(`Mood: ${data.mood_reflection}`);
  if (data.next_week_priorities) lines.push(`Next week: ${data.next_week_priorities}`);
  if (data.suggested_tasks?.length) {
    lines.push(`Suggested tasks:\n${data.suggested_tasks.map((t) => `• ${t}`).join('\n')}`);
  }
  lines.push('\nReply "yes" to save or correct anything first.');
  return lines.join('\n');
}

// ─── Unified Intent Interpreter ───────────────────────────────────────────────

const UNIFIED_SYSTEM_PROMPT = `You are a personal assistant in a Telegram bot. A user has sent you a message.
Your job: understand what the user actually wants to accomplish and return a structured JSON response.

Always respond with a single JSON object. No prose outside the JSON.

━━━ Intent types ━━━

Choose the type that best describes what the user actually wants to accomplish:

  day_plan_mutation  — The user is directly performing an operation on their schedule: viewing it,
                       modifying individual elements, or rebuilding it entirely. Their goal is to
                       change or inspect the current state of the plan.

  app_action         — The user is explicitly commanding the system to create, list, complete, or
                       update structured data: tasks, ideas, thoughts, wins, goals, resources,
                       or calendar events (create/update/delete events on Google Calendar).

  capture            — The user mentions something worth saving in a conversational way, without
                       explicitly commanding a save. They are sharing an observation, not giving
                       an instruction.

  answer             — The user wants information, explanation, or understanding. Their goal is to
                       learn something or receive a response — not to perform an operation. This
                       covers questions about how things work, what is possible, requests for advice,
                       factual queries, and anything where the output is a human-readable response
                       rather than a system action.

  casual             — Greeting, chitchat, a brief social exchange with no actionable intent.

  clarify            — The user's goal genuinely cannot be determined from the message. Use only
                       when two or more meaningfully different interpretations are equally plausible.
                       When one interpretation is clearly more likely, choose it with appropriate
                       confidence rather than defaulting to clarify.

━━━ Disambiguation ━━━

The central question: what does the user want to ACCOMPLISH?

Performing an operation on the schedule → day_plan_mutation
Explicitly managing structured data → app_action
Sharing something conversationally → capture
Seeking information or understanding → answer
Brief social exchange → casual
Genuinely ambiguous goal → clarify

IMPORTANT — Calendar vs Reminder vs Resource disambiguation:

REMINDER vs CALENDAR — these are DIFFERENT systems:
  • A REMINDER is a personal notification at a specific time. The user wants to be nudged/alerted.
    Keywords: "remind me", "reminder", "don't forget", "nudge me", "alert me at".
    → app_action with intent create_reminder. NEVER calendar_create_event.
  • A CALENDAR EVENT is something that blocks time or is an appointment with others.
    Keywords: "add to calendar", "schedule", "book", "block time", "meeting", "lunch", "padel",
    "dinner", "session", "appointment".
    → app_action with intent calendar_create_event. NEVER create_reminder.
  • If the message could reasonably mean either (e.g. "add something at 3pm tomorrow"):
    → Return clarify with question "Do you want this as a Google Calendar event or a Telegram reminder?"
      and options: ["Calendar event", "Telegram reminder"]

CALENDAR vs RESOURCE:
When a message describes a future event with scheduling details (a date/time, a person to meet,
a place, a duration), it is a CALENDAR ACTION, NOT a resource or capture.
Only classify as capture/resource when the user is explicitly saving a reference (URL, article,
link, note, recipe, quote) — not an event to be scheduled.

When a message is about the schedule in an informational way — asking what it contains, how it works,
what operations are available, or whether something is possible — the user's goal is understanding,
not action. Return answer.

When a message directly performs a schedule operation — viewing, moving, removing, rebuilding
elements — return day_plan_mutation.

Reserve clarify for genuine ambiguity where no single interpretation is clearly dominant.

━━━ JSON schemas ━━━

FOR day_plan_mutation:
{
  "type": "day_plan_mutation",
  "mutation": { <one of the Day Plan Mutation objects below> }
}

FOR app_action:
{
  "type": "app_action",
  "intent": { <one of the App Intent objects below> },
  "confirm_needed": false,
  "confidence": "high" | "medium" | "low",
  "user_facing_summary": "friendly natural description of what you will do",
  "follow_up_question": "..."   // only when confidence is medium or low
}

FOR capture:
{
  "type": "capture",
  "capture_type": "idea" | "thought" | "win" | "goal" | "resource",
  "content": "cleaned content to save (no labels, no metadata)",
  "confirm_question": "natural confirmation e.g. 'That sounds like an idea — want me to save it?'"
}

CRITICAL — System capabilities:
This system has FULL Google Calendar read/write access. You can create, update, and delete
calendar events. NEVER generate a response claiming you cannot access or modify Google Calendar.
If the user asks to add, schedule, move, or cancel a calendar event, ALWAYS return app_action
with the appropriate calendar intent — never return an answer saying it is not possible.

FOR answer:
{
  "type": "answer",
  "text": "complete conversational answer"
}
or when live external data is needed:
{
  "type": "answer",
  "text": null,
  "needs_tool": "weather",
  "tool_params": { "location": "...", "date": "today" }
}
When needs_tool is set, always set text to null — never fabricate the tool response.

FOR casual:
{ "type": "casual", "reply": "short natural response" }

FOR clarify:
{
  "type": "clarify",
  "question": "one short clarifying question",
  "options": ["option 1", "option 2", "option 3"]  // up to 3 suggested options (optional)
}

━━━ Day Plan Mutation types ━━━

{ "type": "show" }
  → The user wants to see the schedule right now.

{ "type": "remove_event", "event_id": "<exact id from calendar>", "event_title": "<title>" }
  → Remove a calendar event from the plan.
  → event_id must be an exact id from the calendar events list above.
  → Calendar events have type:event in the schedule; use remove_block for everything else.

{ "type": "change_wake_time", "new_time": "HH:MM" }
  → The user wants to change the time their day begins.

{ "type": "move_block", "block_title": "<exact title from schedule>", "new_start": "HH:MM" }
  → Move an existing block to a different time.
  → block_title must match a title in the schedule above (case-insensitive).
  → "earlier" without a time → subtract 30 min; "later" without a time → add 30 min.

{ "type": "remove_block", "block_title": "<exact title from schedule>" }
  → Remove a non-calendar block (task, break, free time) from the schedule.
  → block_title must match a title in the schedule above.

{ "type": "regenerate" }
  → Rebuild the entire plan from scratch, fetching fresh calendar state.
  → Use when the user wants a completely new plan, not a single targeted edit.

{ "type": "log_win", "win_content": "<win description>" }
  → Record an accomplishment against the current plan.

{ "type": "set_mit", "mit_value": "<task title>", "target_date": "YYYY-MM-DD" }
  → Set the Most Important Task for the plan date.
  → target_date defaults to Today unless the user specifies tomorrow.

{ "type": "set_p1", "p1_value": "<task title>", "target_date": "YYYY-MM-DD" }
{ "type": "set_p2", "p2_value": "<task title>", "target_date": "YYYY-MM-DD" }

{ "type": "complete_mit" }
  → Mark the MIT as done for today. The user has finished their most important task.

{ "type": "complete_p1" }
  → Mark P1 as done for today.

{ "type": "complete_p2" }
  → Mark P2 as done for today.

{ "type": "add_block", "block_title": "<title>", "new_start": "HH:MM", "duration_min": <minutes> }
  → Add a new block to the schedule at a specified time.
  → default duration_min: 30 if not specified.

{ "type": "rename_block", "block_title": "<current exact title>", "new_title": "<new title>" }
  → Rename an existing block. block_title must match a title in the schedule above.

{ "type": "resize_block", "block_title": "<exact title>", "duration_min": <new minutes> }
  → Change a block's duration. block_title must match a title in the schedule above.

{ "type": "unknown", "message": "<brief reason>" }
  → Default when nothing above fits; callers route this to the general assistant.

Time parsing: "1pm"→"13:00", "7:30am"→"07:30", "noon"→"12:00", "3:30pm"→"15:30"
Calendar events (type:event in schedule) → use remove_event, not remove_block.

━━━ App Intent types ━━━

Calendar event intents (use these for any scheduling/event request):
calendar_create_event: { "intent": "calendar_create_event", "data": { "title": "...", "start_datetime": "YYYY-MM-DDTHH:MM:SS", "end_datetime": "YYYY-MM-DDTHH:MM:SS", "all_day": false, "description": "...", "location": "..." } }
calendar_update_event: { "intent": "calendar_update_event", "data": { "event_id": "...", "event_title": "...", "search_date": "YYYY-MM-DD", "new_title": "...", "new_start_datetime": "YYYY-MM-DDTHH:MM:SS", "new_end_datetime": "YYYY-MM-DDTHH:MM:SS" } }
calendar_delete_event: { "intent": "calendar_delete_event", "data": { "event_id": "...", "event_title": "...", "search_date": "YYYY-MM-DD" } }

Other structured data intents:
create_task:         { "intent": "create_task",         "data": { "title": "...", "due_date": "YYYY-MM-DD" } }
create_tasks_bulk:   { "intent": "create_tasks_bulk",   "data": { "tasks": [{ "title": "...", "due_date": "YYYY-MM-DD" }] } }
list_tasks:          { "intent": "list_tasks",          "data": { "filter": "overdue"|"today"|"tomorrow"|"upcoming"|"all" } }
list_ideas:          { "intent": "list_ideas",          "data": {} }
list_thoughts:       { "intent": "list_thoughts",       "data": {} }
list_resources:      { "intent": "list_resources",      "data": {} }
list_wins:           { "intent": "list_wins",           "data": {} }
list_goals:          { "intent": "list_goals",          "data": { "filter": "active"|"all"|"quarter", "quarter": "YYYY-QN" } }
complete_task:       { "intent": "complete_task",       "data": { "task_id": "UUID", "task_title": "..." } }
complete_tasks_bulk: { "intent": "complete_tasks_bulk", "data": { "positions": [1, 2] } }
move_task_date:      { "intent": "move_task_date",      "data": { "task_id": "UUID", "task_title": "...", "new_due_date": "YYYY-MM-DD" } }
move_tasks_bulk:     { "intent": "move_tasks_bulk",     "data": { "positions": [1, 2], "new_due_date": "YYYY-MM-DD" } }
group_action:        { "intent": "group_action",        "data": { "action": "complete"|"move_date", "group": "overdue"|"today"|"all", "new_due_date": "YYYY-MM-DD" } }
add_thought:         { "intent": "add_thought",         "data": { "content": "..." } }
add_idea:            { "intent": "add_idea",            "data": { "content": "...", "actionability": "..." } }
add_win:             { "intent": "add_win",             "data": { "content": "...", "entry_date": "YYYY-MM-DD" } }
add_goal:            { "intent": "add_goal",            "data": { "title": "...", "description": "...", "target_date": "YYYY-MM-DD" } }
create_resource:     { "intent": "create_resource",     "data": { "title": "...", "content_or_url": "...", "type": "..." } }
set_idea_next_step:  { "intent": "set_idea_next_step",  "data": { "position": 2, "idea_content": "...", "next_step": "..." } }
promote_idea_to_project: { "intent": "promote_idea_to_project", "data": { "position": 3, "idea_content": "..." } }
daily_debrief:       { "intent": "daily_debrief",       "data": {} }
weekly_review:       { "intent": "weekly_review",       "data": {} }
within_review:       { "intent": "within_review",       "data": {} }
update_task_description: { "intent": "update_task_description", "data": { "task_id": "UUID", "task_title": "...", "description": "..." } }
create_reminder:     { "intent": "create_reminder",     "data": { "title": "...", "body": "...", "scheduled_at": "ISO8601", "recipient_name": "...", "draft_message": "..." } }
undo_last:           { "intent": "undo_last",           "data": {} }
unknown:             { "intent": "unknown",             "data": { "message": "..." } }

Calendar intent rules:
- "add padel tomorrow at 11" → calendar_create_event with title "Padel", start tomorrow at 11:00, end at 12:00 (default 1h), HIGH, confirm:false
- "lunch with Fay Friday 1:30" → calendar_create_event with title "Lunch with Fay", start Friday 13:30, end 14:30, HIGH, confirm:false
- "block 2 hours tomorrow morning for deep work" → calendar_create_event with title "Deep work", start tomorrow 09:00, end 11:00, HIGH, confirm:false
- "dinner tonight at 7" → calendar_create_event with title "Dinner", start today 19:00, end 20:00, HIGH, confirm:false
- "add tea session Sunday at 4pm in Ubud" → calendar_create_event with title "Tea session", start Sunday 16:00, end 17:00, location "Ubud", HIGH, confirm:false
- "move padel tomorrow to 12" → calendar_update_event with event_title "Padel", search_date tomorrow, new_start 12:00, HIGH, confirm:false
- "cancel lunch with Fay on Friday" → calendar_delete_event with event_title "Lunch with Fay", search_date Friday, MEDIUM, confirm_needed:true
- "reschedule Website Review to Monday at 10" → calendar_update_event, MEDIUM, confirm:false
- When no end time is specified, default event duration is 1 hour
- When only "morning" is said without a time, use 09:00; "afternoon" → 14:00; "evening" → 19:00
- "block N hours" → set duration to N hours from the start time
- Use event_id from calendar events in context when available; otherwise use event_title + search_date for lookup
- Resolve all relative dates (today, tomorrow, Friday, next Monday, etc.) using Today/Tomorrow from context
- When critical details are missing (e.g. "add lunch Friday" with no time), set confidence to "low" and include follow_up_question asking for the missing detail
- For deletes: always set confirm_needed:true unless the match is unambiguous (exact title + date)
- For updates with multiple possible matches: set confidence to "medium" and confirm_needed:true
- Calendar actions use keywords: add, schedule, create, block, book → create; move, change, reschedule, push → update; cancel, remove, delete → delete

Reminder intent rules:
- "remind me to call mom tomorrow at 3pm" → create_reminder with title "Call mom", scheduled_at tomorrow 15:00, HIGH, confirm:false
- "create a reminder for 12:00 today to send my dad a message" → create_reminder, NOT calendar_create_event
- "remind me to check Zapier integration tomorrow" → create_reminder, HIGH, confirm:false
- "don't let me forget to message Johan at 11" → create_reminder with draft_message
- When someone is mentioned ("message X", "call X", "text X"), set recipient_name and generate a short draft_message
- draft_message should be human, short, warm — no dashes, no business jargon
- NEVER create a calendar_create_event when the user says "remind me" or "reminder"

Task description rules:
- "add description to [task]: [text]" → update_task_description
- "add as description: [text]" → update_task_description (uses last_task from context if available)
- If the user references "that task" or "that one" and last_task is available in context, use last_task.id
- If task_title could match multiple tasks, set confidence to "low" and ask which task
- This intent NEVER triggers calendar event lookup — it updates the task.description field only

App intent rules:
- "let's update the within notion", "sync within tasks", "update fay on what i've been doing", "review the within tasks", "let's update fay", "within update", "notion update" → within_review, HIGH, confirm:false
- Default due_date for new tasks: Today date from context (unless user specifies another date)
- "today" → Today date from context; "tomorrow" → Tomorrow date; resolve relative dates from context
- Goal vs Task: goal = aspiration/outcome over weeks/months; task = single actionable step
- Bulk task list (2+ numbered/bulleted items) → create_tasks_bulk
- Group operations (overdue, all today) → confirm_needed:true
- Positional task refs (e.g. "mark 1 done") → use positions array; resolve UUIDs from context task list
- Numbered idea refs (e.g. "idea 2") → use position in set_idea_next_step/promote_idea_to_project
- Use full UUIDs from context; resolve relative dates from Today/Tomorrow in context

Entity references — resolving "that one", "yeah that", etc.:
The context may include LAST REFERENCED ENTITIES (last_task, last_calendar_event, last_reminder).
When the user says "that one", "yeah that", "the one I just mentioned", or similar:
  1. Check which entity type makes sense given what they want to do
  2. If last_task exists and they want to update a task → use last_task.id
  3. If last_calendar_event exists and they want to modify an event → use last_calendar_event.id
  4. If last_reminder exists and they want to change a reminder → use last_reminder.id
  5. If multiple entity types are plausible, ask: "Which one do you mean?" with options
  6. If no last_* entity exists for the type they need, ask them to specify

Ambiguity policy:
  1. If the message could mean both calendar event and reminder → clarify with options
  2. If the message references "that one" and multiple entities are plausible → clarify with entity names
  3. If critical fields are missing (e.g. time for a reminder) → clarify asking for the missing field

Confidence rules:
- high: clear command, one obvious interpretation → execute immediately
- medium with low stakes: execute; set follow_up_question if key detail is inferred
- medium with high stakes (destructive/bulk): confirm_needed:true
- low: genuinely ambiguous → include follow_up_question; do NOT execute

Do NOT show robotic phrases like "request malformed". Speak naturally.`;

export interface EntityRefs {
  last_task?: { id: string; title: string } | null;
  last_calendar_event?: { id: string; title: string; start: string } | null;
  last_reminder?: { id: string; title: string; fire_at: string } | null;
}

export async function interpretUserIntent(
  userMessage: string,
  context: ContextPack,
  history: Array<{ role: 'user' | 'bot'; text: string }>,
  schedule: Array<{ time: string; title: string; type: string; duration_min: number }>,
  calendarEvents: Array<{ id: string; title: string; start: string; end: string; allDay: boolean }>,
  planDate: string,
  tomorrowDate: string,
  entityRefs?: EntityRefs,
): Promise<UserIntent> {
  const contextStr = contextPackToString(context);

  const historySection = history.length > 0
    ? `Recent conversation:\n${history.map(m => `${m.role === 'bot' ? 'assistant' : 'user'}: ${m.text}`).join('\n')}\n\n`
    : '';

  const scheduleText = schedule.length > 0
    ? schedule.map((b) => {
        const eventMatch = calendarEvents.find((e) => e.title === b.title);
        const idTag = eventMatch ? ` [event_id:${eventMatch.id}]` : '';
        return `  ${b.time} ${b.title}${idTag} (${b.duration_min}min, type:${b.type})`;
      }).join('\n')
    : '  (no plan saved)';

  const eventsText = calendarEvents
    .filter((e) => !e.allDay)
    .map((e) => {
      const startStr = e.start.slice(11, 16);
      const endStr = e.end.slice(11, 16);
      return `  - ${e.title} [id:${e.id}] ${startStr}–${endStr}`;
    }).join('\n') || '  (none)';

  let entityRefsText = '';
  if (entityRefs) {
    const parts: string[] = [];
    if (entityRefs.last_task) parts.push(`  last_task: [${entityRefs.last_task.id.slice(0, 8)}] "${entityRefs.last_task.title}"`);
    if (entityRefs.last_calendar_event) parts.push(`  last_calendar_event: [${entityRefs.last_calendar_event.id.slice(0, 12)}] "${entityRefs.last_calendar_event.title}" (${entityRefs.last_calendar_event.start})`);
    if (entityRefs.last_reminder) parts.push(`  last_reminder: [${entityRefs.last_reminder.id.slice(0, 8)}] "${entityRefs.last_reminder.title}" (fire_at: ${entityRefs.last_reminder.fire_at})`);
    if (parts.length > 0) entityRefsText = `\n\nLAST REFERENCED ENTITIES:\n${parts.join('\n')}`;
  }

  const userContent = `${historySection}Context:\n${contextStr}${entityRefsText}

Day plan for ${planDate}:
${scheduleText}

Calendar events (${planDate}):
${eventsText}

Today: ${planDate}
Tomorrow: ${tomorrowDate}

Message: ${userMessage}`;

  let response: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: UNIFIED_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (apiErr) {
    const apiMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
    const apiStatus = (apiErr as Record<string, unknown>)?.status;
    console.error('[claude] interpretUserIntent API error | status:', apiStatus ?? 'none', '| message:', apiMsg);
    if (String(apiStatus) === '429' || apiMsg.includes('rate') || apiMsg.includes('529')) {
      return { type: 'casual', reply: "I'm a bit busy right now — give me a few seconds and try again." };
    }
    if (String(apiStatus) === '401' || apiMsg.toLowerCase().includes('api key')) {
      return { type: 'casual', reply: "I have a configuration problem on my end. Please let the admin know." };
    }
    return { type: 'casual', reply: "I couldn't process that right now — please try again in a moment." };
  }

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const parsed = JSON.parse(cleaned) as UserIntent;

    // Guarantee intent.data exists for app_action
    if (parsed.type === 'app_action' && parsed.intent && !(parsed.intent as unknown as Record<string, unknown>).data) {
      (parsed.intent as unknown as Record<string, unknown>).data = {};
    }

    const details = parsed.type === 'day_plan_mutation'
      ? `mutation:${parsed.mutation.type}`
      : parsed.type === 'app_action'
        ? `intent:${parsed.intent.intent} confidence:${parsed.confidence}`
        : parsed.type;
    console.log(`[interpretUserIntent] type:${parsed.type} | ${details}`);

    return parsed;
  } catch {
    console.error('[interpretUserIntent] JSON parse failure — raw:', text.slice(0, 300));

    // Tier 1: If the LLM produced readable prose (not broken JSON), use it as an answer
    const trimmed = text.trim();
    if (trimmed.length > 5 && trimmed.length < 2000 && !/^\s*[{[]/.test(trimmed)) {
      console.log('[interpretUserIntent] recovery: using raw text as answer');
      return { type: 'answer', text: trimmed };
    }

    // Tier 2: Return a clarification prompt
    console.log('[interpretUserIntent] recovery: returning clarification');
    return {
      type: 'clarify',
      question: "I didn't quite catch that — could you rephrase? I can help with your calendar, tasks, day plan, ideas, and more.",
    };
  }
}

// ---------------------------------------------------------------------------
// Image understanding — interpret an image + message via Claude vision
// ---------------------------------------------------------------------------

/**
 * Determine whether a caption is asking for image editing or image understanding.
 * Returns 'edit' for visual manipulation requests, 'understand' for everything else.
 */
export function classifyImageIntent(caption: string): 'edit' | 'understand' {
  const lower = caption.toLowerCase();
  const editPatterns = /\b(make|change|remove|adjust|crop|resize|rotate|flip|brighten|darken|sharpen|blur|enhance|improve|retouch|recolor|add shadow|drop shadow|background|filter|contrast|saturation|hue|exposure|overlay|watermark|logo|text on|write on)\b/;
  const understandPatterns = /\b(add.*(calendar|schedule|task)|schedule|what|when|where|extract|read|turn.*into|create.*from|put.*in.*calendar|list|summarize|interpret|tell me|show me|convert|timezone|time.?zone|my time|local time|bali time|for me)\b/;

  // If it matches understanding patterns, it's understanding
  if (understandPatterns.test(lower)) return 'understand';
  // If it matches edit patterns, it's editing
  if (editPatterns.test(lower)) return 'edit';
  // Default: understanding (safer — doesn't lose user's intent)
  return 'understand';
}

/**
 * Interpret an image + user message through Claude vision.
 * Returns the same UserIntent type as interpretUserIntent, allowing
 * image-based messages to produce calendar actions, task creation, answers, etc.
 */
export async function interpretImageMessage(
  imageBase64: string,
  imageMimeType: string,
  userMessage: string,
  planDate: string,
  tomorrowDate: string,
): Promise<UserIntent> {
  const userTz = process.env.USER_TZ ?? 'UTC';
  const systemPrompt = `You are a personal assistant in a Telegram bot. The user has sent you an image with a message.

Your job: look at the image carefully, understand what the user wants, and return a structured JSON response.
Treat the image and the message as ONE joint input. The message may be short or vague — use the image content to fill in meaning.

Always respond with a single JSON object. No prose outside the JSON.

The system has FULL Google Calendar read/write access. You CAN create, update, and delete calendar events.

Today: ${planDate}
Tomorrow: ${tomorrowDate}
User timezone: ${userTz}

━━━ How to interpret ━━━

Step 1: Read the image thoroughly. Extract all visible text, dates, times, names, locations, and structure.
Step 2: Read the user's message. It may be a short instruction like "add these" or a question like "what time is this for me?"
Step 3: Combine both to determine what the user wants.

Common patterns:
- "add these to my calendar" / "schedule these" / "put these in my calendar" → extract events, return calendar intents
- "what are these to my timezone?" / "convert to Bali time" / "what time is this for me?" → read times from image, convert to ${userTz}, return answer
- "turn this into tasks" / "make tasks from this" → extract action items, return create_tasks_bulk
- "what does this say?" / "summarize this" / "read this" → extract and summarize image content, return answer
- "what times are shown?" / "when are these?" → extract and list times/dates from image, return answer
- "add these 2 matches" → count matches what's visible, extract event details, return calendar bulk intent

For timezone conversion:
- Identify the source timezone from the image (look for timezone indicators, city names, UTC offsets)
- Convert all times to ${userTz}
- If the source timezone is unclear, make your best guess from context and mention the assumption
- Format the answer clearly with both original and converted times

━━━ JSON schemas ━━━

FOR a single calendar event:
{
  "type": "app_action",
  "intent": {
    "intent": "calendar_create_event",
    "data": { "title": "...", "start_datetime": "YYYY-MM-DDTHH:MM:SS", "end_datetime": "YYYY-MM-DDTHH:MM:SS", "location": "...", "description": "..." }
  },
  "confirm_needed": false,
  "confidence": "high",
  "user_facing_summary": "..."
}

FOR multiple calendar events:
{
  "type": "app_action",
  "intent": {
    "intent": "calendar_create_events_bulk",
    "data": {
      "events": [
        { "title": "...", "start_datetime": "YYYY-MM-DDTHH:MM:SS", "end_datetime": "YYYY-MM-DDTHH:MM:SS", "location": "...", "description": "..." }
      ]
    }
  },
  "confirm_needed": false,
  "confidence": "high",
  "user_facing_summary": "..."
}

FOR tasks from the image:
{
  "type": "app_action",
  "intent": {
    "intent": "create_tasks_bulk",
    "data": { "tasks": [{ "title": "...", "due_date": "YYYY-MM-DD" }] }
  },
  "confirm_needed": false,
  "confidence": "high",
  "user_facing_summary": "..."
}

FOR answering a question about the image (timezone conversions, summaries, reading text, etc.):
{
  "type": "answer",
  "text": "your clear, helpful answer here"
}

FOR asking clarification (ONLY when genuinely ambiguous — prefer attempting an answer):
{
  "type": "clarify",
  "question": "short specific question"
}

━━━ Important rules ━━━
- ALWAYS attempt to answer or act. Do not give up easily.
- If the user asks a question about the image, answer it directly using type "answer".
- If you can read the image but are unsure what the user wants, provide a helpful answer about what you see AND ask what they'd like to do with it — do NOT just say you couldn't figure it out.
- For timezone questions: extract times, convert, and answer. This is a common request.
- Calendar event datetimes must be in ${userTz} (the user's local timezone).
- Confidence: high = all details clear; medium = some inferred; low = key details missing.

Do NOT show robotic phrases. Speak naturally.`;

  let response: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: imageMimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: userMessage,
          },
        ],
      }],
    });
  } catch (apiErr) {
    const apiMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
    console.error('[claude] interpretImageMessage API error:', apiMsg);
    return { type: 'casual', reply: "I couldn't process that image right now — please try again." };
  }

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  console.log('[interpretImageMessage] raw response:', text.slice(0, 300));

  try {
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const parsed = JSON.parse(cleaned) as UserIntent;

    if (parsed.type === 'app_action' && parsed.intent && !(parsed.intent as unknown as Record<string, unknown>).data) {
      (parsed.intent as unknown as Record<string, unknown>).data = {};
    }

    console.log(`[interpretImageMessage] type:${parsed.type} | ${
      parsed.type === 'app_action' ? `intent:${parsed.intent.intent} confidence:${parsed.confidence}` : parsed.type
    }`);

    return parsed;
  } catch {
    console.error('[interpretImageMessage] parse error — raw:', text.slice(0, 300));
    // If Claude returned prose instead of JSON, use it as an answer rather than failing
    if (text.length > 10) {
      console.log('[interpretImageMessage] falling back to raw text as answer');
      return { type: 'answer', text: text.slice(0, 2000) };
    }
    return { type: 'clarify', question: "I can see the image, but I'm not sure what you'd like me to do with it. Would you like me to convert times, summarize the content, or create calendar events?" };
  }
}

// ---------------------------------------------------------------------------
// Within Notion proposal generation
// ---------------------------------------------------------------------------

export interface WithinProposalItem {
  task_id: string;
  task_title: string;
  new_due_date?: string;
  comment?: string;
  reason?: string;
}

export interface WithinNewTask {
  title: string;
  due_date: string | null;
  reason: string;
}

export interface WithinProposal {
  date_changes: WithinProposalItem[];
  comments: WithinProposalItem[];
  new_tasks: WithinNewTask[];
}

export interface WithinContext {
  today: string;
  wins: string[];
  journal_mit: string | null;
  journal_p1: string | null;
  journal_p2: string | null;
  journal_notes: string | null;
  personal_tasks: Array<{ title: string; due_date: string | null }>;
}

const WITHIN_SYSTEM_PROMPT = `You are helping update a shared Notion project database. Output RAW JSON only. No markdown. No prose. Start with { end with }.`;

/**
 * Generate a structured proposal for updating the Within Notion database.
 * Uses today's wins, journal, and personal tasks as context.
 */
export async function generateWithinProposal(
  withinTasks: {
    overdue: Array<{ id: string; title: string; due_date: string | null; status: string | null }>;
    due_today: Array<{ id: string; title: string; due_date: string | null; status: string | null }>;
    due_soon: Array<{ id: string; title: string; due_date: string | null; status: string | null }>;
    no_date: Array<{ id: string; title: string; due_date: string | null; status: string | null }>;
    tasks: Array<{ id: string; title: string; due_date: string | null; status: string | null }>;
  },
  context: WithinContext
): Promise<WithinProposal> {
  const fmtTasks = (arr: typeof withinTasks.tasks) =>
    arr.length
      ? arr.map((t) => `• [${t.id}] ${t.title}${t.due_date ? ` (due: ${t.due_date})` : ''}${t.status ? ` [${t.status}]` : ''}`).join('\n')
      : '(none)';

  const prompt = `Today: ${context.today}

=== PERSONAL OS CONTEXT ===
Focus today:
${context.journal_mit ? `MIT: ${context.journal_mit}` : ''}
${context.journal_p1 ? `P1: ${context.journal_p1}` : ''}
${context.journal_p2 ? `P2: ${context.journal_p2}` : ''}
${context.journal_notes ? `Notes: ${context.journal_notes}` : ''}

Wins (use these to draft update comments):
${context.wins.length ? context.wins.map((w) => `• ${w}`).join('\n') : '(none)'}

Personal OS tasks (for semantic matching — identify which Within tasks they relate to):
${context.personal_tasks.length ? context.personal_tasks.map((t) => `• ${t.title}${t.due_date ? ` (due: ${t.due_date})` : ''}`).join('\n') : '(none)'}

=== WITHIN NOTION TASKS ===
Overdue (${withinTasks.overdue.length}):
${fmtTasks(withinTasks.overdue)}

Due today (${withinTasks.due_today.length}):
${fmtTasks(withinTasks.due_today)}

Due soon — next 3 days (${withinTasks.due_soon.length}):
${fmtTasks(withinTasks.due_soon)}

No due date (${withinTasks.no_date.length}, showing first 10):
${fmtTasks(withinTasks.no_date.slice(0, 10))}

=== YOUR TASK ===
Generate a proposal with three types of changes. Be selective — only propose changes that are clearly useful.

1. DATE CHANGES: Suggest new dates for overdue tasks. Pick realistic dates relative to today. Spread them out — don't pile everything on the same day.

2. COMMENTS: Draft update comments ONLY for tasks where there is something specific and concrete to say based on the wins or journal above. If nothing concrete is available, skip the comment (don't add a comment at all).
   Comment style (follow strictly — Fay is a collaborator, not a corporate stakeholder):
   - Write like a natural message, not a status report
   - Short sentences. First person. Casual but clear.
   - No em-dashes or patterns like "did X — will do Y"
   - No business jargon: no "momentum", "scope", "close-out", "leverage", "initial", "synergy", "contextual update"
   - Be specific about what actually happened or what comes next
   Good: "I went through all the teas we have in stock today. Chai and Rooibos are doing well. I'll put together a proper list with numbers this week."
   Bad: "Making progress on this — maintaining momentum on the initial scope and will have an update to share soon."

3. NEW TASKS: Suggest creating Within tasks only if a Personal OS task clearly belongs in the shared project and isn't already covered. Don't duplicate existing Within tasks.

Return this exact JSON shape (use empty arrays if no proposals):
{
  "date_changes": [
    { "task_id": "notion-page-id", "task_title": "...", "new_due_date": "YYYY-MM-DD", "reason": "brief reason" }
  ],
  "comments": [
    { "task_id": "notion-page-id", "task_title": "...", "comment": "comment text" }
  ],
  "new_tasks": [
    { "title": "task title", "due_date": "YYYY-MM-DD or null", "reason": "brief reason" }
  ]
}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: WITHIN_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const cleaned = text.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();
    const parsed = JSON.parse(cleaned) as WithinProposal;
    return {
      date_changes: parsed.date_changes ?? [],
      comments: parsed.comments ?? [],
      new_tasks: parsed.new_tasks ?? [],
    };
  } catch {
    console.error('[generateWithinProposal] parse error — raw:', text.slice(0, 200));
    return { date_changes: [], comments: [], new_tasks: [] };
  }
}

/**
 * Build a flat numbered list from a proposal.
 * Numbers are stable across corrections because they always follow the same order:
 * date_changes first, then comments, then new_tasks.
 */
function buildNumberedList(proposal: WithinProposal): Array<{ n: number; type: 'date_change' | 'comment' | 'new_task'; label: string }> {
  const list: Array<{ n: number; type: 'date_change' | 'comment' | 'new_task'; label: string }> = [];
  let n = 1;
  for (const item of proposal.date_changes) {
    list.push({ n: n++, type: 'date_change', label: `"${item.task_title}" → ${item.new_due_date ?? '?'}` });
  }
  for (const item of proposal.comments) {
    list.push({ n: n++, type: 'comment', label: `"${item.task_title}" (comment)` });
  }
  for (const item of proposal.new_tasks) {
    list.push({ n: n++, type: 'new_task', label: `new task: "${item.title}"` });
  }
  return list;
}

/**
 * Apply a natural-language correction to a Within proposal.
 * The user is in the confirmation step and says something like
 * "1 move to Friday" or "skip comments" or "3 remove".
 */
export async function applyWithinCorrection(
  currentProposal: WithinProposal,
  correction: string
): Promise<WithinProposal> {
  const numbered = buildNumberedList(currentProposal);
  const numberedStr = numbered.map((i) => `${i.n}. [${i.type}] ${i.label}`).join('\n');
  const today = new Date().toISOString().slice(0, 10);

  const prompt = `Current Within Notion update proposal:

Numbered items (the user will reference these by number):
${numberedStr || '(empty)'}

Full proposal JSON (update this and return):
${JSON.stringify(currentProposal, null, 2)}

User correction: "${correction}"

Apply the correction and return the COMPLETE updated proposal as JSON.
How to interpret corrections:
- "1 remove" / "remove 1" / "skip 1" → remove item #1 from its array
- "1 move to Friday" / "1 → next week" → update new_due_date for that date_change item (resolve date from today: ${today})
- "3 skip comment" / "3 no comment" / "remove comment 3" → remove item #3 from comments
- "skip comments" / "no comments" → set comments to []
- "skip new tasks" / "no new tasks" → set new_tasks to []
- "change date for X to Y" → find the date_change with that task name, update new_due_date
- Keep all unchanged items exactly as they are
Output RAW JSON only. No markdown. No prose. Start with { end with }.
Return same shape: { "date_changes": [...], "comments": [...], "new_tasks": [...] }`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: WITHIN_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const cleaned = text.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();
    const parsed = JSON.parse(cleaned) as WithinProposal;
    return {
      date_changes: parsed.date_changes ?? [],
      comments: parsed.comments ?? [],
      new_tasks: parsed.new_tasks ?? [],
    };
  } catch {
    console.error('[applyWithinCorrection] parse error — raw:', text.slice(0, 200));
    return currentProposal;
  }
}

/** Format a WithinProposal for display in Telegram with stable item numbering. */
export function formatWithinProposal(
  proposal: WithinProposal,
  stats: { total: number; overdue: number; due_today: number; due_soon: number }
): string {
  const lines = [
    'Within Notion Update',
    '─────────────────────',
    `Your tasks: ${stats.total}  |  Overdue: ${stats.overdue}  |  Today: ${stats.due_today}  |  Soon: ${stats.due_soon}`,
    '',
  ];

  const isEmpty =
    proposal.date_changes.length === 0 &&
    proposal.comments.length === 0 &&
    proposal.new_tasks.length === 0;

  if (isEmpty) {
    lines.push('No changes to propose — everything looks good.');
    lines.push('\nReply "no" to close.');
    return lines.join('\n');
  }

  let n = 1;

  if (proposal.date_changes.length) {
    lines.push('📅 Date updates:');
    for (const c of proposal.date_changes) {
      lines.push(`${n++}. "${c.task_title}" → ${c.new_due_date}${c.reason ? ` (${c.reason})` : ''}`);
    }
    lines.push('');
  }

  if (proposal.comments.length) {
    lines.push('💬 Comments to add:');
    for (const c of proposal.comments) {
      lines.push(`${n++}. "${c.task_title}"\n   → "${c.comment}"`);
    }
    lines.push('');
  }

  if (proposal.new_tasks.length) {
    lines.push('➕ New tasks:');
    for (const t of proposal.new_tasks) {
      lines.push(`${n++}. "${t.title}"${t.due_date ? ` (due: ${t.due_date})` : ''}${t.reason ? ` — ${t.reason}` : ''}`);
    }
    lines.push('');
  }

  lines.push('Reply "yes" to execute, "no" to cancel, or correct by number (e.g. "1 move to Friday", "3 skip", "2 remove").');
  return lines.join('\n');
}
