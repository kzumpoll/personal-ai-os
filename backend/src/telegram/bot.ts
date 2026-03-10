import { Telegraf } from 'telegraf';
import { Express } from 'express';
import { buildContextPack, determineDebriefDates } from '../ai/context';
import { interpretUserIntent, interpretDebriefReply, confirmDebriefSummary, DayPlanMutation } from '../ai/claude';
import { captureToIntent } from '../ai/intents';
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
import { getDayPlanByDate, upsertDayPlan, setDayPlanIntentions, setFocusCompletion, IgnoredEventSnapshot, ScheduleBlock } from '../db/queries/day_plans';
import { generateDayPlan, formatAgendaForBot, diffDayPlans } from '../services/dayplan';
import { getEventsForDate } from '../services/calendar';
import { getJournalByDate } from '../db/queries/journals';
import { getLocalToday, getLocalTomorrow } from '../services/localdate';
import { createWin, getWinsForDate } from '../db/queries/wins';

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
 * Optionally adds a new ignored event (by exact GCal ID) and its snapshot.
 * Returns the formatted agenda string.
 */
async function regeneratePlanFor(
  planDate: string,
  overrideWakeTime?: string,
  addIgnoredEvent?: { id: string; title: string; start: string }
): Promise<{ agenda: string; diff: string | null }> {
  const existing = await getDayPlanByDate(planDate);
  const wakeTime = overrideWakeTime ?? existing?.wake_time ?? null;

  if (!wakeTime) {
    return {
      agenda: `No wake time set for ${planDate}. Run your daily debrief with a Wake: HH:MM line to generate a plan.`,
      diff: null,
    };
  }

  const [journal, calendarEvents, tasks] = await Promise.all([
    getJournalByDate(planDate),
    getEventsForDate(planDate),
    getTasksForDate(planDate, 20),
  ]);

  const ignoredIds: string[] = [...(existing?.ignored_event_ids ?? [])];
  const ignoredSnapshots: IgnoredEventSnapshot[] = [...(existing?.ignored_event_snapshots ?? [])];

  if (addIgnoredEvent && !ignoredIds.includes(addIgnoredEvent.id)) {
    ignoredIds.push(addIgnoredEvent.id);
    ignoredSnapshots.push({
      id: addIgnoredEvent.id,
      title: addIgnoredEvent.title,
      start: addIgnoredEvent.start,
      removedAt: new Date().toISOString(),
    });
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
    ignoredEventIds: ignoredIds,
  });

  const diff = existing
    ? diffDayPlans(existing.schedule, existing.overflow, schedule, overflow, existing.wake_time, wakeTime)
    : null;

  const saved = await upsertDayPlan({
    plan_date: planDate,
    wake_time: wakeTime,
    work_start,
    schedule,
    overflow,
    ignored_event_ids: ignoredIds,
    ignored_event_snapshots: ignoredSnapshots,
  });

  return {
    agenda: formatAgendaForBot(schedule, overflow, planDate, saved),
    diff,
  };
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

function formatPlanReply(heading: string, diff: string | null, agenda?: string): string {
  const parts = [heading];
  if (diff) {
    parts.push('');
    parts.push(`Changes:\n${diff}`);
  }
  if (agenda) {
    parts.push('');
    parts.push(agenda);
  }
  return parts.join('\n');
}

async function applyDayPlanMutation(
  planDate: string,
  mutation: DayPlanMutation,
  plan: Awaited<ReturnType<typeof getDayPlanByDate>> & object,
  calendarEvents: Awaited<ReturnType<typeof getEventsForDate>>,
  reply: (msg: string) => Promise<unknown>
): Promise<void> {
  switch (mutation.type) {
    case 'show': {
      const p = plan as Awaited<ReturnType<typeof getDayPlanByDate>>;
      if (!p || !p.schedule.length) {
        await reply(`No day plan saved for ${planDate}. Run your daily debrief with a Wake: HH:MM line to generate one.`);
      } else {
        await reply(formatAgendaForBot(p.schedule, p.overflow, planDate, p));
      }
      break;
    }

    case 'remove_event': {
      const ev = calendarEvents.find((e) => e.id === mutation.event_id)
        ?? calendarEvents.find((e) => e.title.toLowerCase() === (mutation.event_title ?? '').toLowerCase());
      if (!ev) {
        await reply(`Couldn't find that event in today's calendar. Check the event name or try "show my plan" first.`);
        return;
      }
      const { agenda, diff } = await regeneratePlanFor(planDate, undefined, { id: ev.id, title: ev.title, start: ev.start });
      await reply(formatPlanReply(`"${ev.title}" removed from plan.`, diff, agenda));
      break;
    }

    case 'change_wake_time': {
      if (!mutation.new_time) {
        await reply(`What time should I set the wake time to? (e.g. "wake at 7:30")`);
        return;
      }
      const { agenda, diff } = await regeneratePlanFor(planDate, mutation.new_time);
      await reply(formatPlanReply(`Wake time updated to ${mutation.new_time}.`, diff, agenda));
      break;
    }

    case 'move_block': {
      const title = mutation.block_title ?? '';
      const idx = plan.schedule.findIndex((b) => b.title.toLowerCase() === title.toLowerCase());
      if (idx === -1) {
        await reply(`Couldn't find "${title}" in the current plan. Try "show my plan" to see what's scheduled.`);
        return;
      }
      const oldSchedule = [...plan.schedule];
      const newSchedule = [...plan.schedule];
      newSchedule[idx] = { ...newSchedule[idx], time: mutation.new_start! };
      newSchedule.sort((a, b) => {
        if (a.type === 'wake') return -1;
        if (b.type === 'wake') return 1;
        return a.time.localeCompare(b.time);
      });
      const diff = diffDayPlans(oldSchedule, plan.overflow, newSchedule, plan.overflow, plan.wake_time, plan.wake_time);
      await upsertDayPlan({
        plan_date: planDate,
        wake_time: plan.wake_time ?? undefined,
        work_start: plan.work_start ?? undefined,
        schedule: newSchedule,
        overflow: plan.overflow,
        ignored_event_ids: plan.ignored_event_ids,
        ignored_event_snapshots: plan.ignored_event_snapshots,
      });
      await reply(formatPlanReply(`"${title}" moved to ${mutation.new_start}.`, diff));
      break;
    }

    case 'remove_block': {
      const title = mutation.block_title ?? '';
      const oldSchedule = plan.schedule;
      const newSchedule = plan.schedule.filter((b) => b.title !== title);
      if (newSchedule.length === oldSchedule.length) {
        await reply(`Couldn't find "${title}" in the current plan. Try "show my plan" to see what's scheduled.`);
        return;
      }
      const newOverflow = [...plan.overflow, title];
      const diff = diffDayPlans(oldSchedule, plan.overflow, newSchedule, newOverflow, plan.wake_time, plan.wake_time);
      await upsertDayPlan({
        plan_date: planDate,
        wake_time: plan.wake_time ?? undefined,
        work_start: plan.work_start ?? undefined,
        schedule: newSchedule,
        overflow: newOverflow,
        ignored_event_ids: plan.ignored_event_ids,
        ignored_event_snapshots: plan.ignored_event_snapshots,
      });
      await reply(formatPlanReply(`"${title}" removed from today's schedule.`, diff));
      break;
    }

    case 'regenerate': {
      const { agenda, diff } = await regeneratePlanFor(planDate);
      await reply(formatPlanReply('Plan regenerated.', diff, agenda));
      break;
    }

    case 'complete_mit': {
      await setFocusCompletion(planDate, 'mit_done', true);
      const p = plan as Awaited<ReturnType<typeof getDayPlanByDate>>;
      const updated = p ? { ...p, mit_done: true } : undefined;
      const agenda = p ? formatAgendaForBot(p.schedule, p.overflow, planDate, updated) : undefined;
      await reply(agenda ? `MIT marked done ✅\n\n${agenda}` : 'MIT marked done ✅');
      break;
    }

    case 'complete_k1': {
      await setFocusCompletion(planDate, 'k1_done', true);
      const p = plan as Awaited<ReturnType<typeof getDayPlanByDate>>;
      const updated = p ? { ...p, k1_done: true } : undefined;
      const agenda = p ? formatAgendaForBot(p.schedule, p.overflow, planDate, updated) : undefined;
      await reply(agenda ? `K1 marked done ✅\n\n${agenda}` : 'K1 marked done ✅');
      break;
    }

    case 'complete_k2': {
      await setFocusCompletion(planDate, 'k2_done', true);
      const p = plan as Awaited<ReturnType<typeof getDayPlanByDate>>;
      const updated = p ? { ...p, k2_done: true } : undefined;
      const agenda = p ? formatAgendaForBot(p.schedule, p.overflow, planDate, updated) : undefined;
      await reply(agenda ? `K2 marked done ✅\n\n${agenda}` : 'K2 marked done ✅');
      break;
    }

    case 'log_win': {
      const content = mutation.win_content ?? '';
      if (!content) {
        await reply("What's the win? Try: \"win: <description>\"");
        return;
      }
      await createWin({ content, entry_date: planDate });
      await reply(`Win logged ✓\n"${content}"`);
      break;
    }

    case 'set_mit': {
      const value = mutation.mit_value ?? '';
      const targetDate = mutation.target_date ?? planDate;
      if (!value) {
        await reply('What should the MIT be?');
        return;
      }
      await setDayPlanIntentions(targetDate, { planned_mit: value });
      await reply(`MIT for ${targetDate} set: "${value}"`);
      break;
    }

    case 'set_k1': {
      const value = mutation.k1_value ?? '';
      const targetDate = mutation.target_date ?? planDate;
      if (!value) {
        await reply('What should K1 be?');
        return;
      }
      await setDayPlanIntentions(targetDate, { planned_k1: value });
      await reply(`K1 for ${targetDate} set: "${value}"`);
      break;
    }

    case 'set_k2': {
      const value = mutation.k2_value ?? '';
      const targetDate = mutation.target_date ?? planDate;
      if (!value) {
        await reply('What should K2 be?');
        return;
      }
      await setDayPlanIntentions(targetDate, { planned_k2: value });
      await reply(`K2 for ${targetDate} set: "${value}"`);
      break;
    }

    case 'add_block': {
      const title = mutation.block_title ?? '';
      const startTime = mutation.new_start;
      const dur = mutation.duration_min ?? 30;
      if (!title || !startTime) {
        await reply('Please specify a title and time — e.g. "add a 30 min walk at 5pm".');
        return;
      }
      const newBlock: ScheduleBlock = { time: startTime, title, type: 'task', duration_min: dur };
      const newSchedule = [...plan.schedule, newBlock].sort((a, b) => {
        if (a.type === 'wake') return -1;
        if (b.type === 'wake') return 1;
        return a.time.localeCompare(b.time);
      });
      const diff = diffDayPlans(plan.schedule, plan.overflow, newSchedule, plan.overflow, plan.wake_time, plan.wake_time);
      await upsertDayPlan({
        plan_date: planDate,
        wake_time: plan.wake_time ?? undefined,
        work_start: plan.work_start ?? undefined,
        schedule: newSchedule,
        overflow: plan.overflow,
        ignored_event_ids: plan.ignored_event_ids,
        ignored_event_snapshots: plan.ignored_event_snapshots,
      });
      await reply(formatPlanReply(`"${title}" added at ${startTime}.`, diff));
      break;
    }

    case 'rename_block': {
      const title = mutation.block_title ?? '';
      const newTitle = mutation.new_title ?? '';
      if (!title || !newTitle) {
        await reply('Please specify the current block name and the new name.');
        return;
      }
      const idx = plan.schedule.findIndex((b) => b.title.toLowerCase() === title.toLowerCase());
      if (idx === -1) {
        await reply(`Couldn't find "${title}" in the current plan. Try "show my plan" to see block names.`);
        return;
      }
      const renamedSchedule = [...plan.schedule];
      renamedSchedule[idx] = { ...renamedSchedule[idx], title: newTitle };
      const diff = diffDayPlans(plan.schedule, plan.overflow, renamedSchedule, plan.overflow, plan.wake_time, plan.wake_time);
      await upsertDayPlan({
        plan_date: planDate,
        wake_time: plan.wake_time ?? undefined,
        work_start: plan.work_start ?? undefined,
        schedule: renamedSchedule,
        overflow: plan.overflow,
        ignored_event_ids: plan.ignored_event_ids,
        ignored_event_snapshots: plan.ignored_event_snapshots,
      });
      await reply(formatPlanReply(`"${title}" renamed to "${newTitle}".`, diff));
      break;
    }

    case 'resize_block': {
      const title = mutation.block_title ?? '';
      const dur = mutation.duration_min;
      if (!title || !dur) {
        await reply('Please specify the block name and new duration — e.g. "make Clear Inbox 30 minutes".');
        return;
      }
      const idx = plan.schedule.findIndex((b) => b.title.toLowerCase() === title.toLowerCase());
      if (idx === -1) {
        await reply(`Couldn't find "${title}" in the current plan. Try "show my plan" to see block names.`);
        return;
      }
      const resizedSchedule = [...plan.schedule];
      resizedSchedule[idx] = { ...resizedSchedule[idx], duration_min: dur };
      const diff = diffDayPlans(plan.schedule, plan.overflow, resizedSchedule, plan.overflow, plan.wake_time, plan.wake_time);
      await upsertDayPlan({
        plan_date: planDate,
        wake_time: plan.wake_time ?? undefined,
        work_start: plan.work_start ?? undefined,
        schedule: resizedSchedule,
        overflow: plan.overflow,
        ignored_event_ids: plan.ignored_event_ids,
        ignored_event_snapshots: plan.ignored_event_snapshots,
      });
      await reply(formatPlanReply(`"${title}" resized to ${dur} min.`, diff));
      break;
    }

    case 'plan_question': {
      await reply(
        mutation.answer_text ??
        `Yes — you can view, edit, or regenerate your day plan. Try:\n• "show my plan"\n• "move lunch to 1pm"\n• "remove standup from my plan"\n• "redo my day from here"`
      );
      break;
    }

    case 'unknown':
    default: {
      await reply(
        mutation.message ??
        `I'm not sure how to edit the plan for that. Try:\n• "remove [event] from my plan"\n• "move lunch to 1pm"\n• "wake at 7:30"\n• "push [task] to tomorrow"`
      );
    }
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

  // --- Pending remove event clarification ---
  if (session.state === 'pending_remove_event') {
    const { planDate, candidates } = session;
    if (isNegative(lower) || lower === 'cancel') {
      clearSession(chatId);
      await reply('Got it, nothing removed.');
      return;
    }
    const num = extractPositionalNumber(text);
    if (num !== null && num >= 1 && num <= candidates.length) {
      const ev = candidates[num - 1];
      clearSession(chatId);
      console.log('[bot] day plan: removing event', ev.id, ev.title, 'for', planDate);
      const { agenda, diff } = await regeneratePlanFor(planDate, undefined, { id: ev.id, title: ev.title, start: ev.start });
      await reply(formatPlanReply(`"${ev.title}" removed from plan.`, diff, agenda));
    } else {
      const lines = candidates.map((e, i) => {
        const timeStr = e.start.length > 10 ? e.start.slice(11, 16) : 'all day';
        return `${i + 1}. ${e.title} (${timeStr})`;
      });
      await reply(`Please reply with a number (1–${candidates.length}):\n${lines.join('\n')}`);
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

  // --- Unified intent interpretation ---
  // One LLM call determines what the user wants to do semantically.
  // Dispatch is deterministic from the returned UserIntent type.

  console.log('[bot] [v2] incoming message:', JSON.stringify(text.slice(0, 200)));

  const planDate = /\btomorrow\b/.test(lower) ? getLocalTomorrow() : getLocalToday();

  let ctx: Awaited<ReturnType<typeof buildContextPack>>;
  try {
    ctx = await buildContextPack();
  } catch (ctxErr) {
    console.error('[bot] buildContextPack failed — continuing with empty context:', ctxErr instanceof Error ? ctxErr.message : ctxErr);
    ctx = {
      today: new Date().toISOString().slice(0, 10),
      tomorrow: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      overdue: [], todayTasks: [], tomorrowTasks: [], next7Tasks: [], goals: [],
      todayJournal: null, calendarEvents: [],
    };
  }

  let plan: Awaited<ReturnType<typeof getDayPlanByDate>> | null = null;
  let calendarEventsForPlan: Awaited<ReturnType<typeof getEventsForDate>> = [];
  try {
    plan = await getDayPlanByDate(planDate);
    calendarEventsForPlan = await getEventsForDate(planDate);
  } catch (planErr) {
    console.error('[bot] plan/calendar fetch error:', planErr instanceof Error ? planErr.message : planErr);
  }

  console.log('[bot] interpreting intent for chat', chatId);
  const intent = await interpretUserIntent(
    text, ctx, getHistory(chatId),
    plan?.schedule ?? [], calendarEventsForPlan, planDate, getLocalTomorrow()
  );
  console.log('[bot] [v2] interpreter result:', JSON.stringify(intent));

  switch (intent.type) {
    case 'day_plan_mutation': {
      const mutation = intent.mutation;
      console.log('[bot] [v2] dispatching: day_plan_mutation/', mutation.type);
      const needsSchedule = (
        mutation.type === 'show' ||
        mutation.type === 'remove_event' ||
        mutation.type === 'change_wake_time' ||
        mutation.type === 'move_block' ||
        mutation.type === 'remove_block' ||
        mutation.type === 'regenerate' ||
        mutation.type === 'add_block' ||
        mutation.type === 'rename_block' ||
        mutation.type === 'resize_block'
      );
      if (mutation.type !== 'plan_question' && mutation.type !== 'unknown' && needsSchedule && (!plan || plan.schedule.length === 0)) {
        await reply(`No day plan saved for ${planDate}. Run your daily debrief with a Wake: HH:MM to generate one.`);
        return;
      }
      if (mutation.type === 'unknown') {
        await reply(mutation.message ?? `Not sure what to do with the plan. Try:\n• "show my plan"\n• "redo my day plan"\n• "move lunch to 1pm"\n• "wake at 7:30"\n• "win: <what you finished>"`);
        return;
      }
      await applyDayPlanMutation(planDate, mutation, (plan ?? {}) as NonNullable<typeof plan>, calendarEventsForPlan, reply);
      return;
    }

    case 'answer': {
      console.log('[bot] [v2] dispatching: answer', intent.needs_tool ? `(tool: ${intent.needs_tool})` : '');
      if (intent.needs_tool) {
        console.log('[bot] executing tool:', intent.needs_tool, JSON.stringify(intent.tool_params));
        const toolResult = await executeToolCall(intent.needs_tool, intent.tool_params ?? {});
        await reply(toolResult);
      } else {
        await reply(intent.text);
      }
      return;
    }

    case 'casual':
      console.log('[bot] [v2] dispatching: casual');
      await reply(intent.reply);
      return;

    case 'clarify':
      console.log('[bot] [v2] dispatching: clarify');
      await reply(intent.question);
      return;

    case 'capture':
      console.log('[bot] [v2] dispatching: capture/', intent.capture_type);
      setSession(chatId, {
        state: 'pending_capture',
        captureType: intent.capture_type,
        captureContent: intent.content,
      });
      await reply(`${intent.confirm_question}\n\nReply "yes" to save or "no" to discard.`);
      return;

    case 'app_action': {
      const appIntent = intent.intent;
      console.log('[bot] [v2] dispatching: app_action/', appIntent.intent, 'confidence:', intent.confidence);

      if (intent.confidence === 'low') {
        await reply(intent.follow_up_question ?? 'Could you be more specific?');
        return;
      }

      if (intent.confirm_needed) {
        setSession(chatId, { state: 'pending_confirmation', pendingIntent: appIntent });
        await reply(`${intent.user_facing_summary}\n\nReply "yes" to confirm or "no" to cancel.`);
        return;
      }

      // Resolve single positional task reference from the last shown task list
      if (appIntent.intent === 'complete_task' || appIntent.intent === 'move_task_date') {
        const pos = extractPositionalNumber(text);
        if (pos !== null) {
          const ref = getLastTaskList(chatId);
          if (ref && pos >= 1 && pos <= ref.taskIds.length) {
            console.log('[bot] resolving position', pos, 'from last task list scope:', ref.scope);
            appIntent.data.task_id = ref.taskIds[pos - 1];
            delete (appIntent.data as Record<string, unknown>).task_title;
          } else if (!ref) {
            await reply('Could you be more specific? Try showing your tasks first (e.g. "show tasks"), then tell me which one to complete.');
            return;
          }
        }
      }

      // Resolve bulk positional refs
      if (appIntent.intent === 'complete_tasks_bulk' || appIntent.intent === 'move_tasks_bulk') {
        const bulkData = appIntent.data as Record<string, unknown>;
        const positions = bulkData.positions as number[] | undefined;
        if (positions && positions.length > 0) {
          const ref = getLastTaskList(chatId);
          if (!ref) {
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

      // Resolve idea positional refs
      if (appIntent.intent === 'set_idea_next_step' || appIntent.intent === 'promote_idea_to_project') {
        const d = appIntent.data as Record<string, unknown>;
        if (d.position && typeof d.position === 'number') {
          const ref = getLastIdeaList(chatId);
          if (!ref) {
            await reply('Show your ideas first (e.g. "show ideas"), then reference them by number.');
            return;
          }
          const pos = d.position as number;
          if (pos >= 1 && pos <= ref.ideaIds.length) {
            d.idea_id = ref.ideaIds[pos - 1];
            delete d.position;
          }
        }
      }

      console.log('[bot] executing intent:', appIntent.intent);

      if (appIntent.intent === 'daily_debrief') {
        await startDebrief(chatId, reply);
      } else if (appIntent.intent === 'weekly_review') {
        await handleReviewCommand(chatId, reply);
      } else {
        let result: Awaited<ReturnType<typeof executeIntent>>;
        try {
          result = await executeIntent(appIntent);
        } catch (execErr) {
          const execMsg = execErr instanceof Error ? execErr.message : String(execErr);
          console.error('[bot] executeIntent threw for', appIntent.intent, ':', execMsg);
          await reply(`Couldn't complete that — ${execMsg.slice(0, 80)}. Please try again.`);
          return;
        }

        if (
          appIntent.intent === 'list_tasks' &&
          result.success && result.data && typeof result.data === 'object' && 'taskIds' in result.data
        ) {
          const { taskIds, scope } = result.data as { taskIds: string[]; scope: string };
          setLastTaskList(chatId, scope ?? 'today', taskIds);
          console.log('[bot] stored task list ref: scope=', scope, 'count=', taskIds.length);
        }

        if (
          appIntent.intent === 'list_ideas' &&
          result.success && result.data && typeof result.data === 'object' && 'ideaIds' in result.data
        ) {
          const { ideaIds } = result.data as { ideaIds: string[] };
          setLastIdeaList(chatId, ideaIds);
          console.log('[bot] stored idea list ref: count=', ideaIds.length);
        }

        await reply(result.message);
      }
      return;
    }
  }
}

async function startDebrief(chatId: number, reply: (msg: string) => Promise<unknown>) {
  const { debriefDate, planDate } = determineDebriefDates();

  const tasks = await getTasksDueOnOrBefore(planDate, 30);

  // Fetch planned intentions and already-logged wins to include in the prompt
  const [plannedIntentions, existingWins] = await Promise.all([
    getDayPlanByDate(planDate),
    getWinsForDate(debriefDate),
  ]);

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

  const intentionLines: string[] = [];
  if (plannedIntentions?.planned_mit) intentionLines.push(`Pre-set MIT: ${plannedIntentions.planned_mit}`);
  if (plannedIntentions?.planned_k1)  intentionLines.push(`Pre-set K1:  ${plannedIntentions.planned_k1}`);
  if (plannedIntentions?.planned_k2)  intentionLines.push(`Pre-set K2:  ${plannedIntentions.planned_k2}`);
  const intentionSection = intentionLines.length ? `\nPre-planned focus (can override):\n${intentionLines.join('\n')}\n` : '';

  const winsSection = existingWins.length
    ? `\nWins already logged today:\n${existingWins.map((w) => `• ${w.content}`).join('\n')}\n`
    : '';

  await reply(
    `Daily Debrief\nDebriefing: ${fmtDate(debriefDate)}\nPlanning: ${fmtDate(planDate)}\n\nOpen tasks:\n${taskSummary}\n${intentionSection}${winsSection}\nReply with your wake time, MIT, K1, K2, reflections, and wins.\nExample:\nWake: 07:00\nMIT: Finish proposal\nK1: Review PR\nK2: Email client\nJournal: Good focus day\nWins: Shipped feature, hit inbox zero\n\nInclude "Wake: HH:MM" to get a generated day plan.\nSend "cancel" to exit.`
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
      await ctx.reply(formatAgendaForBot(plan.schedule, plan.overflow, today, plan));
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
