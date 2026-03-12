/**
 * Daily 8AM ROI message — top 3 highest ROI tasks + proactive suggestions.
 *
 * Runs every day except Sunday at 08:00 USER_TZ.
 * Uses Claude to generate the top 3 based on goals, tasks, journal, and calendar.
 * Stores each check-in as a daily_roi review.
 */

import cron from 'node-cron';
import { Telegraf, Markup } from 'telegraf';
import Anthropic from '@anthropic-ai/sdk';
import { format } from 'date-fns';
import { getActiveGoals } from '../db/queries/goals';
import { getOverdueTasks, getTasksForDate } from '../db/queries/tasks';
import { getEventsForDate } from '../services/calendar';
import pool from '../db/client';

const anthropic = new Anthropic();

async function generateRoiMessage(): Promise<string | null> {
  const today = format(new Date(), 'yyyy-MM-dd');

  try {
    const [goals, overdue, todayTasks, events] = await Promise.all([
      getActiveGoals(),
      getOverdueTasks(10),
      getTasksForDate(today),
      getEventsForDate(today).catch(() => []),
    ]);

    // Get recent journal for context
    const { rows: journals } = await pool.query(
      `SELECT * FROM journals ORDER BY entry_date DESC LIMIT 3`
    );

    const context = [
      `Today: ${today}`,
      '',
      `Active goals: ${goals.map((g) => g.title).join(', ') || 'None'}`,
      '',
      `Overdue tasks: ${overdue.map((t) => t.title).join(', ') || 'None'}`,
      '',
      `Today's tasks: ${todayTasks.map((t) => t.title).join(', ') || 'None'}`,
      '',
      `Calendar: ${events.map((e) => `${e.title} (${e.allDay ? 'all day' : e.start})`).join(', ') || 'Nothing'}`,
      '',
      `Recent journal reflections: ${journals.map((j) => j.open_journal || '').filter(Boolean).join(' | ') || 'None'}`,
    ].join('\n');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `You are a productivity assistant. Based on the user's context below, generate a morning check-in message.

Format:
1. Top 3 highest ROI tasks for today (may include existing tasks OR propose new ones)
   - For each task, include a "2-minute start action" (a tiny first step)
2. A section "KempOS can do these for you today" with 1-3 actionable assistant suggestions (e.g., draft a message, create a calendar event, outline a plan)

Keep it concise and motivating. No preamble.

Context:
${context}`
      }],
    });

    const text = response.content[0];
    if (text.type === 'text') return text.text;
    return null;
  } catch (err) {
    console.error('[dailyRoi] generation failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

async function storeRoiReview(content: string): Promise<void> {
  const today = format(new Date(), 'yyyy-MM-dd');
  try {
    await pool.query(
      `INSERT INTO reviews (review_type, period_start, period_end, content)
       VALUES ('daily_roi', $1, $1, $2)`,
      [today, JSON.stringify({ generated_list: content, chosen_focus: null, feedback: null })]
    );
  } catch (err) {
    console.error('[dailyRoi] store review failed:', err instanceof Error ? err.message : err);
  }
}

export function startDailyRoiScheduler(bot: Telegraf): void {
  const chatId = process.env.TELEGRAM_USER_CHAT_ID;
  const tz = process.env.USER_TZ ?? 'UTC';

  if (!chatId) {
    console.log('[dailyRoi] TELEGRAM_USER_CHAT_ID not set — 8AM ROI disabled.');
    return;
  }

  // Every day at 08:00 except Sunday (0 = Sunday in cron)
  // Cron: minute hour day-of-month month day-of-week
  // 1-6 = Monday through Saturday
  cron.schedule('0 8 * * 1-6', async () => {
    console.log('[dailyRoi] generating 8AM ROI message...');

    const message = await generateRoiMessage();
    if (!message) {
      console.error('[dailyRoi] no message generated, skipping');
      return;
    }

    try {
      const header = `\u{1F680} Good morning — here's your top 3 for today:\n\n`;
      await bot.telegram.sendMessage(
        chatId,
        header + message,
        Markup.inlineKeyboard([
          [
            Markup.button.callback('Set as Focus', 'roi_set_focus'),
            Markup.button.callback('Regenerate', 'roi_regenerate'),
          ],
        ])
      );
      await storeRoiReview(message);
      console.log('[dailyRoi] 8AM ROI message sent and stored');
    } catch (err) {
      console.error('[dailyRoi] send failed:', err instanceof Error ? err.message : err);
    }
  }, { timezone: tz });

  console.log(`[dailyRoi] 8AM ROI scheduled Mon-Sat (tz: ${tz}, chat: ${chatId})`);
}
