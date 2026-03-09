import { Telegraf } from 'telegraf';
import { Express } from 'express';
import { buildContextPack, determineDebriefDates } from '../ai/context';
import { classifyAndRespond, interpretDebriefReply, confirmDebriefSummary } from '../ai/claude';
import { routeClassified, captureToIntent } from '../ai/intents';
import { executeIntent, fmtDate } from '../mutations/executor';
import {
  getSession,
  setSession,
  clearSession,
  setLastTaskList,
  getLastTaskList,
  setLastIdeaList,
  getLastIdeaList,
  extractPositionalNumber,
  extractPositionalNumbers,
} from './session';
import { getFilePath, downloadVoiceNote, transcribeAudio } from './voice';
import { getTasksDueOnOrBefore, getTasksForDate } from '../db/queries/tasks';
import { executeToolCall } from '../tools/weather';
import { getDayPlanByDate, upsertDayPlan } from '../db/queries/day_plans';
import { generateDayPlan, formatAgendaForBot } from '../services/dayplan';
import { getEventsForDate } from '../services/calendar';
import { getJournalByDate } from '../db/queries/journals';
import { getLocalToday, getLocalTomorrow } from '../services/localdate';

// ---------------------------------------------------------------------------
// Per-chat message history ring buffer (for context carry-over)
// ---------------------------------------------------------------------------

const chatHistories = new Map<number, Array<{ role: 'user' | 'bot'; text: string }>>();
const HISTORY_MAX = 8;

function addToHistory(chatId: number, role: 'user' | 'bot', text: string): void {
  const hist = chatHistories.get(chatId) ?? [];
  hist.push({ role, text });
  if (hist.length > HISTORY_MAX) hist.shift();
  chatHistories.set(chatId, hist);
}

function getHistory(chatId: number): Array<{ role: 'user' | 'bot'; text: string }> {
  return chatHistories.get(chatId) ?? [];
}

if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is required');

export const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// ---------------------------------------------------------------------------
// Day plan helpers
// ---------------------------------------------------------------------------

/**
 * Regenerate (or generate fresh) the day plan for the given date.
 * Pulls journal MIT/K1/K2, calendar events, and tasks from DB.
 * Applies the given wake time override and appends new ignored keywords.
 * Returns the formatted agenda string.
 */
async function regeneratePlanFor(
  planDate: string,
  overrideWakeTime?: string,
  addIgnoredKeyword?: string
): Promise<string> {
  const existing = await getDayPlanByDate(planDate);
  const wakeTime = overrideWakeTime ?? existing?.wake_time ?? null;

  if (!wakeTime) {
    return `No wake time set for ${planDate}. Run your daily debrief with a Wake: HH:MM line to generate a plan.`;
  }

  const [journal, calendarEvents, tasks] = await Promise.all([
    getJournalByDate(planDate),
    getEventsForDate(planDate),
    getTasksForDate(planDate, 20),
  ]);

  const ignoredKeywords: string[] = [...(existing?.ignored_event_keywords ?? [])];
  if (addIgnoredKeyword) {
    const kw = addIgnoredKeyword.toLowerCase().trim();
    if (!ignoredKeywords.includes(kw)) ignoredKeywords.push(kw);
  }

  const focusTitles = new Set([journal?.mit, journal?.k1, journal?.k2].filter(Boolean));
  const otherTasks = tasks
    .filter((t) => !focusTitles.has(t.title))
    .map((t) => t.title);

  const { schedule, overflow, work_start } = generateDayPlan({
    wakeTime,
    calendarEvents,
    mit: journal?.mit ?? undefined,
    k1: journal?.k1 ?? undefined,
    k2: journal?.k2 ?? undefined,
    otherTasks,
    ignoredEventKeywords: ignoredKeywords,
  });

  await upsertDayPlan({
    plan_date: planDate,
    wake_time: wakeTime,
    work_start,
    schedule,
    overflow,
    ignored_event_keywords: ignoredKeywords,
  });

  return formatAgendaForBot(schedule, overflow, planDate);
}

/** Parse a time string like "7:30", "7am", "730", "07:30" → "07:30" or null */
function parseTimeInput(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s/g, '');
  // Formats: "7:30am", "7:30", "730", "7am", "9"
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3];
  if (ampm === 'am' && h === 12) h = 0;
  if (ampm === 'pm' && h !== 12) h += 12;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * Detect whether the message is a day plan command.
 * Returns the command type or null.
 */
function detectDayPlanCommand(lower: string): 'show' | 'wake' | 'remove' | 'regen' | null {
  // Show plan
  if (/\b(day plan|my plan|show.*plan|today'?s? plan|agenda|show.*agenda)\b/.test(lower)) return 'show';
  // Wake time update
  if (/\b(change wake|wake.*(up|time).*(to|at)|set wake|wake at|wake up to)\b/.test(lower)) return 'wake';
  // Remove event from plan
  if (/\b(remove|ignore|skip|take out|exclude)\b.+\b(from.*(plan|agenda|schedule)|event)\b/.test(lower)) return 'remove';
  // Regenerate
  if (/\b(redo|regenerate|rebuild|refresh|recalculate).*(plan|schedule|agenda|day)\b/.test(lower)) return 'regen';
  return null;
}

async function handleDayPlanCommand(
  lower: string,
  text: string,
  reply: (msg: string) => Promise<unknown>
): Promise<void> {
  const today = getLocalToday();
  const tomorrow = getLocalTomorrow();

  // Detect date target (default: today; "tomorrow" or "for tomorrow" → tomorrow)
  const planDate = /\btomorrow\b/.test(lower) ? tomorrow : today;

  const cmd = detectDayPlanCommand(lower);

  if (cmd === 'show') {
    const plan = await getDayPlanByDate(planDate);
    if (!plan || !plan.schedule.length) {
      await reply(
        `No day plan saved for ${planDate}. Run your daily debrief with a Wake: HH:MM line to generate one.`
      );
      return;
    }
    await reply(formatAgendaForBot(plan.schedule, plan.overflow, planDate));
    return;
  }

  if (cmd === 'wake') {
    // Extract time from message: "change wake up to 7:30", "wake at 9am"
    const timeMatch = text.match(/(?:to|at|:)?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*$/i)
      ?? text.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
    if (!timeMatch) {
      await reply('What time should I set the wake time to? (e.g. "change wake up to 7:30")');
      return;
    }
    const wakeTime = parseTimeInput(timeMatch[1]);
    if (!wakeTime) {
      await reply(`Couldn't parse that time. Try something like "change wake up to 7:30" or "wake at 8am".`);
      return;
    }
    console.log('[bot] day plan: updating wake time to', wakeTime, 'for', planDate);
    const agenda = await regeneratePlanFor(planDate, wakeTime);
    await reply(`Wake time updated to ${wakeTime}. Here's your regenerated plan:\n\n${agenda}`);
    return;
  }

  if (cmd === 'remove') {
    // Extract the keyword to ignore: "remove padel from my plan" → "padel"
    const removeMatch = lower.match(/\b(?:remove|ignore|skip|take out|exclude)\s+(.+?)\s+(?:from|event)/);
    const keyword = removeMatch?.[1]?.trim();
    if (!keyword) {
      await reply('Which event should I remove? e.g. "remove padel from my plan"');
      return;
    }
    console.log('[bot] day plan: ignoring keyword', keyword, 'for', planDate);
    const agenda = await regeneratePlanFor(planDate, undefined, keyword);
    await reply(`"${keyword}" removed from plan. Regenerated:\n\n${agenda}`);
    return;
  }

  if (cmd === 'regen') {
    console.log('[bot] day plan: regenerating for', planDate);
    const agenda = await regeneratePlanFor(planDate);
    await reply(`Regenerated plan for ${planDate}:\n\n${agenda}`);
    return;
  }
}

function isAffirmative(lower: string): boolean {
  return ['yes', 'y', 'yeah', 'yep', 'yup', 'ok', 'okay', 'sure', 'confirm', 'do it', 'go ahead'].includes(lower);
}

function isNegative(lower: string): boolean {
  return ['no', 'n', 'nope', 'cancel', 'nah', 'stop', "don't"].includes(lower);
}

async function handleText(chatId: number, text: string, rawReply: (msg: string) => Promise<unknown>) {
  // Wrap reply so every bot response is tracked in history automatically
  const reply = async (msg: string) => {
    addToHistory(chatId, 'bot', msg);
    return rawReply(msg);
  };

  addToHistory(chatId, 'user', text);
  const session = getSession(chatId);
  const lower = text.toLowerCase().trim();

  // --- Pending capture confirmation (idea/thought/win/goal/resource) ---
  if (session.state === 'pending_capture') {
    if (isAffirmative(lower)) {
      const intent = captureToIntent(session.captureType, session.captureContent);
      clearSession(chatId);
      console.log('[bot] pending_capture confirmed → executing', intent.intent);
      try {
        const result = await executeIntent(intent);
        await reply(result.message);
      } catch (e) {
        console.error('[bot] pending_capture executeIntent threw:', e instanceof Error ? e.message : e);
        await reply("Couldn't save that — please try again.");
      }
    } else if (isNegative(lower)) {
      clearSession(chatId);
      await reply('Got it, not saved.');
    } else {
      // Unrelated message — discard pending capture and handle as fresh message
      clearSession(chatId);
      return await handleText(chatId, text, rawReply);
    }
    return;
  }

  // --- Pending intent confirmation (ambiguous app_action) ---
  if (session.state === 'pending_confirmation') {
    if (isAffirmative(lower)) {
      const intent = session.pendingIntent;
      clearSession(chatId);
      console.log('[bot] pending_confirmation confirmed → executing', intent.intent);
      if (intent.intent === 'daily_debrief') {
        await startDebrief(chatId, reply);
      } else {
        try {
          const result = await executeIntent(intent);
          await reply(result.message);
        } catch (e) {
          console.error('[bot] pending_confirmation executeIntent threw:', e instanceof Error ? e.message : e);
          await reply("Couldn't complete that — please try again.");
        }
      }
    } else if (isNegative(lower)) {
      clearSession(chatId);
      await reply('Got it, no action taken.');
    } else {
      // Unrelated message — discard and re-route
      clearSession(chatId);
      return await handleText(chatId, text, rawReply);
    }
    return;
  }

  // --- Debrief: awaiting user input ---
  if (session.state === 'debrief_awaiting_input') {
    // Allow explicit cancel before trying to interpret the message as debrief content
    if (isNegative(lower) || lower === 'cancel' || lower === 'exit' || lower === 'quit') {
      clearSession(chatId);
      console.log('[bot] debrief_awaiting_input cancelled by user');
      await reply('Debrief cancelled.');
      return;
    }
    const { debriefDate, planDate, tasks: debriefTasks } = session;
    console.log('[bot] debrief_awaiting_input → interpreting reply for', debriefDate, '/', planDate, '| tasks in session:', debriefTasks.length);
    let ctx: Awaited<ReturnType<typeof buildContextPack>>;
    try {
      ctx = await buildContextPack();
    } catch {
      ctx = {
        today: new Date().toISOString().slice(0, 10),
        tomorrow: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        overdue: [], todayTasks: [], tomorrowTasks: [], next7Tasks: [], goals: [],
        todayJournal: null, calendarEvents: [],
      };
    }
    const intent = await interpretDebriefReply(text, debriefDate, planDate, ctx, debriefTasks);
    console.log('[bot] debrief intent parsed — intent:', intent.intent);
    console.log('[bot] debrief intent data:', JSON.stringify(intent.intent === 'save_debrief' ? intent.data : '[unknown intent — recovery failed]'));

    // If parseDebriefResponse could not recover a valid save_debrief, do not store
    // unknown in session and ask user to retry rather than confirming garbage.
    if (intent.intent !== 'save_debrief') {
      clearSession(chatId);
      await reply(
        "Sorry, I had trouble parsing that debrief. Please try again — send /debrief and reply with the same content."
      );
      return;
    }

    const summary = await confirmDebriefSummary(intent, debriefTasks);
    setSession(chatId, { state: 'debrief_awaiting_confirmation', debriefDate, planDate, pendingIntent: intent });
    await reply(summary);
    return;
  }

  // --- Debrief: awaiting confirmation ---
  if (session.state === 'debrief_awaiting_confirmation') {
    if (lower === 'yes' || lower === 'y' || lower === 'confirm') {
      console.log('[bot] debrief_awaiting_confirmation confirmed → executing save_debrief');
      try {
        const result = await executeIntent(session.pendingIntent);
        clearSession(chatId);
        await reply(result.message);
      } catch (err) {
        clearSession(chatId);
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[bot] debrief confirm error:', msg);
        await reply('Something went wrong saving the debrief. Please try /debrief again.');
      }
    } else {
      clearSession(chatId);
      console.log('[bot] debrief_awaiting_confirmation cancelled/denied');
      await reply('Got it, debrief not saved.');
    }
    return;
  }

  // --- Fast path: day plan commands (no Claude API call, no context pack needed) ---
  if (detectDayPlanCommand(lower)) {
    try {
      await handleDayPlanCommand(lower, text, reply);
    } catch (dpErr) {
      console.error('[bot] day plan command error:', dpErr instanceof Error ? dpErr.message : dpErr);
      await reply('Something went wrong with the day plan. Please try again.');
    }
    return;
  }

  // --- Top-level 4-way classification ---
  // buildContextPack() makes DB queries — if the DB is down, use empty context so Claude
  // can still respond rather than crashing the whole handler.
  let ctx: Awaited<ReturnType<typeof buildContextPack>>;
  try {
    ctx = await buildContextPack();
  } catch (ctxErr) {
    console.error('[bot] buildContextPack failed (DB issue?) — continuing with empty context:', ctxErr instanceof Error ? ctxErr.message : ctxErr);
    ctx = {
      today: new Date().toISOString().slice(0, 10),
      tomorrow: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      overdue: [], todayTasks: [], tomorrowTasks: [], next7Tasks: [], goals: [],
      todayJournal: null, calendarEvents: [],
    };
  }
  console.log('[bot] classifying message for chat', chatId);
  const classified = await classifyAndRespond(text, ctx, getHistory(chatId));
  console.log('[bot] route_type:', classified.route_type, '| needs_tool:', classified.needs_tool ?? 'none');

  // Execute tool calls BEFORE routing so the answer is real, not fabricated
  if (classified.needs_tool && classified.route_type === 'assistant_answer') {
    console.log('[bot] executing tool:', classified.needs_tool, JSON.stringify(classified.tool_params));
    const toolResult = await executeToolCall(classified.needs_tool, classified.tool_params ?? {});
    classified.answer = toolResult;
    classified.needs_tool = undefined;
  }

  const action = routeClassified(classified);
  console.log('[bot] action:', action.action);

  switch (action.action) {
    case 'reply':
      await reply(action.text);
      break;

    case 'ask':
      await reply(action.question);
      break;

    case 'confirm_capture':
      setSession(chatId, {
        state: 'pending_capture',
        captureType: action.captureType,
        captureContent: action.captureContent,
      });
      await reply(`${action.question}\n\nReply "yes" to save or "no" to discard.`);
      break;

    case 'confirm_intent':
      setSession(chatId, { state: 'pending_confirmation', pendingIntent: action.intent });
      await reply(`${action.question}\n\nReply "yes" to confirm or "no" to cancel.`);
      break;

    case 'execute': {
      const intent = action.intent;

      // Resolve single positional task reference from the last shown task list
      if (intent.intent === 'complete_task' || intent.intent === 'move_task_date') {
        const pos = extractPositionalNumber(text);
        if (pos !== null) {
          const ref = getLastTaskList(chatId);
          if (ref && pos >= 1 && pos <= ref.taskIds.length) {
            console.log('[bot] resolving position', pos, 'from last task list scope:', ref.scope);
            intent.data.task_id = ref.taskIds[pos - 1];
            delete (intent.data as Record<string, unknown>).task_title;
          } else if (!ref) {
            console.log('[bot] positional ref', pos, 'but no task list stored — asking clarification');
            await reply('Could you be more specific? Try showing your tasks first (e.g. "show tasks"), then tell me which one to complete.');
            return;
          }
          // pos out of bounds: let executor handle it via task_title fallback
        }
      }

      // Resolve multiple positional refs for bulk complete / bulk move
      if (intent.intent === 'complete_tasks_bulk' || intent.intent === 'move_tasks_bulk') {
        const bulkData = intent.data as Record<string, unknown>;
        const positions = bulkData.positions as number[] | undefined;
        if (positions && positions.length > 0) {
          const ref = getLastTaskList(chatId);
          if (!ref) {
            console.log('[bot] bulk positional refs but no task list stored');
            await reply('Show your tasks first (e.g. "show tasks"), then tell me which numbers to act on.');
            return;
          }
          const resolvedIds = positions
            .filter((p) => p >= 1 && p <= ref.taskIds.length)
            .map((p) => ref.taskIds[p - 1]);
          if (resolvedIds.length === 0) {
            await reply('Those task numbers are out of range. Try showing your tasks first.');
            return;
          }
          console.log('[bot] bulk resolved positions', positions, '→', resolvedIds.length, 'IDs');
          bulkData.task_ids = resolvedIds;
          delete bulkData.positions;
        }
      }

      // Resolve idea positional references for set_idea_next_step / promote_idea_to_project
      if (intent.intent === 'set_idea_next_step' || intent.intent === 'promote_idea_to_project') {
        const d = intent.data as Record<string, unknown>;
        if (d.position && typeof d.position === 'number') {
          const ref = getLastIdeaList(chatId);
          if (!ref) {
            await reply('Show your ideas first (e.g. "show ideas"), then reference them by number.');
            return;
          }
          const pos = d.position as number;
          if (pos >= 1 && pos <= ref.ideaIds.length) {
            console.log('[bot] resolving idea position', pos, 'from last idea list');
            d.idea_id = ref.ideaIds[pos - 1];
            delete d.position;
          }
        }
      }

      console.log('[bot] executing intent:', intent.intent);

      if (intent.intent === 'daily_debrief') {
        await startDebrief(chatId, reply);
      } else if (intent.intent === 'weekly_review') {
        await handleReviewCommand(chatId, reply);
      } else {
        let result: Awaited<ReturnType<typeof executeIntent>>;
        try {
          result = await executeIntent(intent);
        } catch (execErr) {
          const execMsg = execErr instanceof Error ? execErr.message : String(execErr);
          console.error('[bot] executeIntent threw for', intent.intent, ':', execMsg);
          await reply(`Couldn't complete that — ${execMsg.slice(0, 80)}. Please try again.`);
          break;
        }

        // Store task list ref when a numbered list was shown
        if (
          intent.intent === 'list_tasks' &&
          result.success &&
          result.data &&
          typeof result.data === 'object' &&
          'taskIds' in result.data
        ) {
          const { taskIds, scope } = result.data as { taskIds: string[]; scope: string };
          setLastTaskList(chatId, scope ?? 'today', taskIds);
          console.log('[bot] stored task list ref: scope=', scope, 'count=', taskIds.length);
        }

        // Store idea list ref when a numbered idea list was shown
        if (
          intent.intent === 'list_ideas' &&
          result.success &&
          result.data &&
          typeof result.data === 'object' &&
          'ideaIds' in result.data
        ) {
          const { ideaIds } = result.data as { ideaIds: string[] };
          setLastIdeaList(chatId, ideaIds);
          console.log('[bot] stored idea list ref: count=', ideaIds.length);
        }

        await reply(result.message);
      }
      break;
    }
  }
}

async function startDebrief(chatId: number, reply: (msg: string) => Promise<unknown>) {
  const now = new Date();
  const { debriefDate, planDate } = determineDebriefDates(now);

  const tasks = await getTasksDueOnOrBefore(planDate, 30);

  const taskLines = tasks.length
    ? tasks.map((t, i) => `${i + 1}. ${t.title}${t.due_date ? ` (${fmtDate(t.due_date)})` : ''}`).join('\n')
    : 'No open tasks.';

  const taskSummary = taskLines;

  // Store full task objects (with IDs) so debrief reply parser can resolve positional refs
  const sessionTasks = tasks.map((t) => ({ id: t.id, title: t.title, due_date: t.due_date }));

  setSession(chatId, {
    state: 'debrief_awaiting_input',
    debriefDate,
    planDate,
    taskSummary,
    tasks: sessionTasks,
  });

  await reply(
    `Daily Debrief\nDebriefing: ${fmtDate(debriefDate)}\nPlanning: ${fmtDate(planDate)}\n\nOpen tasks:\n${taskSummary}\n\nReply with your wake time, MIT, K1, K2, reflections, and wins.\nExample:\nWake: 07:00\nMIT: Finish proposal\nK1: Review PR\nK2: Email client\nJournal: Good focus day\nWins: Shipped feature, hit inbox zero\n\nInclude "Wake: HH:MM" to get a generated day plan.\nSend "cancel" to exit.`
  );
}

// Handle text messages
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text;

  try {
    await handleText(chatId, text, (msg) => ctx.reply(msg));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as Record<string, unknown>)?.code;
    const status = (err as Record<string, unknown>)?.status;
    // Log full error so Railway logs show the real cause
    console.error('[bot] unhandled error for chat', chatId, '| code:', code ?? 'none', '| status:', status ?? 'none', '| message:', msg);
    if (err instanceof Error && err.stack) {
      console.error('[bot] stack:', err.stack.split('\n').slice(0, 4).join(' | '));
    }
    if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('ECONNREFUSED')) {
      await ctx.reply('Request timed out — please try again in a moment.');
    } else if (msg.includes('rate') || msg.includes('529') || msg.includes('429') || status === 529 || status === 429) {
      await ctx.reply("I'm a little busy right now — wait a few seconds and try again.");
    } else if (msg.includes('connect') || msg.includes('ENOTFOUND')) {
      await ctx.reply('I lost my connection for a moment — please try again.');
    } else if (
      msg.toLowerCase().includes('api key') ||
      msg.toLowerCase().includes('authentication') ||
      msg.toLowerCase().includes('unauthorized') ||
      status === 401
    ) {
      await ctx.reply('There is a configuration issue on my end. Please let the admin know.');
    } else {
      await ctx.reply(`Sorry, something went wrong (${msg.slice(0, 60)}). Please try again.`);
    }
  }
});

// Handle voice messages
bot.on('voice', async (ctx) => {
  const chatId = ctx.chat.id;
  const fileId = ctx.message.voice.file_id;

  try {
    await ctx.reply('Transcribing voice note...');
    const fileUrl = await getFilePath(process.env.TELEGRAM_BOT_TOKEN!, fileId);
    const audioBuffer = await downloadVoiceNote(fileUrl);
    const transcript = await transcribeAudio(audioBuffer);
    await ctx.reply(`Transcript: "${transcript}"`);
    await handleText(chatId, transcript, (msg) => ctx.reply(msg));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[bot] voice error for chat', chatId, ':', msg);
    await ctx.reply('Failed to transcribe voice note. Please try again or type your message.');
  }
});

// Handle /start
bot.command('start', async (ctx) => {
  await ctx.reply(
    `Hey! I'm your personal AI assistant.\n\nJust talk to me naturally — I can:\n• Show and manage your tasks\n• Answer questions and help you think\n• Save ideas, wins, goals, and thoughts\n• Run your daily debrief\n\nTry: "what do I have today", "berlin tea gatherings could be cool", or "help me think through X".`
  );
});

// Handle /debrief
bot.command('debrief', async (ctx) => {
  await startDebrief(ctx.chat.id, (msg) => ctx.reply(msg));
});

// Handle /plan — show today's day plan
bot.command('plan', async (ctx) => {
  const today = getLocalToday();
  try {
    const plan = await getDayPlanByDate(today);
    if (!plan || !plan.schedule.length) {
      await ctx.reply(`No day plan saved for today (${today}). Run your daily debrief with a Wake: HH:MM to generate one.`);
    } else {
      await ctx.reply(formatAgendaForBot(plan.schedule, plan.overflow, today));
    }
  } catch (err) {
    console.error('[bot] /plan error:', err instanceof Error ? err.message : err);
    await ctx.reply('Could not load the day plan. Please try again.');
  }
});

// Handle /undo
bot.command('undo', async (ctx) => {
  const result = await executeIntent({ intent: 'undo_last', data: {} });
  await ctx.reply(result.message);
});

// Handle /review — show a weekly review summary
bot.command('review', async (ctx) => {
  await handleReviewCommand(ctx.chat.id, (msg) => ctx.reply(msg));
});

// Natural language trigger: "weekly review", "sunday review", "show my weekly review"
async function handleReviewCommand(chatId: number, reply: (msg: string) => Promise<unknown>) {
  try {
    const pool = (await import('../db/client')).default;
    const { format, subDays } = await import('date-fns');
    const now = new Date();
    const weekStart = format(subDays(now, 7), 'yyyy-MM-dd');
    const today = format(now, 'yyyy-MM-dd');

    const [winsRes, journalsRes, goalsRes, overdueRes, upcomingRes, highIdeasRes] = await Promise.all([
      pool.query(
        `SELECT content, entry_date FROM wins WHERE entry_date >= $1 ORDER BY entry_date DESC`,
        [weekStart]
      ),
      pool.query(
        `SELECT entry_date, mit, k1, k2, open_journal FROM journals WHERE entry_date >= $1 ORDER BY entry_date DESC LIMIT 7`,
        [weekStart]
      ),
      pool.query(`SELECT title, target_date FROM goals WHERE status = 'active' ORDER BY created_at DESC LIMIT 5`),
      pool.query(
        `SELECT id, title, due_date FROM tasks WHERE status = 'todo' AND due_date < $1 ORDER BY due_date ASC LIMIT 10`,
        [today]
      ),
      pool.query(
        `SELECT id, title, due_date FROM tasks WHERE status = 'todo' AND due_date >= $1 ORDER BY due_date ASC LIMIT 10`,
        [today]
      ),
      pool.query(
        `SELECT content, next_step FROM ideas WHERE actionability = 'high' AND status = 'active' ORDER BY created_at DESC LIMIT 5`
      ),
    ]);

    const lines: string[] = [`Weekly Review — ${fmtDate(weekStart)} to ${fmtDate(today)}`];

    // Active goals
    if (goalsRes.rows.length) {
      lines.push(`\nActive Goals (${goalsRes.rows.length}):`);
      goalsRes.rows.forEach((g) => lines.push(`• ${g.title}${g.target_date ? ` → ${fmtDate(g.target_date)}` : ''}`));
    }

    // Wins
    if (winsRes.rows.length) {
      lines.push(`\nWins this week (${winsRes.rows.length}):`);
      winsRes.rows.forEach((w) => lines.push(`• ${w.content} (${fmtDate(w.entry_date)})`));
    } else {
      lines.push('\nNo wins logged this week. Add one: "win: ..."');
    }

    // Focus from journals
    if (journalsRes.rows.length) {
      lines.push(`\nFocus this week:`);
      journalsRes.rows.forEach((j) => {
        const parts = [`${fmtDate(j.entry_date)}:`];
        if (j.mit) parts.push(`MIT: ${j.mit}`);
        if (j.k1) parts.push(`K1: ${j.k1}`);
        if (j.open_journal) parts.push(`Note: ${j.open_journal.slice(0, 80)}`);
        if (parts.length > 1) lines.push(`  ${parts.join(' | ')}`);
      });
    }

    // High-actionability ideas
    if (highIdeasRes.rows.length) {
      lines.push(`\nHigh-actionability ideas (${highIdeasRes.rows.length}):`);
      highIdeasRes.rows.forEach((idea) => {
        let line = `• ${idea.content}`;
        if (idea.next_step) line += `\n  → Next: ${idea.next_step}`;
        lines.push(line);
      });
    }

    // Overdue tasks
    if (overdueRes.rows.length) {
      lines.push(`\nOverdue (${overdueRes.rows.length}):`);
      overdueRes.rows.forEach((t, i) => lines.push(`${i + 1}. ${t.title} (${fmtDate(t.due_date)})`));
    }

    // Upcoming tasks
    if (upcomingRes.rows.length) {
      lines.push(`\nUpcoming (${upcomingRes.rows.length}):`);
      upcomingRes.rows.slice(0, 7).forEach((t, i) => lines.push(`${i + 1}. ${t.title}${t.due_date ? ` (${fmtDate(t.due_date)})` : ''}`));
    }

    if (goalsRes.rows.length === 0 && winsRes.rows.length === 0 && journalsRes.rows.length === 0) {
      lines.push('\nNo data yet. Run your daily debrief to start building your review history.');
    }

    await reply(lines.join('\n'));
  } catch (err) {
    console.error('[bot] review error:', err instanceof Error ? err.message : err);
    await reply('Could not load your weekly review. Please try again.');
  }
}

export async function setupWebhook(app: Express, webhookUrl: string) {
  const path = `/webhook/${process.env.TELEGRAM_BOT_TOKEN}`;
  await bot.telegram.setWebhook(`${webhookUrl}${path}`);
  app.use(bot.webhookCallback(path));
  console.log(`Webhook set to ${webhookUrl}${path}`);
}
