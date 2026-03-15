/**
 * Reminder delivery scheduler.
 *
 * Polls pending reminders every 60 seconds and delivers them via Telegram.
 * Survives restarts because it reads from the database, not in-memory timers.
 *
 * Uses setInterval (not node-cron) for maximum reliability — no library
 * dependency, no cron expression parsing, fires unconditionally every 60s.
 */

import { Telegraf, Markup } from 'telegraf';
import {
  getDueReminders,
  getSnoozedDueReminders,
  markReminderSent,
  Reminder,
} from '../db/queries/reminders';

function formatReminderMessage(r: Reminder): string {
  const userTz = r.timezone || process.env.USER_TZ || 'UTC';
  const timeStr = new Date(r.scheduled_at).toLocaleString('en-US', {
    timeZone: userTz,
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const lines = [`\u{1F514} Reminder: ${r.title}`, `${timeStr}`];
  if (r.body && r.body !== r.title) lines.push('', r.body);
  if (r.recipient_name) lines.push('', `To: ${r.recipient_name}`);
  const draft = r.draft_message ?? r.suggested_message;
  if (draft) lines.push('', `Draft message:\n"${draft}"`);
  return lines.join('\n');
}

function reminderButtons(id: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Done', `reminder_done:${id}`),
      Markup.button.callback('Snooze 10m', `reminder_snooze:${id}:10`),
      Markup.button.callback('Snooze 1h', `reminder_snooze:${id}:60`),
    ],
    [
      Markup.button.callback('Reschedule', `reminder_reschedule:${id}`),
      Markup.button.callback('Cancel', `reminder_cancel:${id}`),
    ],
  ]);
}

async function deliverReminders(bot: Telegraf): Promise<void> {
  console.log('[REMINDER] scheduler tick — querying due reminders');
  try {
    const [due, snoozedDue] = await Promise.all([
      getDueReminders(),
      getSnoozedDueReminders(),
    ]);

    console.log(`[REMINDER] found ${due.length} due + ${snoozedDue.length} snoozed-due reminders`);
    const all = [...due, ...snoozedDue];
    if (all.length === 0) return;

    for (const reminder of all) {
      console.log(`[REMINDER] sending reminder ${reminder.id} "${reminder.title}" to chat_id=${reminder.chat_id} scheduled_at=${reminder.scheduled_at}`);
      try {
        const text = formatReminderMessage(reminder);
        await bot.telegram.sendMessage(
          reminder.chat_id,
          text,
          reminderButtons(reminder.id)
        );
        console.log(`[REMINDER] Telegram send success for ${reminder.id}`);
        await markReminderSent(reminder.id);
        console.log(`[REMINDER] marked sent: ${reminder.id} "${reminder.title}"`);
      } catch (err) {
        // Log both the message and the raw Telegram API response body so the
        // actual rejection reason (e.g. "chat not found", "bot was blocked") is visible.
        const msg = err instanceof Error ? err.message : String(err);
        const tgBody = (err as Record<string, unknown>)?.response;
        console.error(
          `[REMINDER] failed to send ${reminder.id} "${reminder.title}" to chat_id=${reminder.chat_id}:`,
          msg,
          tgBody ? JSON.stringify(tgBody) : ''
        );
      }
    }
  } catch (err) {
    console.error('[REMINDER] poll error:', err instanceof Error ? err.message : err);
  }
}

export function startReminderScheduler(bot: Telegraf): void {
  // Warn loudly at startup if TELEGRAM_USER_CHAT_ID is missing — reminders cannot be created without it
  if (!process.env.TELEGRAM_USER_CHAT_ID) {
    console.error('[reminderScheduler] FATAL: TELEGRAM_USER_CHAT_ID env var is not set — reminder creation will fail. Set this to your Telegram user chat ID on Railway.');
  } else {
    console.log('[reminderScheduler] TELEGRAM_USER_CHAT_ID is configured:', process.env.TELEGRAM_USER_CHAT_ID);
  }

  // Fire immediately on startup so any overdue pending reminders (e.g. created
  // before the last deploy) are delivered without waiting 60 seconds.
  console.log('[REMINDER] startup: running immediate delivery check');
  void deliverReminders(bot);

  // Poll every 60 seconds via setInterval — built-in to Node, no cron library
  // dependency, unconditionally fires regardless of timezone or cron parsing.
  setInterval(() => { void deliverReminders(bot); }, 60_000);
  console.log('[reminderScheduler] started — polling every 60s (setInterval)');
}
