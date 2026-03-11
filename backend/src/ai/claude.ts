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
  | { type: 'clarify'; question: string };


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

const DEBRIEF_SYSTEM_PROMPT = `You are a debrief data extractor. Your ONLY job is to parse the user's debrief message and return a single JSON object.

CRITICAL OUTPUT RULES — these are absolute and must never be violated:
- Output RAW JSON only. Nothing else.
- No markdown code fences. No backticks. No \`\`\`json blocks.
- No prose, notes, explanations, or commentary before or after the JSON.
- Do NOT wrap in {"intent":"unknown",...} — if uncertain about a field, omit it.
- Your entire response must start with { and end with }.
- Never add a "Notes:" section or any text after the closing brace.`;

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

Task reference list (use FULL UUIDs from this list, never 8-char prefixes):
${taskListStr}

Extract from their message:
- wake_time (HH:MM for ${planDate}; "7am"→"07:00", "6:30"→"06:30")
- work_start (HH:MM, optional)
- MIT (Most Important Task for ${planDate})
- P1, P2 (next 2 priority tasks for ${planDate})
- open_journal (reflections, notes, thoughts from ${debriefDate})
- wins (list of wins from ${debriefDate})
- task_completions (full UUIDs of tasks marked done — match by position or name)
- task_due_date_changes (tasks to reschedule — use full UUIDs, new date YYYY-MM-DD)
- task_deletions (tasks to permanently delete — use full UUIDs; use when user says "delete" next to a task number)

Task action rules:
- "3. done" or "complete 3" → task_completions
- "5. to mar 11" or "move 5 to march 11" → task_due_date_changes with date "${planDate.slice(0,4)}-03-11"
- "9. delete" or "delete 9" → task_deletions (do NOT add notes or ask for clarification — just add to task_deletions)
- Resolve relative dates using today = ${planDate}

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

User reply: ${userReply}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: DEBRIEF_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  const result = parseDebriefResponse(text);

  if (!result) {
    console.error('[interpretDebriefReply] PARSE FAILURE — could not extract save_debrief');
    console.error('[interpretDebriefReply] raw model output:', JSON.stringify(text));
    return { intent: 'unknown', data: { message: text } };
  }

  if (result.repaired) {
    console.warn('[interpretDebriefReply] repaired malformed output (recovered save_debrief from wrapper/fences)');
    console.warn('[interpretDebriefReply] raw (first 300 chars):', text.slice(0, 300));
  }

  return result.intent;
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
  if (intent.intent !== 'save_debrief') return 'Could not parse debrief.';

  const d = intent.data;
  const debriefStr = fmtShortDate(d.debrief_date ?? d.entry_date);
  const planStr = fmtShortDate(d.entry_date);
  const lines: string[] = [
    `Debrief: ${debriefStr} | Plan: ${planStr}`,
    '─────────────────────',
  ];

  if (d.wake_time) lines.push(`Wake: ${d.wake_time}`);
  if (d.mit) lines.push(`MIT: ${d.mit}`);
  if (d.p1) lines.push(`P1: ${d.p1}`);
  if (d.p2) lines.push(`P2: ${d.p2}`);
  if (d.open_journal) lines.push(`Journal: ${d.open_journal}`);
  if (d.wins?.length) lines.push(`Wins: ${d.wins.join(', ')}`);

  if (d.task_completions?.length) {
    const names = d.task_completions.map((id) => {
      const t = debriefTasks.find((t) => t.id === id);
      return t ? `"${t.title}"` : `(ref: ${String(id).slice(0, 8)}…)`;
    });
    lines.push(`Mark done: ${names.join(', ')}`);
  }

  if (d.task_due_date_changes?.length) {
    const changes = d.task_due_date_changes.map((c) => {
      const t = debriefTasks.find((t) => t.id === c.id);
      const name = t ? `"${t.title}"` : `(ref: ${String(c.id).slice(0, 8)}…)`;
      return `${name} → ${fmtShortDate(c.due_date)}`;
    });
    lines.push(`Reschedule: ${changes.join(', ')}`);
  }

  if (d.task_deletions?.length) {
    const names = d.task_deletions.map((id) => {
      const t = debriefTasks.find((t) => t.id === id);
      return t ? `"${t.title}"` : `(ref: ${String(id).slice(0, 8)}…)`;
    });
    lines.push(`Delete: ${names.join(', ')}`);
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

  lines.push('\nReply "yes" to confirm or correct me.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Debrief correction — apply a natural-language patch to an existing draft
// ---------------------------------------------------------------------------

/**
 * Apply a small correction to an already-parsed debrief draft.
 *
 * The user is in the confirmation step and says something like:
 *   "change the MIT to X"  /  "P1 should be Y"  /  "remove that win"
 *
 * This function asks Claude to merge the correction into the current data
 * and return the updated JSON.
 */
export async function applyDebriefCorrection(
  currentData: Record<string, unknown>,
  correction: string
): Promise<Intent | null> {
  const prompt = `You are updating a daily debrief draft based on a user correction.

Current debrief draft (JSON):
${JSON.stringify(currentData, null, 2)}

User correction: "${correction}"

Apply the correction and return the COMPLETE updated debrief as a single JSON object with this exact shape:
{
  "intent": "save_debrief",
  "data": {
    ...all fields from current draft, with corrections applied...
  }
}

Rules:
- Keep all unchanged fields exactly as they are
- Apply only what the user asked to change
- "remove that win" / "delete win X" → remove it from the wins array
- "change MIT to X" / "MIT should be X" → update the mit field
- "P1 should be Y" → update the p1 field
- "P2 is Z" → update the p2 field
- Output RAW JSON only. No markdown. No prose. Start with { end with }.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: DEBRIEF_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const result = parseDebriefResponse(text);
  return result?.intent ?? null;
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
                       update structured data: tasks, ideas, thoughts, wins, goals, or resources.

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

When a message contains structured-looking content (dates, times, titles), consider whether the user
is operating on the schedule or saving that content as data. A message whose primary verb is saving
or adding (e.g. save, add, log, note) is saving content regardless of what the content contains.

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
{ "type": "clarify", "question": "one short clarifying question" }

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
undo_last:           { "intent": "undo_last",           "data": {} }
unknown:             { "intent": "unknown",             "data": { "message": "..." } }

App intent rules:
- Default due_date for new tasks: Today date from context (unless user specifies another date)
- "today" → Today date from context; "tomorrow" → Tomorrow date; resolve relative dates from context
- Goal vs Task: goal = aspiration/outcome over weeks/months; task = single actionable step
- Bulk task list (2+ numbered/bulleted items) → create_tasks_bulk
- Group operations (overdue, all today) → confirm_needed:true
- Positional task refs (e.g. "mark 1 done") → use positions array; resolve UUIDs from context task list
- Numbered idea refs (e.g. "idea 2") → use position in set_idea_next_step/promote_idea_to_project
- Use full UUIDs from context; resolve relative dates from Today/Tomorrow in context

Confidence rules:
- high: clear command, one obvious interpretation → execute immediately
- medium with low stakes: execute; set follow_up_question if key detail is inferred
- medium with high stakes (destructive/bulk): confirm_needed:true
- low: genuinely ambiguous → include follow_up_question; do NOT execute

Do NOT show robotic phrases like "request malformed". Speak naturally.`;

export async function interpretUserIntent(
  userMessage: string,
  context: ContextPack,
  history: Array<{ role: 'user' | 'bot'; text: string }>,
  schedule: Array<{ time: string; title: string; type: string; duration_min: number }>,
  calendarEvents: Array<{ id: string; title: string; start: string; end: string; allDay: boolean }>,
  planDate: string,
  tomorrowDate: string,
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

  const userContent = `${historySection}Context:\n${contextStr}

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
    console.error('[interpretUserIntent] parse error — raw:', text.slice(0, 200));
    return { type: 'casual', reply: "Sorry, I lost my train of thought — could you say that again?" };
  }
}
