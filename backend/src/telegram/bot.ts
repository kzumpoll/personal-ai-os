import { Telegraf, Markup } from 'telegraf';
import { Express } from 'express';
import { buildContextPack, determineDebriefDates } from '../ai/context';
import {
  interpretUserIntent,
  interpretImageMessage,
  classifyImageIntent,
  interpretDebriefReply,
  confirmDebriefSummary,
  applyDebriefCorrection,
  interpretCheckinReply,
  formatCheckinSummary,
  generateWithinProposal,
  applyWithinCorrection,
  formatWithinProposal,
  WithinProposal,
  WithinContext,
  DayPlanMutation,
} from '../ai/claude';
import {
  fetchWithinTasks,
  addCommentToTask,
  updateTaskDueDate,
  createWithinTask,
  isWithinConfigured,
  discoverWithinUserIds,
} from '../services/withinNotion';
import { captureToIntent, type Intent } from '../ai/intents';
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
  setLastTaskRef,
  setLastCalendarEventRef,
  setLastReminderRef,
  getEntityRefs,
} from './session';
import { getFilePath, downloadVoiceNote, transcribeAudio } from './voice';
import { editImage, isImageEditConfigured } from '../services/imageEdit';
import { schedulerEvents, CheckinPromptEvent } from '../services/scheduler';
import { createReview } from '../db/queries/reviews';
import { getTasksDueOnOrBefore, getTasksForDate, getOverdueTasks } from '../db/queries/tasks';
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

// Registry for edited images that need to be sent as photos after handleText returns.
// handleText only has access to a text-reply function, so edited image buffers are
// stored here and sent by the bot.on('text') caller.
interface PendingImageReply {
  imageBuffer: Buffer;
  mimeType: string;
  description: string | null;
}
const pendingImageReplies = new Map<number, PendingImageReply>();

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

  const [journal, calendarEvents, todayTasks, overdueTasks] = await Promise.all([
    getJournalByDate(planDate),
    getEventsForDate(planDate),
    getTasksForDate(planDate, 15),
    getOverdueTasks(10),
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

  // Build task candidates: overdue first (most urgent), then today's tasks.
  // Deduplicate by title and exclude MIT/P1/P2 (already in focus blocks).
  const focusTitles = new Set([journal?.mit, journal?.p1, journal?.p2].filter(Boolean));
  const seen = new Set<string>();
  const otherTasks = [...overdueTasks, ...todayTasks]
    .filter((t) => {
      if (focusTitles.has(t.title) || seen.has(t.title)) return false;
      seen.add(t.title);
      return true;
    })
    .map((t) => t.title);

  const { schedule, overflow, work_start } = generateDayPlan({
    wakeTime,
    calendarEvents,
    mit: journal?.mit ?? undefined,
    p1: journal?.p1 ?? undefined,
    p2: journal?.p2 ?? undefined,
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

/**
 * After a calendar create/update/delete, check if the affected date is today or tomorrow.
 * If so, regenerate the day plan to reflect the change.
 */
async function maybeRegeneratePlanAfterCalendarChange(
  data: { affectsDate: string },
  reply: (msg: string) => Promise<unknown>
): Promise<void> {
  const today = getLocalToday();
  const tomorrow = getLocalTomorrow();
  const affectedDate = data.affectsDate;

  if (affectedDate !== today && affectedDate !== tomorrow) return;

  const existing = await getDayPlanByDate(affectedDate);
  if (!existing || !existing.wake_time) return; // No plan to regenerate

  try {
    const { agenda, diff } = await regeneratePlanFor(affectedDate);
    if (diff) {
      await reply(`Day plan updated:\n${diff}`);
    }
  } catch (err) {
    console.error('[bot] day plan regeneration after calendar change failed:', err instanceof Error ? err.message : err);
  }
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

    case 'complete_p1': {
      await setFocusCompletion(planDate, 'p1_done', true);
      const p = plan as Awaited<ReturnType<typeof getDayPlanByDate>>;
      const updated = p ? { ...p, p1_done: true } : undefined;
      const agenda = p ? formatAgendaForBot(p.schedule, p.overflow, planDate, updated) : undefined;
      await reply(agenda ? `P1 marked done ✅\n\n${agenda}` : 'P1 marked done ✅');
      break;
    }

    case 'complete_p2': {
      await setFocusCompletion(planDate, 'p2_done', true);
      const p = plan as Awaited<ReturnType<typeof getDayPlanByDate>>;
      const updated = p ? { ...p, p2_done: true } : undefined;
      const agenda = p ? formatAgendaForBot(p.schedule, p.overflow, planDate, updated) : undefined;
      await reply(agenda ? `P2 marked done ✅\n\n${agenda}` : 'P2 marked done ✅');
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

    case 'set_p1': {
      const value = mutation.p1_value ?? '';
      const targetDate = mutation.target_date ?? planDate;
      if (!value) {
        await reply('What should P1 be?');
        return;
      }
      await setDayPlanIntentions(targetDate, { planned_p1: value });
      await reply(`P1 for ${targetDate} set: "${value}"`);
      break;
    }

    case 'set_p2': {
      const value = mutation.p2_value ?? '';
      const targetDate = mutation.target_date ?? planDate;
      if (!value) {
        await reply('What should P2 be?');
        return;
      }
      await setDayPlanIntentions(targetDate, { planned_p2: value });
      await reply(`P2 for ${targetDate} set: "${value}"`);
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
  const session = await getSession(chatId);
  console.log('[bot] handleText chat:', chatId, 'session:', session.state, 'text:', text.slice(0, 80));
  const lower = text.toLowerCase().trim();

  // --- Pending capture confirmation (idea/thought/win/goal/resource) ---
  if (session.state === 'pending_capture') {
    if (isAffirmative(lower)) {
      const intent = captureToIntent(session.captureType, session.captureContent);
      await clearSession(chatId);
      console.log('[bot] pending_capture confirmed → executing', intent.intent);
      try {
        const result = await executeIntent(intent);
        await reply(result.message);
      } catch (e) {
        console.error('[bot] pending_capture executeIntent threw:', e instanceof Error ? e.message : e);
        await reply("Couldn't save that — please try again.");
      }
    } else if (isNegative(lower)) {
      await clearSession(chatId);
      await reply('Got it, not saved.');
    } else {
      // Unrelated message — discard pending capture and handle as fresh message
      await clearSession(chatId);
      return await handleText(chatId, text, rawReply);
    }
    return;
  }

  // --- Pending remove event clarification ---
  if (session.state === 'pending_remove_event') {
    const { planDate, candidates } = session;
    if (isNegative(lower) || lower === 'cancel') {
      await clearSession(chatId);
      await reply('Got it, nothing removed.');
      return;
    }
    const num = extractPositionalNumber(text);
    if (num !== null && num >= 1 && num <= candidates.length) {
      const ev = candidates[num - 1];
      await clearSession(chatId);
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

  // --- Pending calendar disambiguation (update/delete with multiple matches) ---
  if (session.state === 'pending_calendar_disambiguation') {
    const { action, pendingIntent, candidates } = session;
    if (isNegative(lower) || lower === 'cancel') {
      await clearSession(chatId);
      await reply('Got it, no calendar change made.');
      return;
    }
    const num = extractPositionalNumber(text);
    if (num !== null && num >= 1 && num <= candidates.length) {
      const chosen = candidates[num - 1];
      await clearSession(chatId);
      console.log('[bot] calendar disambiguation: chose', chosen.id, chosen.title, 'for', action);

      // Patch the pending intent with the resolved event_id
      if (pendingIntent.intent === 'calendar_update_event') {
        pendingIntent.data.event_id = chosen.id;
        pendingIntent.data.search_date = chosen.start.slice(0, 10);
      } else if (pendingIntent.intent === 'calendar_delete_event') {
        pendingIntent.data.event_id = chosen.id;
        pendingIntent.data.search_date = chosen.start.slice(0, 10);
      }

      const result = await executeIntent(pendingIntent);
      await reply(result.message);

      // Regenerate day plan if the calendar change affects today/tomorrow
      if (result.success && result.data && typeof result.data === 'object' && 'affectsDate' in result.data) {
        await maybeRegeneratePlanAfterCalendarChange(result.data as { affectsDate: string }, reply);
      }
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
      await clearSession(chatId);
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
      await clearSession(chatId);
      await reply('Got it, no action taken.');
    } else {
      // Unrelated message — discard and re-route
      await clearSession(chatId);
      return await handleText(chatId, text, rawReply);
    }
    return;
  }

  // --- Debrief: awaiting user input ---
  if (session.state === 'debrief_awaiting_input') {
    // Allow explicit cancel before trying to interpret the message as debrief content
    if (isNegative(lower) || lower === 'cancel' || lower === 'exit' || lower === 'quit') {
      await clearSession(chatId);
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

    // interpretDebriefReply now always returns save_debrief (even partial).
    // If somehow it doesn't, show what we got and let the user correct.
    if (intent.intent !== 'save_debrief') {
      console.warn('[bot] debrief interpretation returned non-save_debrief:', intent.intent);
      // Wrap the raw text as a minimal debrief so user can correct
      const fallbackIntent: Intent = {
        intent: 'save_debrief',
        data: {
          entry_date: planDate,
          debrief_date: debriefDate,
          open_journal: text.slice(0, 2000),
        },
      } as Intent;
      const summary = await confirmDebriefSummary(fallbackIntent, debriefTasks);
      await setSession(chatId, { state: 'debrief_awaiting_confirmation', debriefDate, planDate, pendingIntent: fallbackIntent, tasks: debriefTasks });
      await reply('I could only partially interpret that. Here\'s what I got — correct anything that\'s wrong:\n\n' + summary);
      return;
    }

    const summary = await confirmDebriefSummary(intent, debriefTasks);
    await setSession(chatId, { state: 'debrief_awaiting_confirmation', debriefDate, planDate, pendingIntent: intent, tasks: debriefTasks });
    await reply(summary);
    return;
  }

  // --- Debrief: awaiting confirmation (with inline correction support) ---
  if (session.state === 'debrief_awaiting_confirmation') {
    if (lower === 'yes' || lower === 'y' || lower === 'confirm') {
      console.log('[bot] debrief_awaiting_confirmation confirmed → executing save_debrief');
      try {
        const result = await executeIntent(session.pendingIntent);
        await clearSession(chatId);
        await reply(result.message);
      } catch (err) {
        await clearSession(chatId);
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[bot] debrief confirm error:', msg);
        await reply('Something went wrong saving the debrief. Please try /debrief again.');
      }
    } else if (isNegative(lower)) {
      await clearSession(chatId);
      console.log('[bot] debrief_awaiting_confirmation cancelled/denied');
      await reply('Got it, debrief not saved.');
    } else {
      // Treat as a correction to the draft — ALWAYS stay in this session state
      console.log('[bot] debrief_awaiting_confirmation — applying correction:', text.slice(0, 120));
      const currentData = (session.pendingIntent.intent === 'save_debrief' ? session.pendingIntent.data : {}) as Record<string, unknown>;
      const tasks = session.tasks;

      let correctionResult: Awaited<ReturnType<typeof applyDebriefCorrection>>;
      try {
        correctionResult = await applyDebriefCorrection(currentData, text, tasks);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('[bot] debrief correction threw:', errMsg);
        // Stay in session — do NOT fall through to generic handler
        await reply(`Correction failed (${errMsg.slice(0, 60)}). Try rephrasing, or say "confirm" to save as-is.`);
        return;
      }

      if (!correctionResult) {
        // Stay in session
        await reply("Something went wrong applying that correction. Try rephrasing, or say \"confirm\" to save as-is.");
        return;
      }

      const { intent: updatedIntent, clarification } = correctionResult;
      const newSummary = await confirmDebriefSummary(updatedIntent, tasks);
      await setSession(chatId, {
        state: 'debrief_awaiting_confirmation',
        debriefDate: session.debriefDate,
        planDate: session.planDate,
        pendingIntent: updatedIntent,
        tasks,
      });

      if (clarification) {
        await reply(`Updated (but I have a question):\n\n${newSummary}\n\n${clarification}`);
      } else {
        await reply(`Updated:\n\n${newSummary}`);
      }
    }
    return;
  }

  // --- Check-in: awaiting freeform input ---
  if (session.state === 'checkin_awaiting_input') {
    if (isNegative(lower) || lower === 'cancel') {
      await clearSession(chatId);
      await reply('Check-in cancelled.');
      return;
    }
    const { weekLabel, periodStart, periodEnd } = session;
    console.log('[bot] checkin_awaiting_input → parsing reply for', weekLabel);
    const checkinData = await interpretCheckinReply(text);
    const summary = formatCheckinSummary(checkinData, weekLabel);
    await setSession(chatId, {
      state: 'checkin_awaiting_confirmation',
      weekLabel,
      periodStart,
      periodEnd,
      checkinData,
    });
    await reply(summary);
    return;
  }

  // --- Check-in: awaiting confirmation (with correction support) ---
  if (session.state === 'checkin_awaiting_confirmation') {
    const { weekLabel, periodStart, periodEnd, checkinData } = session;

    if (lower === 'yes' || lower === 'y' || lower === 'confirm') {
      console.log('[bot] checkin_awaiting_confirmation confirmed → saving');
      try {
        await createReview({
          review_type: 'weekly_checkin',
          period_start: periodStart,
          period_end: periodEnd,
          content: {
            ...checkinData,
            week_label: weekLabel,
            captured_at: new Date().toISOString(),
          },
        });
        await clearSession(chatId);
        await reply(`Check-in saved ✓ Good work reflecting on your week.${checkinData.suggested_tasks?.length ? `\n\nSuggested tasks to consider:\n${checkinData.suggested_tasks.map((t) => `• ${t}`).join('\n')}` : ''}`);
      } catch (err) {
        await clearSession(chatId);
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[bot] checkin save error:', msg);
        await reply('Something went wrong saving the check-in. Please try again.');
      }
    } else if (isNegative(lower)) {
      await clearSession(chatId);
      await reply('Check-in discarded.');
    } else {
      // Correction: re-parse with the original reply + correction appended
      const corrected = await interpretCheckinReply(`${text}`);
      const merged = { ...checkinData, ...Object.fromEntries(Object.entries(corrected).filter(([, v]) => v !== null && !(Array.isArray(v) && v.length === 0))) };
      const newSummary = formatCheckinSummary(merged as typeof checkinData, weekLabel);
      await setSession(chatId, {
        state: 'checkin_awaiting_confirmation',
        weekLabel,
        periodStart,
        periodEnd,
        checkinData: merged as typeof checkinData,
      });
      await reply(`Updated ✓\n\n${newSummary}`);
    }
    return;
  }

  // --- Image: awaiting prompt (editing or understanding) ---
  if (session.state === 'image_awaiting_prompt') {
    if (isNegative(lower) || lower === 'cancel') {
      await clearSession(chatId);
      await reply('Cancelled.');
      return;
    }
    const { imageBuffer, imageMimeType } = session;
    await clearSession(chatId);

    const imgIntent = classifyImageIntent(text);
    console.log('[bot] image_awaiting_prompt: classified as', imgIntent);

    if (imgIntent === 'understand') {
      // Route to Claude vision for understanding / extraction
      const base64 = imageBuffer.toString('base64');
      const planDate = getLocalToday();
      const tomorrowDate = getLocalTomorrow();
      const interpreted = await interpretImageMessage(base64, imageMimeType, text, planDate, tomorrowDate);
      console.log('[bot] [CAL v2] image understanding result:', JSON.stringify(interpreted).slice(0, 300));

      if (interpreted.type === 'app_action') {
        if (interpreted.confidence === 'low') {
          await reply(interpreted.follow_up_question ?? 'Could you be more specific?');
          return;
        }
        if (interpreted.confirm_needed) {
          await setSession(chatId, { state: 'pending_confirmation', pendingIntent: interpreted.intent });
          await reply(`${interpreted.user_facing_summary}\n\nReply "yes" to confirm or "no" to cancel.`);
          return;
        }
        const result = await executeIntent(interpreted.intent);
        await reply(result.message);

        if (result.success && result.data && typeof result.data === 'object') {
          if ('affectsDate' in result.data) {
            await maybeRegeneratePlanAfterCalendarChange(result.data as { affectsDate: string }, reply);
          }
          if ('affectsDates' in result.data) {
            const dates = [...new Set((result.data as { affectsDates: string[] }).affectsDates)];
            for (const d of dates) {
              await maybeRegeneratePlanAfterCalendarChange({ affectsDate: d }, reply);
            }
          }
        }
      } else if (interpreted.type === 'answer') {
        await reply(interpreted.text);
      } else if (interpreted.type === 'clarify') {
        await reply(interpreted.question);
      } else if (interpreted.type === 'casual') {
        await reply(interpreted.reply);
      }
    } else {
      // Route to image editing
      if (!isImageEditConfigured()) {
        await reply('Image editing is not configured. Ask the admin to set GOOGLE_AI_API_KEY.');
        return;
      }
      await reply('Editing image...');
      try {
        const result = await editImage(imageBuffer, imageMimeType, text);
        pendingImageReplies.set(chatId, result);
        if (result.description) await reply(result.description);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await reply(`Image edit failed — ${msg.slice(0, 80)}`);
      }
    }
    return;
  }

  // --- Within Notion: awaiting confirmation (with correction support) ---
  if (session.state === 'within_review_awaiting_confirmation') {
    const { proposal, stats } = session;

    if (isAffirmative(lower)) {
      await clearSession(chatId);
      console.log('[bot] within_review confirmed → executing proposal');
      await reply('Updating Within Notion...');
      await executeWithinProposal(proposal, reply);
      return;
    }

    if (isNegative(lower) || lower === 'cancel') {
      await clearSession(chatId);
      await reply('Within update cancelled — nothing changed.');
      return;
    }

    // Treat as correction
    console.log('[bot] within_review — applying correction:', text.slice(0, 80));
    const updatedProposal = await applyWithinCorrection(proposal, text);
    await setSession(chatId, { state: 'within_review_awaiting_confirmation', proposal: updatedProposal, stats });
    await reply(`Updated ✓\n\n${formatWithinProposal(updatedProposal, stats)}`);
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

  // Deterministic plan query — skip LLM if we can answer from schedule blocks
  if (plan?.schedule && plan.schedule.length > 0) {
    const { querySchedule } = await import('../services/dayplan');
    const directAnswer = querySchedule(text, plan.schedule);
    if (directAnswer) {
      console.log('[bot] deterministic plan query — answered without LLM');
      addToHistory(chatId, 'user', text);
      addToHistory(chatId, 'bot', directAnswer);
      await reply(directAnswer);
      return;
    }
  }

  console.log('[bot] interpreting intent for chat', chatId);
  const refs = getEntityRefs(chatId);
  const intent = await interpretUserIntent(
    text, ctx, getHistory(chatId),
    plan?.schedule ?? [], calendarEventsForPlan, planDate, getLocalTomorrow(),
    refs
  );
  console.log('[bot] [v2] interpreter result:', intent.type, intent.type === 'app_action' ? intent.intent.intent : '');

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
      // Guardrail: block the LLM from claiming it can't access Google Calendar
      const answerText = intent.text ?? '';
      if (/can'?t.*(create|access|modify|add|schedule).*(calendar|event)/i.test(answerText) ||
          /no.*(access|ability).*(calendar|event)/i.test(answerText)) {
        console.warn('[bot] [CAL v2] BLOCKED answer claiming no calendar access:', answerText);
        await reply('[CAL v2] I can create calendar events for you. Try: "add [event] [date] [time]"');
        return;
      }
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

    case 'clarify': {
      console.log('[bot] [v2] dispatching: clarify');
      if (intent.options && intent.options.length > 0) {
        const buttons = intent.options.map((opt: string) =>
          Markup.button.callback(opt, `clarify_opt:${opt.slice(0, 40)}`)
        );
        addToHistory(chatId, 'bot', intent.question);
        await bot.telegram.sendMessage(
          chatId,
          intent.question,
          Markup.inlineKeyboard([buttons])
        );
      } else {
        await reply(intent.question);
      }
      return;
    }

    case 'capture': {
      console.log('[bot] [v2] dispatching: capture/', intent.capture_type);
      // Guardrail: if this looks like a calendar event, don't capture it as a resource
      const captureText = intent.content?.toLowerCase() ?? '';
      const looksLikeEvent =
        /\b(\d{1,2}:\d{2}|\d{1,2}\s*(am|pm)|at\s+\d|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(captureText) &&
        /\b(padel|lunch|dinner|meeting|call|session|appointment|event|brunch|coffee|drinks)\b/i.test(captureText);
      if (intent.capture_type === 'resource' && looksLikeEvent) {
        console.warn('[bot] [CAL v2] BLOCKED resource capture for calendar-like content:', captureText);
        await reply('[CAL v2] This looks like a calendar event. Try: "add ' + (intent.content?.slice(0, 40) ?? 'event') + ' to my calendar"');
        return;
      }
      await setSession(chatId, {
        state: 'pending_capture',
        captureType: intent.capture_type,
        captureContent: intent.content,
      });
      await reply(`${intent.confirm_question}\n\nReply "yes" to save or "no" to discard.`);
      return;
    }

    case 'app_action': {
      const appIntent = intent.intent;
      console.log('[bot] [v2] dispatching: app_action/', appIntent.intent, 'confidence:', intent.confidence);

      if (intent.confidence === 'low') {
        await reply(intent.follow_up_question ?? 'Could you be more specific?');
        return;
      }

      if (intent.confirm_needed) {
        await setSession(chatId, { state: 'pending_confirmation', pendingIntent: appIntent });
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
      } else if (appIntent.intent === 'within_review') {
        await startWithinReview(chatId, reply);
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

        // Calendar disambiguation: executor returned multiple matches
        if (
          !result.success &&
          result.data && typeof result.data === 'object' && 'disambiguation' in result.data &&
          (appIntent.intent === 'calendar_update_event' || appIntent.intent === 'calendar_delete_event')
        ) {
          const candidates = (result.data as { disambiguation: Array<{ id: string; title: string; start: string; end: string; allDay: boolean }> }).disambiguation;
          await setSession(chatId, {
            state: 'pending_calendar_disambiguation',
            action: appIntent.intent === 'calendar_update_event' ? 'update' : 'delete',
            pendingIntent: appIntent,
            candidates,
          });
          await reply(result.message + '\n\nReply with a number or "cancel".');
          return;
        }

        await reply(result.message);

        // Track entity references for follow-up resolution ("that one", "yeah that")
        if (result.success && result.data && typeof result.data === 'object') {
          const d = result.data as Record<string, unknown>;
          if (d._entity === 'task' || appIntent.intent === 'create_task' || appIntent.intent === 'complete_task' || appIntent.intent === 'update_task_description') {
            if (d.id && d.title) setLastTaskRef(chatId, { id: String(d.id), title: String(d.title) });
          }
          if (d._entity === 'reminder' || appIntent.intent === 'create_reminder') {
            if (d.id && d.title) setLastReminderRef(chatId, { id: String(d.id), title: String(d.title), fire_at: String(d.scheduled_at ?? '') });
          }
          if (appIntent.intent === 'calendar_create_event' || appIntent.intent === 'calendar_update_event') {
            if (d.id && d.title) setLastCalendarEventRef(chatId, { id: String(d.id), title: String(d.title), start: String(d.start ?? '') });
          }
        }

        // After calendar mutations, regenerate the day plan if affected date is today/tomorrow
        if (
          result.success &&
          result.data && typeof result.data === 'object' && 'affectsDate' in result.data &&
          (appIntent.intent === 'calendar_create_event' || appIntent.intent === 'calendar_update_event' || appIntent.intent === 'calendar_delete_event')
        ) {
          await maybeRegeneratePlanAfterCalendarChange(result.data as { affectsDate: string }, reply);
        }
        // Bulk calendar creation — check all affected dates
        if (
          result.success &&
          result.data && typeof result.data === 'object' && 'affectsDates' in result.data &&
          appIntent.intent === 'calendar_create_events_bulk'
        ) {
          const dates = (result.data as { affectsDates: string[] }).affectsDates;
          const uniqueDates = [...new Set(dates)];
          for (const d of uniqueDates) {
            await maybeRegeneratePlanAfterCalendarChange({ affectsDate: d }, reply);
          }
        }
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

  await setSession(chatId, {
    state: 'debrief_awaiting_input',
    debriefDate,
    planDate,
    taskSummary,
    tasks: sessionTasks,
  });

  const intentionLines: string[] = [];
  if (plannedIntentions?.planned_mit) intentionLines.push(`Pre-set MIT: ${plannedIntentions.planned_mit}`);
  if (plannedIntentions?.planned_p1)  intentionLines.push(`Pre-set P1:  ${plannedIntentions.planned_p1}`);
  if (plannedIntentions?.planned_p2)  intentionLines.push(`Pre-set P2:  ${plannedIntentions.planned_p2}`);
  const intentionSection = intentionLines.length ? `\nPre-planned focus (can override):\n${intentionLines.join('\n')}\n` : '';

  const winsSection = existingWins.length
    ? `\nWins already logged today:\n${existingWins.map((w) => `• ${w.content}`).join('\n')}\n`
    : '';

  await reply(
    `Daily Debrief\nDebriefing: ${fmtDate(debriefDate)}\nPlanning: ${fmtDate(planDate)}\n\nOpen tasks:\n${taskSummary}\n${intentionSection}${winsSection}\nReply with your wake time, MIT, P1, P2, reflections, and wins.\nExample:\nWake: 07:00\nMIT: Finish proposal\nP1: Review PR\nP2: Email client\nJournal: Good focus day\nWins: Shipped feature, hit inbox zero\n\nInclude "Wake: HH:MM" to get a generated day plan.\nSend "cancel" to exit.`
  );
}

async function startWithinReview(chatId: number, reply: (msg: string) => Promise<unknown>) {
  if (!isWithinConfigured()) {
    await reply('Within Notion is not configured — NOTION_TOKEN is missing. Ask the admin to set it.');
    return;
  }

  // If NOTION_USER_ID is missing, discover person IDs from page property data
  // so the user knows which UUID to set — no /v1/users needed.
  if (!process.env.NOTION_USER_ID) {
    await reply('NOTION_USER_ID is not set. Scanning Within tasks to find assignee IDs...');
    try {
      const people = await discoverWithinUserIds();
      if (people.length === 0) {
        await reply(
          'No assigned people found in the first 20 Within tasks.\n\n' +
          'Make sure some tasks are assigned to people in the database, then try again.\n\n' +
          'Once you know your Notion user ID, set NOTION_USER_ID as a Railway env var and restart.'
        );
      } else {
        const lines = people.map((p) => `• ${p.name}${p.email ? ` (${p.email})` : ''}\n  ID: ${p.id}`).join('\n\n');
        await reply(
          `Found these people assigned to tasks in Within:\n\n${lines}\n\n` +
          `Set NOTION_USER_ID to your ID as a Railway env var, then trigger /within again.\n\n` +
          `(The /v1/users endpoint requires a "Read user information" capability that most integrations don't have — these IDs come directly from task assignee data instead.)`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await reply(`Couldn't scan Within assignees — ${msg.slice(0, 120)}`);
    }
    return;
  }

  await reply('Fetching Within tasks...');

  let withinResult: Awaited<ReturnType<typeof fetchWithinTasks>>;
  try {
    withinResult = await fetchWithinTasks();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[bot] Within: fetchWithinTasks failed:', msg);
    await reply(`Couldn't fetch Within tasks — ${msg.slice(0, 80)}`);
    return;
  }

  const today = getLocalToday();

  // Build personal OS context
  const [wins, journal, overdueTasks, todayTasks] = await Promise.all([
    getWinsForDate(today).catch(() => [] as { content: string }[]),
    getJournalByDate(today).catch(() => null),
    getOverdueTasks(15).catch(() => [] as { title: string; due_date: string | null }[]),
    getTasksForDate(today, 15).catch(() => [] as { title: string; due_date: string | null }[]),
  ]);

  const ctx: WithinContext = {
    today,
    wins: wins.map((w) => w.content),
    journal_mit: journal?.mit ?? null,
    journal_p1: journal?.p1 ?? null,
    journal_p2: journal?.p2 ?? null,
    journal_notes: journal?.open_journal ?? null,
    personal_tasks: [
      ...overdueTasks.map((t) => ({ title: t.title, due_date: t.due_date })),
      ...todayTasks.map((t) => ({ title: t.title, due_date: t.due_date })),
    ],
  };

  let proposal: WithinProposal;
  try {
    proposal = await generateWithinProposal(withinResult, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[bot] Within: generateWithinProposal failed:', msg);
    await reply(`Couldn't generate proposal — ${msg.slice(0, 80)}`);
    return;
  }

  const stats = {
    total: withinResult.tasks.length,
    overdue: withinResult.overdue.length,
    due_today: withinResult.due_today.length,
    due_soon: withinResult.due_soon.length,
  };

  await setSession(chatId, { state: 'within_review_awaiting_confirmation', proposal, stats });
  await reply(formatWithinProposal(proposal, stats));
}

async function executeWithinProposal(proposal: WithinProposal, reply: (msg: string) => Promise<unknown>) {
  const results: string[] = [];
  let errors = 0;

  for (const change of proposal.date_changes) {
    try {
      await updateTaskDueDate(change.task_id, change.new_due_date!);
      results.push(`✓ "${change.task_title}" → ${change.new_due_date}`);
    } catch (err) {
      errors++;
      console.error('[bot] Within: date change failed for', change.task_id, err instanceof Error ? err.message : err);
    }
  }

  for (const comment of proposal.comments) {
    try {
      await addCommentToTask(comment.task_id, comment.comment!);
      results.push(`✓ Comment added to "${comment.task_title}"`);
    } catch (err) {
      errors++;
      console.error('[bot] Within: comment failed for', comment.task_id, err instanceof Error ? err.message : err);
    }
  }

  for (const newTask of proposal.new_tasks) {
    try {
      const created = await createWithinTask(newTask.title, newTask.due_date);
      results.push(`✓ Created "${created.title}"`);
    } catch (err) {
      errors++;
      console.error('[bot] Within: create task failed for', newTask.title, err instanceof Error ? err.message : err);
    }
  }

  if (results.length === 0 && errors === 0) {
    await reply('Nothing to execute — proposal was empty.');
  } else {
    const errNote = errors ? `\n\n⚠️ ${errors} change(s) failed — check logs.` : '';
    await reply(`Within Notion updated ✓\n\n${results.join('\n')}${errNote}`);
  }
}

// Handle text messages
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text;

  try {
    await handleText(chatId, text, (msg) => ctx.reply(msg));

    // Send any pending edited image produced by the image_awaiting_prompt flow
    const pending = pendingImageReplies.get(chatId);
    if (pending) {
      pendingImageReplies.delete(chatId);
      await ctx.replyWithPhoto({ source: pending.imageBuffer });
    }
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

// Handle photo messages — image editing OR image understanding
bot.on('photo', async (ctx) => {
  const chatId = ctx.chat.id;

  try {
    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1];
    const caption = ctx.message.caption?.trim();

    const fileUrl = await getFilePath(process.env.TELEGRAM_BOT_TOKEN!, photo.file_id);
    const imageBuffer = await downloadVoiceNote(fileUrl);
    const mimeType = 'image/jpeg';

    // Determine intent: editing vs understanding
    const imageIntent = caption ? classifyImageIntent(caption) : 'no_caption';
    console.log('[bot] photo handler: intent=', imageIntent, 'caption=', caption?.slice(0, 60));

    if (imageIntent === 'edit') {
      // --- Image editing path (Gemini) ---
      if (!isImageEditConfigured()) {
        await ctx.reply('Image editing is not configured. Ask the admin to set GOOGLE_AI_API_KEY.');
        return;
      }
      await ctx.reply('Editing image...');
      const result = await editImage(imageBuffer, mimeType, caption!);
      if (result.description) await ctx.reply(result.description);
      await ctx.replyWithPhoto({ source: result.imageBuffer });

    } else if (imageIntent === 'understand') {
      // --- Image understanding path (Claude vision) ---
      console.log('[bot] [CAL v2] routing to image understanding via Claude vision');
      const base64 = imageBuffer.toString('base64');
      const planDate = getLocalToday();
      const tomorrowDate = getLocalTomorrow();

      const intent = await interpretImageMessage(base64, mimeType, caption!, planDate, tomorrowDate);
      console.log('[bot] [CAL v2] image interpretation result:', JSON.stringify(intent).slice(0, 300));

      // Route the interpreted intent through the same dispatch as text messages
      if (intent.type === 'app_action') {
        const appIntent = intent.intent;
        console.log('[bot] [CAL v2] image → app_action/', appIntent.intent, 'confidence:', intent.confidence);

        if (intent.confidence === 'low') {
          await ctx.reply(intent.follow_up_question ?? 'Could you be more specific about what you want from this image?');
          return;
        }

        if (intent.confirm_needed) {
          await setSession(chatId, { state: 'pending_confirmation', pendingIntent: appIntent });
          await ctx.reply(`${intent.user_facing_summary}\n\nReply "yes" to confirm or "no" to cancel.`);
          return;
        }

        const result = await executeIntent(appIntent);
        await ctx.reply(result.message);

        // Day plan regeneration for calendar mutations
        if (result.success && result.data && typeof result.data === 'object') {
          if ('affectsDate' in result.data) {
            await maybeRegeneratePlanAfterCalendarChange(
              result.data as { affectsDate: string },
              (msg: string) => ctx.reply(msg) as unknown as Promise<unknown>,
            );
          }
          if ('affectsDates' in result.data) {
            const dates = [...new Set((result.data as { affectsDates: string[] }).affectsDates)];
            for (const d of dates) {
              await maybeRegeneratePlanAfterCalendarChange(
                { affectsDate: d },
                (msg: string) => ctx.reply(msg) as unknown as Promise<unknown>,
              );
            }
          }
        }

      } else if (intent.type === 'answer') {
        await ctx.reply(intent.text);
      } else if (intent.type === 'clarify') {
        await ctx.reply(intent.question);
      } else if (intent.type === 'casual') {
        await ctx.reply(intent.reply);
      }

    } else {
      // No caption — ask what they want
      if (isImageEditConfigured()) {
        await setSession(chatId, { state: 'image_awaiting_prompt', imageBuffer, imageMimeType: mimeType });
        await ctx.reply('Got the image. What would you like me to do with it?\n\nI can edit it (e.g. "make the background white") or extract info (e.g. "add these events to my calendar").');
      } else {
        // No image editing available, but can still understand
        await setSession(chatId, { state: 'image_awaiting_prompt', imageBuffer, imageMimeType: mimeType });
        await ctx.reply('Got the image. What would you like me to do with it?\n\nFor example: "add these to my calendar", "turn this into tasks", or "what does this say?"');
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[bot] photo handler error for chat', chatId, ':', msg);
    await ctx.reply(`Couldn't process that image — ${msg.slice(0, 80)}`);
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
        `SELECT entry_date, mit, p1, p2, open_journal FROM journals WHERE entry_date >= $1 ORDER BY entry_date DESC LIMIT 7`,
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
        if (j.p1) parts.push(`P1: ${j.p1}`);
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

// Wire up scheduler events — set session when Friday check-in is sent
schedulerEvents.on('checkin_prompt_sent', async (event: CheckinPromptEvent) => {
  await setSession(event.chatId, {
    state: 'checkin_awaiting_input',
    weekLabel: event.weekLabel,
    periodStart: event.periodStart,
    periodEnd: event.periodEnd,
  });
  console.log('[bot] check-in session set for chat', event.chatId, '| week:', event.weekLabel);
});

// /within command — trigger a Within Notion review at any time
bot.command('within', async (ctx) => {
  await startWithinReview(ctx.chat.id, (msg) => ctx.reply(msg));
});

// /checkin command — trigger a manual check-in at any time
bot.command('checkin', async (ctx) => {
  const chatId = ctx.chat.id;
  const { format, subDays } = await import('date-fns');
  const now = new Date();
  const periodEnd = format(now, 'yyyy-MM-dd');
  const periodStart = format(subDays(now, 6), 'yyyy-MM-dd');
  const weekLabel = `${format(subDays(now, 6), 'MMM dd')} – ${format(now, 'MMM dd')}`;

  await setSession(chatId, {
    state: 'checkin_awaiting_input',
    weekLabel,
    periodStart,
    periodEnd,
  });

  await ctx.reply(
    `🗓 Weekly Check-in — ${weekLabel}\n\nHow was your week? Reply with anything — I'll structure it.\n\n• Overall feeling?\n• Goals progress?\n• Biggest blocker?\n• Mood / energy?\n• Priorities for next week?\n\nSend "cancel" to exit.`
  );
});

// ---------------------------------------------------------------------------
// Reminder callback handlers
// ---------------------------------------------------------------------------

bot.action(/^reminder_done:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  const { markReminderDone } = await import('../db/queries/reminders');
  await markReminderDone(id);
  await ctx.answerCbQuery('Marked as done');
  await ctx.editMessageReplyMarkup(undefined);
  await ctx.reply('Reminder completed.');
});

bot.action(/^reminder_snooze:(.+):(\d+)$/, async (ctx) => {
  const id = ctx.match[1];
  const minutes = parseInt(ctx.match[2], 10);
  const { snoozeReminder } = await import('../db/queries/reminders');
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  await snoozeReminder(id, until);
  await ctx.answerCbQuery(`Snoozed for ${minutes}m`);
  await ctx.editMessageReplyMarkup(undefined);
  await ctx.reply(`Snoozed — I'll remind you again in ${minutes} minutes.`);
});

bot.action(/^reminder_reschedule:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  const chatId = ctx.chat?.id;
  if (chatId) {
    await setSession(chatId, { state: 'reminder_reschedule', reminderId: id });
  }
  await ctx.answerCbQuery('Send me the new time');
  await ctx.editMessageReplyMarkup(undefined);
  await ctx.reply('When should I remind you? Send a date and time (e.g. "tomorrow at 3pm", "Friday 10:00").');
});

bot.action(/^reminder_cancel:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  const { cancelReminder } = await import('../db/queries/reminders');
  await cancelReminder(id);
  await ctx.answerCbQuery('Cancelled');
  await ctx.editMessageReplyMarkup(undefined);
  await ctx.reply('Reminder cancelled.');
});

// ROI message callback handlers
bot.action(/^roi_set_focus$/, async (ctx) => {
  await ctx.answerCbQuery('Setting focus...');
  // The ROI data is stored in the message — we'll parse it in a session state
  const chatId = ctx.chat?.id;
  if (chatId) {
    await setSession(chatId, { state: 'roi_set_focus' });
    await ctx.reply('Setting top 3 as your MIT, P1, and P2 for today...');
  }
});

bot.action(/^roi_regenerate$/, async (ctx) => {
  await ctx.answerCbQuery('Regenerating...');
  await ctx.reply('Regenerating your top 3 ROI tasks... (coming soon)');
});

// Clarify option button — treat the selected option as a new message
bot.action(/^clarify_opt:(.+)$/, async (ctx) => {
  const option = ctx.match[1];
  const chatId = ctx.chat?.id;
  await ctx.answerCbQuery(option);
  await ctx.editMessageReplyMarkup(undefined);
  if (chatId) {
    await handleText(chatId, option, (msg) => ctx.reply(msg));
  }
});

export async function setupWebhook(app: Express, webhookUrl: string) {
  const path = `/webhook/${process.env.TELEGRAM_BOT_TOKEN}`;
  await bot.telegram.setWebhook(`${webhookUrl}${path}`);
  app.use(bot.webhookCallback(path));
  console.log(`Webhook set to ${webhookUrl}${path}`);
}
