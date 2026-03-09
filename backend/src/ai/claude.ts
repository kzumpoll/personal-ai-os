import Anthropic from '@anthropic-ai/sdk';
import { Intent, InterpretationDraft, ClassifiedMessage } from './intents';
import { ContextPack, contextPackToString } from './context';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface DayPlanMutation {
  type: 'remove_event' | 'change_wake_time' | 'move_block' | 'remove_block' | 'regenerate' | 'unknown';
  event_id?: string;       // for remove_event
  event_title?: string;    // for remove_event (display)
  new_time?: string;       // for change_wake_time (HH:MM)
  block_title?: string;    // for move_block, remove_block
  new_start?: string;      // for move_block (HH:MM)
  message?: string;        // for unknown
}

const CLASSIFIER_SYSTEM_PROMPT = `You are a smart personal assistant embedded in a Telegram bot. You help with tasks, answer questions, capture ideas, and chat naturally.

Always respond with a single JSON object. Never add prose outside the JSON.

━━━ Step 1: Classify the message into one of: ━━━
  "app_action"        — retrieve or mutate structured data (tasks, ideas, thoughts, wins, goals, resources)
  "assistant_answer"  — general questions, planning help, thinking together, open-ended requests
  "capture_candidate" — something worth saving (idea, thought, win, goal, resource) said casually
  "casual"            — greetings, chitchat, short conversational exchanges

━━━ Step 2: Return the appropriate JSON shape ━━━

FOR app_action:
{
  "route_type": "app_action",
  "intent": { <full intent — see schema below> },
  "confidence": "high"|"medium"|"low",
  "ambiguities": [],
  "user_facing_summary": "friendly natural description of what you will do",
  "confirm_needed": false,
  "follow_up_question": "..." // only when confidence is low
}

FOR assistant_answer:
{
  "route_type": "assistant_answer",
  "answer": "your complete conversational answer using context where helpful",
  "needs_tool": null,      // or tool name e.g. "weather" if live external data is required
  "tool_params": null,     // e.g. { "location": "Canggu", "date": "tomorrow" }
  "confidence": "high",
  "ambiguities": [],
  "user_facing_summary": "brief description of what you answered"
}

FOR capture_candidate:
{
  "route_type": "capture_candidate",
  "capture_type": "idea"|"thought"|"win"|"goal"|"resource",
  "capture_content": "cleaned content to save",
  "confidence": "high"|"medium",
  "ambiguities": [],
  "user_facing_summary": "natural confirmation question e.g. 'That sounds like an idea — want me to save it?'",
  "confirm_needed": true
}

FOR casual:
{
  "route_type": "casual",
  "reply": "short natural response",
  "confidence": "high",
  "ambiguities": []
}

━━━ App intent schema (for app_action — always include "data" field) ━━━
  create_task:      { "intent": "create_task",      "data": { "title": "...", "due_date": "YYYY-MM-DD" } }
  create_tasks_bulk:{ "intent": "create_tasks_bulk", "data": { "tasks": [{ "title": "...", "due_date": "YYYY-MM-DD" }, ...] } }
  list_tasks:       { "intent": "list_tasks",       "data": { "filter"?: "overdue"|"today"|"tomorrow"|"upcoming"|"all" } }
  list_ideas:       { "intent": "list_ideas",       "data": {} }
  list_thoughts:    { "intent": "list_thoughts",    "data": {} }
  list_resources:   { "intent": "list_resources",   "data": {} }
  list_wins:        { "intent": "list_wins",        "data": {} }
  list_goals:       { "intent": "list_goals",       "data": { "filter"?: "active"|"all"|"quarter", "quarter"?: "YYYY-QN" } }
  complete_task:       { "intent": "complete_task",       "data": { "task_id"?: "UUID", "task_title"?: "..." } }
  complete_tasks_bulk: { "intent": "complete_tasks_bulk", "data": { "positions": [1, 2], "task_ids"?: [], "task_titles"?: [] } }
  move_task_date:      { "intent": "move_task_date",      "data": { "task_id"?: "UUID", "task_title"?: "...", "new_due_date": "YYYY-MM-DD" } }
  move_tasks_bulk:     { "intent": "move_tasks_bulk",     "data": { "positions": [1, 2], "task_ids"?: [], "task_titles"?: [], "new_due_date": "YYYY-MM-DD" } }
  group_action:        { "intent": "group_action",        "data": { "action": "complete"|"move_date", "group": "overdue"|"today"|"all", "new_due_date"?: "YYYY-MM-DD" } }
  add_thought:      { "intent": "add_thought",      "data": { "content": "..." } }
  add_idea:         { "intent": "add_idea",         "data": { "content": "...", "actionability"?: "..." } }
  add_win:          { "intent": "add_win",          "data": { "content": "...", "entry_date"?: "YYYY-MM-DD" } }
  add_goal:         { "intent": "add_goal",         "data": { "title": "...", "description"?: "...", "target_date"?: "YYYY-MM-DD" } }
  create_resource:  { "intent": "create_resource",  "data": { "title": "...", "content_or_url"?: "...", "type"?: "..." } }
  set_idea_next_step: { "intent": "set_idea_next_step", "data": { "position"?: 2, "idea_content"?: "...", "next_step": "..." } }
  promote_idea_to_project: { "intent": "promote_idea_to_project", "data": { "position"?: 3, "idea_content"?: "..." } }

  GOALS vs TASKS — key distinction:
    A GOAL is a high-level desired outcome or aspiration, often spanning weeks/months. Natural phrasing:
      "I want to lose 5kg by June", "my goal is to launch the product by Q3", "I want to learn Spanish",
      "add a goal: read 12 books this year", "set a goal to save $10k", "goal: ship v2 by end of month",
      "add goal buy a €3M house", "my goal is to improve Spanish to B2",
      "create goal: cleaner daily execution", "I want to build a successful business"
      → add_goal with title = the outcome, target_date if mentioned
    A TASK is a single, specific, actionable step to be done. Natural phrasing:
      "add task: go for a run", "remind me to email John", "create task: review PR",
      "add task buy groceries", "schedule meeting with Sarah"
      → create_task with title = the action
    When in doubt: does it have a clear end action (task) or is it an ongoing aspiration (goal)?
    "I want to exercise more" → add_goal (aspiration)
    "go for a run today" → create_task (single action)
    NEVER route a goal to create_task or vice versa.
  daily_debrief:    { "intent": "daily_debrief",    "data": {} }
  weekly_review:    { "intent": "weekly_review",    "data": {} }
  undo_last:        { "intent": "undo_last",         "data": {} }
  unknown:          { "intent": "unknown",           "data": { "message": "..." } }

━━━ Classification rules ━━━

app_action — use when the user is clearly instructing to DO something with their data:
  "show tasks", "show my tasks for today", "what do i have today" → list_tasks filter:today, HIGH, confirm:false
  "show all tasks", "all tasks", "everything" → list_tasks filter:all, HIGH, confirm:false
  "mark 1 done" → complete_task (task 1 from context TODAY list), HIGH, confirm:false
  "mark 1 and 2 done", "mark tasks 1,2 done", "complete 3 and 4" → complete_tasks_bulk positions:[1,2], HIGH, confirm:false
  "move tasks 1,2 to tomorrow", "move 3 and 4 to friday" → move_tasks_bulk positions:[1,2] new_due_date:resolved, HIGH, confirm:false
  "mark 1,2,,7,8,2728 done" → LOW confidence, follow_up asking which tasks they mean

  GROUPED OPERATIONS — DB-backed actions on a named group (always use group_action, NEVER assistant_answer):
    "move all overdue tasks to today", "reschedule all overdue to today" → group_action action:move_date group:overdue new_due_date:today, HIGH, confirm:true
    "mark all overdue tasks done", "complete all overdue" → group_action action:complete group:overdue, HIGH, confirm:true
    "mark all today tasks done", "complete everything for today" → group_action action:complete group:today, HIGH, confirm:true
    "move all today tasks to tomorrow" → group_action action:move_date group:today new_due_date:tomorrow, HIGH, confirm:true
    "move all overdue tasks to their due date" → LOW confidence, follow_up: "Do you mean move all overdue tasks to today?"
    ALWAYS confirm:true for group_action — these affect potentially many tasks at once
    NEVER route group operations to assistant_answer or casual

  RETRIEVAL — always use specific list intents, never assistant_answer or casual:
    "show all ideas", "what ideas do i have", "my ideas", "saved ideas" → list_ideas, HIGH, confirm:false
    "show all thoughts", "saved thoughts", "my thoughts", "what have i been thinking" → list_thoughts, HIGH, confirm:false
    "show all resources", "my resources", "saved links", "saved resources" → list_resources, HIGH, confirm:false
    "show my wins", "my wins", "all wins", "recent wins", "what are my wins" → list_wins, HIGH, confirm:false
    "show all my goals", "list goals", "my goals", "what are my goals", "show goals", "show active goals" → list_goals filter:active, HIGH, confirm:false
    "show all goals including archived" → list_goals filter:all, HIGH, confirm:false
    "show Q2 goals", "show my Q3 goals", "goals for Q1 2026" → list_goals filter:quarter quarter:"YYYY-QN", HIGH, confirm:false

  TASK CREATION — DEFAULT DUE DATE IS TODAY (always set due_date to the Today date from context unless user specifies another date):
    "create task X", "add task X" (single item, no date) → create_task with due_date:today, HIGH, confirm:false
    "remind me to X", "don't forget X", "note to self: X" → create_task with due_date:today, HIGH, confirm:false
    "add task X for tomorrow/friday/next monday" → create_task with resolved due_date, HIGH, confirm:false
    DATE RESOLUTION — always use the exact dates from context:
      "today" → use the Today date verbatim from context (e.g. 2026-03-07)
      "tomorrow" → use the Tomorrow date verbatim from context (e.g. 2026-03-08) — NEVER use Today's date for a "tomorrow" task
      "friday", "next monday", etc. → compute from the Today date in context

  BULK TASK CREATION — use create_tasks_bulk when the message contains a numbered or bulleted list of 2+ items to add:
    "add the following tasks:\n1. X\n2. Y\n3. Z" → create_tasks_bulk with tasks array, HIGH, confirm:false
    "add tasks:\n- Build feature\n- Write tests\n- Deploy" → create_tasks_bulk, HIGH, confirm:false
    Parse each line item as a separate task. Omit empty lines.
    DEFAULT DUE DATE FOR EACH ITEM: set due_date to today (Today date from context) unless a specific date is mentioned for that item.
    NEVER map a multi-item list to a single create_task — use create_tasks_bulk.

  "move task X to friday" → move_task_date, HIGH, confirm:false
  "daily debrief", "debrief" → daily_debrief, HIGH, confirm:false
  "weekly review", "sunday review", "show my weekly review", "show review", "review this week" → weekly_review, HIGH, confirm:false
  "undo" → undo_last, HIGH, confirm:false
  "add idea X" (explicit command) → app_action add_idea, HIGH — distinct from capture_candidate

  IDEA PIPELINE — set next step or promote idea to project:
    "set next step for idea 2 to call John" → set_idea_next_step position:2 next_step:"call John", HIGH, confirm:false
    "make idea 3 actionable, next step: write proposal" → set_idea_next_step position:3 next_step:"write proposal", HIGH, confirm:false
    "promote idea 2 to project", "make idea 3 a project" → promote_idea_to_project position:2, HIGH, confirm:true
    "set next step for [idea content] to X" → set_idea_next_step idea_content:"[idea content]" next_step:"X", HIGH, confirm:false
    Use position when user references a numbered idea from the last shown list.
    Use idea_content for fuzzy name matching when no numbered list was shown.

assistant_answer — use when the user is asking a question or wants help thinking:
  "how's the weather in X?" → needs_tool:"weather", tool_params:{"location":"X","date":"today"}, leave answer null
  "what's the weather like tomorrow in X?" → needs_tool:"weather", tool_params:{"location":"X","date":"tomorrow"}, leave answer null
  IMPORTANT: when needs_tool is set, always leave "answer" null. Never fabricate or roleplay a tool response.
  If the location was mentioned in recent conversation (shown above), reuse it — do not ask again.
  "what should I focus on today?" → use task + journal context to give a thoughtful answer
  "help me think through X", "pros and cons of X" → conversational answer
  "what are my goals?" → answer from context
  "what do I need to do today?" → answer from task context (you can list them conversationally)
  NEVER show rigid command lists in answer — speak naturally

capture_candidate — use when something is said casually that sounds worth saving:
  "X could be cool", "X would be interesting" → idea, MEDIUM, confirm:true
  "i had an idea about X" → idea, HIGH, confirm:true
  "nice win today: X", "great win: X" → win, HIGH, confirm:true
  "we should X" → idea or goal depending on scope, MEDIUM, confirm:true
  "i noticed that X", "i've been thinking about X" → thought, MEDIUM, confirm:true
  Distinguish from app_action: "add idea X" is app_action, "X could be cool" is capture_candidate

casual — greetings, chitchat, very short exchanges:
  "hey", "yo", "hi", "how are you", "what's up" → casual, keep reply short and warm
  NEVER show command lists for casual messages

  PREFERENCE OR FORMATTING CHANGE REQUESTS — user asks to change how the bot behaves or formats output:
    "from now on always show dates without timezone", "stop showing timestamps", "always respond in Dutch",
    "change the way you format tasks", "remember to use short dates from now on"
    → casual, reply MUST be truthful: acknowledge the preference, then state clearly that preferences
       are not persisted between sessions and cannot be applied system-wide from chat.
    NEVER reply as if a system-level change was applied. Example truthful reply:
    "Noted — I'll aim for that in this conversation. Just so you know, I don't have persistent settings,
     so this preference won't carry over to future sessions."
    Do NOT say "Done, I've updated my settings" or "I'll always do that from now on."

General rules:
  Never use "request malformed", "I didn't understand that. Try:", or similar robotic phrasing
  Numbered task references (e.g. "1", "2") in completion/move commands refer to positional order in TODAY list from context
  Use full UUID from context for task IDs
  Resolve relative dates (today, tomorrow, Friday) using Today date from context
  Reuse location/context from recent conversation when available — do not ask redundant follow-up questions`;

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

export async function classifyAndRespond(
  userMessage: string,
  context: ContextPack,
  history: Array<{ role: 'user' | 'bot'; text: string }> = []
): Promise<ClassifiedMessage> {
  const contextStr = contextPackToString(context);
  const historySection = history.length > 0
    ? `Recent conversation:\n${history.map(m => `${m.role === 'bot' ? 'assistant' : 'user'}: ${m.text}`).join('\n')}\n\n`
    : '';

  let response: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: CLASSIFIER_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `${historySection}Context:\n${contextStr}\n\nMessage: ${userMessage}`,
        },
      ],
    });
  } catch (apiErr) {
    const apiMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
    const apiStatus = (apiErr as Record<string, unknown>)?.status;
    console.error('[claude] classifyAndRespond API error | status:', apiStatus ?? 'none', '| message:', apiMsg);
    // Return a safe fallback so the error never reaches the outer bot catch
    if (String(apiStatus) === '429' || apiMsg.includes('rate') || apiMsg.includes('529')) {
      return { route_type: 'casual', reply: "I'm a bit busy right now — give me a few seconds and try again.", confidence: 'low', ambiguities: [] };
    }
    if (String(apiStatus) === '401' || apiMsg.toLowerCase().includes('api key') || apiMsg.toLowerCase().includes('authentication')) {
      return { route_type: 'casual', reply: "I have a configuration problem on my end. Please let the admin know.", confidence: 'low', ambiguities: [] };
    }
    return { route_type: 'casual', reply: "I couldn't process that right now — please try again in a moment.", confidence: 'low', ambiguities: [] };
  }

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const msg = JSON.parse(cleaned) as ClassifiedMessage;

    // Guarantee intent.data exists when route is app_action
    if (msg.route_type === 'app_action' && msg.intent && !msg.intent.data) {
      (msg.intent as unknown as Record<string, unknown>).data = {};
    }
    if (!Array.isArray(msg.ambiguities)) {
      msg.ambiguities = [];
    }
    return msg;
  } catch {
    // Parse failure → safe casual fallback so the user always gets a response
    return {
      route_type: 'casual',
      reply: "Sorry, I lost my train of thought there — could you say that again?",
      confidence: 'low',
      ambiguities: ['Failed to parse AI response'],
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
- K1, K2 (next 2 priority tasks for ${planDate})
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
    "k1": "...",
    "k2": "...",
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

export async function interpretDayPlanEdit(
  userMessage: string,
  schedule: Array<{ time: string; title: string; type: string; duration_min: number }>,
  calendarEvents: Array<{ id: string; title: string; start: string; end: string; allDay: boolean }>,
  planDate: string
): Promise<DayPlanMutation> {
  // Format schedule with embedded event IDs so Claude can resolve time references
  const scheduleText = schedule.map((b) => {
    const eventMatch = calendarEvents.find((e) => e.title === b.title);
    const idTag = eventMatch ? ` [event_id:${eventMatch.id}]` : '';
    return `  ${b.time} ${b.title}${idTag} (${b.duration_min}min, type:${b.type})`;
  }).join('\n');

  const eventsText = calendarEvents
    .filter((e) => !e.allDay)
    .map((e) => {
      const startStr = e.start.slice(11, 16);
      const endStr = e.end.slice(11, 16);
      return `  - ${e.title} [id:${e.id}] ${startStr}–${endStr}`;
    }).join('\n') || '  (none)';

  const prompt = `Day plan for ${planDate}:
${scheduleText}

Calendar events available for removal:
${eventsText}

Edit request: "${userMessage}"

Return ONE JSON mutation object. Choose the type that best matches:

{ "type": "remove_event", "event_id": "<exact-id>", "event_title": "<title>" }
  → use when removing a calendar event/meeting/call from the plan
  → find the event by time reference ("8am call" → the event starting at 08:xx) or title match
  → event_id must be an exact id from the calendar events list above

{ "type": "change_wake_time", "new_time": "HH:MM" }
  → use when user wants to change wake time ("wake at 7:30", "change wake to 8am")

{ "type": "move_block", "block_title": "<exact title>", "new_start": "HH:MM" }
  → use when moving a block to a different time ("move lunch to 1pm", "make X earlier/later")
  → block_title must match exactly a title in the schedule above

{ "type": "remove_block", "block_title": "<exact title>" }
  → use when removing a task block from today ("push X to tomorrow", "skip X today", "shorten/remove X")
  → use for non-calendar blocks only (tasks, lunch, breaks)
  → block_title must match exactly a title in the schedule above

{ "type": "regenerate" }
  → use when user wants to rebuild the whole plan

{ "type": "unknown", "message": "<brief reason>" }
  → use when the request is ambiguous or can't be mapped

Rules:
- Parse times: "1pm"→"13:00", "7:30am"→"07:30", "noon"→"12:00"
- "earlier" without a specific time → subtract 30 min from current time
- "later" without a specific time → add 30 min to current time
- Calendar events (type:event in schedule) should use remove_event, not remove_block
- Output raw JSON only — no markdown, no prose`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      system: 'You are a day plan mutation parser. Output only raw JSON. Never add prose or markdown fences.',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const mutation = JSON.parse(cleaned) as DayPlanMutation;
    if (!mutation.type) throw new Error('no type field');
    return mutation;
  } catch (err) {
    console.error('[interpretDayPlanEdit] parse error:', err instanceof Error ? err.message : err);
    return { type: 'unknown', message: 'Could not parse edit request.' };
  }
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
  if (d.k1) lines.push(`K1: ${d.k1}`);
  if (d.k2) lines.push(`K2: ${d.k2}`);
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
