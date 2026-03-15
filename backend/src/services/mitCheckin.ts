/**
 * 1 PM MIT check-in scheduler.
 *
 * Every weekday at 1:00 PM USER_TZ, sends a Telegram message asking how
 * the Most Important Task is going. Skips if today's journal has no MIT set.
 *
 * Uses setInterval (not node-cron) for maximum reliability.
 */

import { Telegraf } from 'telegraf';
import { format } from 'date-fns';
import { getJournalByDate } from '../db/queries/journals';

/** Returns the current wall-clock hour (0–23) in USER_TZ. */
function localHour(): number {
  const tz = process.env.USER_TZ ?? 'UTC';
  const hour = new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false });
  return parseInt(hour, 10);
}

/** Returns today's date string (YYYY-MM-DD) in USER_TZ. */
function localToday(): string {
  const tz = process.env.USER_TZ ?? 'UTC';
  return format(
    new Date(new Date().toLocaleString('en-US', { timeZone: tz })),
    'yyyy-MM-dd'
  );
}

/** Returns today's day of week in USER_TZ (0=Sun … 6=Sat). */
function localDayOfWeek(): number {
  const tz = process.env.USER_TZ ?? 'UTC';
  return new Date(new Date().toLocaleString('en-US', { timeZone: tz })).getDay();
}

let lastSentDate = '';

async function sendMitCheckin(bot: Telegraf): Promise<void> {
  const chatId = process.env.TELEGRAM_USER_CHAT_ID;
  if (!chatId) return;

  const today = localToday();

  // Only once per day
  if (lastSentDate === today) return;

  const hour = localHour();
  const dow  = localDayOfWeek();

  // 1 PM window, Mon–Sat (skip Sunday)
  if (hour !== 13 || dow === 0) return;

  // Mark as sent immediately to prevent double-fire within the same minute
  lastSentDate = today;

  try {
    const journal = await getJournalByDate(today);
    const mit = journal?.mit?.trim();

    const message = mit
      ? `\u{1F4CC} 1 PM check-in — how's your MIT going?\n\n*${mit}*\n\nMade meaningful progress? Reply to let me know, or mark it done in the dashboard.`
      : `\u{1F4CC} 1 PM check-in — you haven't set an MIT for today. What's the one thing that matters most right now?`;

    await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    console.log(`[mitCheckin] 1PM check-in sent for ${today}${mit ? ` — MIT: "${mit}"` : ' (no MIT)'}`);
  } catch (err) {
    console.error('[mitCheckin] send failed:', err instanceof Error ? err.message : err);
    // Reset so it can retry next minute
    lastSentDate = '';
  }
}

export function startMitCheckinScheduler(bot: Telegraf): void {
  const chatId = process.env.TELEGRAM_USER_CHAT_ID;
  const tz = process.env.USER_TZ ?? 'UTC';

  if (!chatId) {
    console.log('[mitCheckin] TELEGRAM_USER_CHAT_ID not set — 1PM MIT check-in disabled.');
    return;
  }

  setInterval(() => { void sendMitCheckin(bot); }, 60_000);
  console.log(`[mitCheckin] 1PM MIT check-in scheduled Mon-Sat (tz: ${tz}, chat: ${chatId})`);
}
