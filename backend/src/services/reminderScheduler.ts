/**
 * Reminder delivery scheduler.
 *
 * Polls pending reminders every 60 seconds and delivers them via Telegram.
 * Survives restarts because it reads from the database, not in-memory timers.
 */

import cron from 'node-cron';
import { Telegraf, Markup } from 'telegraf';
import {
  getDueReminders,
  getSnoozedDueReminders,
  markReminderSent,
  Reminder,
} from '../db/queries/reminders';

function formatReminderMessage(r: Reminder): string {
  const lines = [`\u{1F514} Reminder: ${r.title}`, '', r.body];
  if (r.recipient_name) lines.push('', `To: ${r.recipient_name}`);
  if (r.suggested_message) lines.push('', `Suggested message:`, `"${r.suggested_message}"`);
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
  try {
    const [due, snoozedDue] = await Promise.all([
      getDueReminders(),
      getSnoozedDueReminders(),
    ]);

    const all = [...due, ...snoozedDue];
    if (all.length === 0) return;

    for (const reminder of all) {
      try {
        const text = formatReminderMessage(reminder);
        await bot.telegram.sendMessage(
          reminder.chat_id,
          text,
          reminderButtons(reminder.id)
        );
        await markReminderSent(reminder.id);
        console.log(`[reminderScheduler] delivered reminder ${reminder.id}: ${reminder.title}`);
      } catch (err) {
        console.error(`[reminderScheduler] failed to deliver ${reminder.id}:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('[reminderScheduler] poll error:', err instanceof Error ? err.message : err);
  }
}

export function startReminderScheduler(bot: Telegraf): void {
  // Poll every minute
  cron.schedule('* * * * *', () => deliverReminders(bot));
  console.log('[reminderScheduler] started — polling every 60s');
}
