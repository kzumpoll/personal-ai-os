/**
 * Recurring check-in scheduler.
 *
 * Fires every Friday at 08:00 local time (USER_TZ env var) and sends
 * a structured weekly check-in prompt to the user via Telegram.
 *
 * Required env vars:
 *   TELEGRAM_USER_CHAT_ID  — your Telegram chat ID (find it via @userinfobot)
 *   USER_TZ                — IANA timezone, e.g. "Asia/Makassar"
 *
 * Optional: if TELEGRAM_USER_CHAT_ID is not set, scheduling is silently skipped
 * and a warning is logged — this keeps startup clean on environments that haven't
 * configured the check-in yet.
 */

import cron from 'node-cron';
import { format, subDays } from 'date-fns';
import { Telegraf } from 'telegraf';

export function startScheduler(bot: Telegraf): void {
  const chatId = process.env.TELEGRAM_USER_CHAT_ID;
  const tz = process.env.USER_TZ ?? 'UTC';

  if (!chatId) {
    console.log('[scheduler] TELEGRAM_USER_CHAT_ID not set — Friday check-in disabled.');
    return;
  }

  // Every Friday at 08:00 local time
  // Cron: minute hour day-of-month month day-of-week (5 = Friday)
  cron.schedule('0 8 * * 5', async () => {
    const now = new Date();
    const periodEnd = format(now, 'yyyy-MM-dd');
    const periodStart = format(subDays(now, 6), 'yyyy-MM-dd');
    const weekLabel = `${format(subDays(now, 6), 'MMM dd')} – ${format(now, 'MMM dd')}`;

    console.log(`[scheduler] Firing Friday check-in for ${weekLabel}`);

    const message = [
      `🗓 Friday Check-in — ${weekLabel}`,
      '',
      `How was your week? Reply with anything you want to reflect on:`,
      '',
      `• Overall — how are you feeling?`,
      `• Goals — how is progress going?`,
      `• Blocker — what's your biggest obstacle right now?`,
      `• Mood / energy — how's your mental health this week?`,
      `• Next week — what should you focus on?`,
      '',
      `Just write freely. I'll structure it for you.`,
    ].join('\n');

    try {
      await bot.telegram.sendMessage(chatId, message);
      // Store session state so the next reply is parsed as a check-in
      // We need to import setSession here, but that creates a circular dep.
      // Instead, we emit an event that bot.ts listens for.
      schedulerEvents.emit('checkin_prompt_sent', { chatId: parseInt(chatId, 10), weekLabel, periodStart, periodEnd });
    } catch (err) {
      console.error('[scheduler] Failed to send Friday check-in:', err instanceof Error ? err.message : err);
    }
  }, { timezone: tz });

  console.log(`[scheduler] Friday 8am check-in scheduled (tz: ${tz}, chat: ${chatId})`);
}

// Lightweight event emitter so scheduler.ts can notify bot.ts without circular imports
import { EventEmitter } from 'events';

export interface CheckinPromptEvent {
  chatId: number;
  weekLabel: string;
  periodStart: string;
  periodEnd: string;
}

class SchedulerEventEmitter extends EventEmitter {}
export const schedulerEvents = new SchedulerEventEmitter();
