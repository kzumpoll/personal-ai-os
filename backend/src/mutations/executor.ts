import { Intent } from '../ai/intents';
import { logMutation, getLastMutation } from '../db/queries/mutation_log';
import {
  createTask,
  completeTask,
  updateTask,
  updateTaskDueDate,
  getOverdueTasks,
  getTasksForDate,
  getTaskByTitle,
  getTaskById,
} from '../db/queries/tasks';
import { createThought, getAllThoughts } from '../db/queries/thoughts';
import { createIdea, getAllIdeas, getIdeaById, getIdeaByContent, updateIdeaNextStep, linkIdeaToProject } from '../db/queries/ideas';
import { createWin, getAllWins } from '../db/queries/wins';
import { createGoal, getActiveGoals, getAllGoals } from '../db/queries/goals';
import { createResource, getAllResources } from '../db/queries/resources';
import { upsertJournal } from '../db/queries/journals';
import { upsertDayPlan, setDayPlanIntentions } from '../db/queries/day_plans';
import {
  getEventsForDate,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  searchEvents,
  isCalendarConfigured,
  CalendarEvent,
} from '../services/calendar';
import { generateDayPlan, formatAgendaForBot } from '../services/dayplan';
import pool from '../db/client';
import { format } from 'date-fns';

export interface MutationResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/**
 * Format a DATE value from pg (Date object or 'yyyy-MM-dd' string) into a
 * short human-readable string like "Sat Mar 07". Never shows time or timezone.
 * Exported so bot.ts and tests can use the same formatter.
 */
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  // Extract calendar date without UTC→local shift: toISOString() gives UTC 'yyyy-MM-dd'
  // for DATE columns (which pg stores as UTC midnight), so slicing is safe.
  const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  const parts = s.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return s;
  const [y, m, day] = parts;
  return format(new Date(y, m - 1, day), 'MMM dd');
}

/**
 * Format an ISO datetime or HH:MM time string into a short local time like "11:00".
 * Uses USER_TZ when available.
 */
function formatEventTime(iso: string): string {
  try {
    const tz = process.env.USER_TZ;
    if (tz && iso.includes('T')) {
      const d = new Date(iso);
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(d);
      const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
      const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
      return `${h}:${m}`;
    }
    // Fallback: extract time from ISO string
    if (iso.includes('T')) return iso.slice(11, 16);
    return iso;
  } catch {
    return iso.slice(11, 16) || iso;
  }
}

/**
 * Extract non-empty task titles from a numbered or bulleted plain-text list.
 * Exported for testing — used as a validation fallback in create_tasks_bulk.
 */
export function parseBulkTaskLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*\d+[.)]\s*/, '') // remove "1." or "1)"
        .replace(/^\s*[-*•]\s*/, '')   // remove "- " or "* " or "• "
        .trim()
    )
    .filter(Boolean);
}

export async function executeIntent(intent: Intent): Promise<MutationResult> {
  switch (intent.intent) {
    case 'create_task': {
      const today = format(new Date(), 'yyyy-MM-dd');
      const task = await createTask({ ...intent.data, due_date: intent.data.due_date ?? today });
      await logMutation({
        action: 'create',
        table_name: 'tasks',
        record_id: task.id,
        before_data: null,
        after_data: task as unknown as Record<string, unknown>,
      });
      const due = task.due_date ? ` (due ${fmtDate(task.due_date)})` : '';
      return { success: true, message: `Task created: "${task.title}"${due}`, data: task };
    }

    case 'create_tasks_bulk': {
      const items = intent.data.tasks;
      if (!Array.isArray(items) || items.length === 0) {
        return {
          success: false,
          message: "I understood a bulk task creation request, but the list was empty or couldn't be parsed.",
        };
      }

      const created: string[] = [];
      const failed: string[] = [];

      for (const item of items) {
        const title = item.title?.trim();
        if (!title) continue;
        try {
          const today = format(new Date(), 'yyyy-MM-dd');
          const task = await createTask({ title, due_date: item.due_date ?? today });
          await logMutation({
            action: 'create',
            table_name: 'tasks',
            record_id: task.id,
            before_data: null,
            after_data: task as unknown as Record<string, unknown>,
          });
          created.push(task.title);
        } catch (err) {
          console.error('[create_tasks_bulk] failed to create task:', title, err);
          failed.push(title);
        }
      }

      if (created.length === 0) {
        return { success: false, message: "None of the tasks could be created. Check the list format and try again." };
      }

      const lines = [`Created ${created.length} task${created.length !== 1 ? 's' : ''}:`];
      created.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
      if (failed.length) lines.push(`\n⚠️ ${failed.length} failed: ${failed.join(', ')}`);
      return { success: true, message: lines.join('\n') };
    }

    case 'list_tasks': {
      console.log('[list_tasks] intent received:', JSON.stringify(intent));

      // Claude may return { intent: 'list_tasks' } with no data field at runtime.
      // This is the root cause of "Cannot read properties of undefined (reading 'filter')".
      if (!intent.data || typeof intent.data !== 'object') {
        console.log('[list_tasks] ERROR: intent.data is missing or not an object:', intent.data);
        return {
          success: false,
          message: 'Could not list tasks: the request was malformed. Please try again (e.g. "show tasks today").',
        };
      }

      console.log('[list_tasks] fields received:', JSON.stringify(intent.data));

      const today = format(new Date(), 'yyyy-MM-dd');
      const filter = intent.data.filter ?? 'today';

      let tasks: Awaited<ReturnType<typeof getOverdueTasks>> = [];
      let label = '';

      if (filter === 'overdue') {
        tasks = await getOverdueTasks(20);
        label = 'Overdue tasks';
      } else if (filter === 'today') {
        // Include overdue tasks when showing today — user needs the full picture
        const [overdue, todayOnly] = await Promise.all([
          getOverdueTasks(20),
          getTasksForDate(today, 20),
        ]);
        // Merge without duplicates (overdue first, then today-specific)
        const seen = new Set<string>();
        const merged: typeof tasks = [];
        for (const t of [...overdue, ...todayOnly]) {
          if (!seen.has(t.id)) { seen.add(t.id); merged.push(t); }
        }
        tasks = merged;
        label = "Today's tasks";
      } else if (filter === 'all') {
        const { rows } = await pool.query(
          `SELECT * FROM tasks WHERE status = 'todo' ORDER BY due_date ASC NULLS LAST LIMIT 30`
        );
        tasks = rows;
        label = 'All open tasks';
      } else {
        tasks = await getTasksForDate(today, 20);
        label = "Today's tasks";
      }

      console.log('[list_tasks] filter applied:', filter, '| bucket label:', label, '| task count:', tasks.length);

      if (!tasks.length) return { success: true, message: `No ${label.toLowerCase()}.` };

      const lines = tasks.map(
        (t, i) => `${i + 1}. ${t.title}${t.due_date ? ` (${fmtDate(t.due_date)})` : ''}`
      );
      return {
        success: true,
        message: `${label}:\n${lines.join('\n')}`,
        data: { taskIds: tasks.map((t) => t.id), scope: filter },
      };
    }

    case 'complete_task': {
      console.log('[complete_task] start | task_id:', intent.data.task_id ?? '(none)', '| task_title:', intent.data.task_title ?? '(none)');
      let task = null;
      if (intent.data.task_id) {
        task = await getTaskById(intent.data.task_id);
        console.log('[complete_task] getTaskById →', task ? `"${task.title}" (${task.status})` : 'not found');
      } else if (intent.data.task_title) {
        task = await getTaskByTitle(intent.data.task_title);
        console.log('[complete_task] getTaskByTitle →', task ? `"${task.title}" (${task.status})` : 'not found');
      }
      if (!task) {
        console.log('[complete_task] no task matched — returning error');
        return { success: false, message: 'Task not found. Try "show tasks" to see the current list.' };
      }

      const before = { ...task };
      console.log('[complete_task] calling completeTask for id:', task.id);
      const updated = await completeTask(task.id);
      console.log('[complete_task] completeTask result:', updated ? `ok, status=${updated.status}` : 'null (no rows updated)');

      if (!updated) {
        console.error('[complete_task] DB update returned no rows for id:', task.id);
        return { success: false, message: `Could not complete "${task.title}" — please try again.` };
      }

      await logMutation({
        action: 'complete',
        table_name: 'tasks',
        record_id: task.id,
        before_data: before as unknown as Record<string, unknown>,
        after_data: updated as unknown as Record<string, unknown>,
      });
      console.log('[complete_task] done — mutation logged for', task.id);
      return { success: true, message: `Completed: "${task.title}"`, data: updated };
    }

    case 'move_task_date': {
      let task = null;
      if (intent.data.task_id) {
        task = await getTaskById(intent.data.task_id);
      } else if (intent.data.task_title) {
        task = await getTaskByTitle(intent.data.task_title);
      }
      if (!task) return { success: false, message: 'Task not found.' };

      const before = { ...task };
      const updated = await updateTaskDueDate(task.id, intent.data.new_due_date);
      await logMutation({
        action: 'move_date',
        table_name: 'tasks',
        record_id: task.id,
        before_data: before as unknown as Record<string, unknown>,
        after_data: updated as unknown as Record<string, unknown>,
      });
      return {
        success: true,
        message: `Moved "${task.title}" to ${fmtDate(intent.data.new_due_date)}`,
        data: updated,
      };
    }

    case 'complete_tasks_bulk': {
      const ids = (intent.data.task_ids ?? []) as string[];
      const titles = (intent.data.task_titles ?? []) as string[];
      const completed: string[] = [];
      const failed: string[] = [];

      for (const id of ids) {
        const task = await getTaskById(id);
        if (!task) { failed.push(id); continue; }
        const before = { ...task };
        const updated = await completeTask(task.id);
        if (!updated) { failed.push(task.title); continue; }
        await logMutation({
          action: 'complete', table_name: 'tasks', record_id: task.id,
          before_data: before as unknown as Record<string, unknown>,
          after_data: updated as unknown as Record<string, unknown>,
        });
        completed.push(task.title);
      }
      for (const title of titles) {
        const task = await getTaskByTitle(title);
        if (!task) { failed.push(title); continue; }
        const before = { ...task };
        const updated = await completeTask(task.id);
        if (!updated) { failed.push(task.title); continue; }
        await logMutation({
          action: 'complete', table_name: 'tasks', record_id: task.id,
          before_data: before as unknown as Record<string, unknown>,
          after_data: updated as unknown as Record<string, unknown>,
        });
        completed.push(task.title);
      }

      if (!completed.length) {
        return { success: false, message: 'Could not complete any of the specified tasks. Try showing tasks first.' };
      }
      const lines = [`Completed ${completed.length} task${completed.length !== 1 ? 's' : ''}:`];
      completed.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
      if (failed.length) lines.push(`\n${failed.length} not found: ${failed.join(', ')}`);
      return { success: true, message: lines.join('\n') };
    }

    case 'move_tasks_bulk': {
      const ids = (intent.data.task_ids ?? []) as string[];
      const titles = (intent.data.task_titles ?? []) as string[];
      const newDueDate = intent.data.new_due_date;
      const moved: string[] = [];
      const failed: string[] = [];

      for (const id of ids) {
        const task = await getTaskById(id);
        if (!task) { failed.push(id); continue; }
        const before = { ...task };
        const updated = await updateTaskDueDate(task.id, newDueDate);
        if (!updated) { failed.push(task.title); continue; }
        await logMutation({
          action: 'move_date', table_name: 'tasks', record_id: task.id,
          before_data: before as unknown as Record<string, unknown>,
          after_data: updated as unknown as Record<string, unknown>,
        });
        moved.push(task.title);
      }
      for (const title of titles) {
        const task = await getTaskByTitle(title);
        if (!task) { failed.push(title); continue; }
        const before = { ...task };
        const updated = await updateTaskDueDate(task.id, newDueDate);
        if (!updated) { failed.push(task.title); continue; }
        await logMutation({
          action: 'move_date', table_name: 'tasks', record_id: task.id,
          before_data: before as unknown as Record<string, unknown>,
          after_data: updated as unknown as Record<string, unknown>,
        });
        moved.push(task.title);
      }

      if (!moved.length) {
        return { success: false, message: 'Could not move any tasks. Try showing tasks first.' };
      }
      const lines = [`Moved ${moved.length} task${moved.length !== 1 ? 's' : ''} to ${fmtDate(newDueDate)}:`];
      moved.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
      if (failed.length) lines.push(`\n${failed.length} not found: ${failed.join(', ')}`);
      return { success: true, message: lines.join('\n') };
    }

    case 'group_action': {
      const { action, group, new_due_date } = intent.data;
      const today = format(new Date(), 'yyyy-MM-dd');

      let tasks: Awaited<ReturnType<typeof getOverdueTasks>> = [];
      if (group === 'overdue') {
        tasks = await getOverdueTasks(100);
      } else if (group === 'today') {
        tasks = await getTasksForDate(today, 100);
      } else {
        const { rows } = await pool.query(
          `SELECT * FROM tasks WHERE status = 'todo' ORDER BY due_date ASC NULLS LAST LIMIT 100`
        );
        tasks = rows;
      }

      if (!tasks.length) {
        return { success: true, message: `No ${group} tasks found.` };
      }

      if (action === 'complete') {
        let done = 0;
        for (const task of tasks) {
          const before = { ...task };
          const updated = await completeTask(task.id);
          if (updated) {
            await logMutation({
              action: 'complete', table_name: 'tasks', record_id: task.id,
              before_data: before as unknown as Record<string, unknown>,
              after_data: updated as unknown as Record<string, unknown>,
            });
            done++;
          }
        }
        return { success: true, message: `Completed ${done} ${group} task${done !== 1 ? 's' : ''}.` };
      }

      if (action === 'move_date') {
        if (!new_due_date) return { success: false, message: 'Missing new due date.' };
        let moved = 0;
        for (const task of tasks) {
          const before = { ...task };
          const updated = await updateTaskDueDate(task.id, new_due_date);
          if (updated) {
            await logMutation({
              action: 'move_date', table_name: 'tasks', record_id: task.id,
              before_data: before as unknown as Record<string, unknown>,
              after_data: updated as unknown as Record<string, unknown>,
            });
            moved++;
          }
        }
        return { success: true, message: `Moved ${moved} ${group} task${moved !== 1 ? 's' : ''} to ${fmtDate(new_due_date)}.` };
      }

      return { success: false, message: `Unknown group action: ${action}` };
    }

    case 'list_ideas': {
      console.log('[list_ideas] fetching all ideas');
      const ideas = await getAllIdeas();
      if (!ideas.length) return { success: true, message: "You don't have any saved ideas yet." };
      const capped = ideas.slice(0, 30);
      const lines = capped.map((idea, i) => {
        let line = `${i + 1}. ${idea.content}`;
        if (idea.actionability) line += ` [${idea.actionability}]`;
        if (idea.next_step) line += `\n   → Next: ${idea.next_step}`;
        return line;
      });
      return {
        success: true,
        message: `Your ideas:\n${lines.join('\n')}`,
        data: { ideaIds: capped.map((idea) => idea.id) },
      };
    }

    case 'list_thoughts': {
      console.log('[list_thoughts] fetching all thoughts');
      const thoughts = await getAllThoughts();
      if (!thoughts.length) return { success: true, message: "You don't have any saved thoughts yet." };
      const lines = thoughts.slice(0, 30).map((t, i) => `${i + 1}. ${t.content}`);
      return { success: true, message: `Your thoughts:\n${lines.join('\n')}` };
    }

    case 'list_resources': {
      console.log('[list_resources] fetching all resources');
      const resources = await getAllResources();
      if (!resources.length) return { success: true, message: "You don't have any saved resources yet." };
      const lines = resources.slice(0, 30).map((r, i) =>
        `${i + 1}. ${r.title}${r.content_or_url ? ` — ${r.content_or_url}` : ''}`
      );
      return { success: true, message: `Your resources:\n${lines.join('\n')}` };
    }

    case 'list_wins': {
      console.log('[list_wins] fetching all wins');
      const wins = await getAllWins();
      if (!wins.length) return { success: true, message: "You don't have any saved wins yet." };
      const lines = wins.slice(0, 30).map((w, i) => `${i + 1}. ${w.content} (${fmtDate(w.entry_date)})`);
      return { success: true, message: `Your wins:\n${lines.join('\n')}` };
    }

    case 'list_goals': {
      console.log('[list_goals] fetching goals, filter:', intent.data.filter ?? 'active');
      const filter = intent.data.filter ?? 'active';
      let goals: Awaited<ReturnType<typeof getActiveGoals>> = [];
      if (filter === 'all') {
        goals = await getAllGoals();
      } else if (filter === 'quarter' && intent.data.quarter) {
        const { rows } = await pool.query(
          `SELECT * FROM goals WHERE quarter = $1 ORDER BY created_at DESC`,
          [intent.data.quarter]
        );
        goals = rows;
      } else {
        goals = await getActiveGoals(30);
      }
      if (!goals.length) return { success: true, message: "You don't have any active goals." };

      // Group by quarter for display
      const byQuarter = new Map<string, typeof goals>();
      for (const g of goals) {
        const q = (g as typeof g & { quarter?: string }).quarter ?? 'No quarter';
        if (!byQuarter.has(q)) byQuarter.set(q, []);
        byQuarter.get(q)!.push(g);
      }
      const lines: string[] = [];
      const quarters = Array.from(byQuarter.keys()).sort((a, b) => b.localeCompare(a));
      let idx = 1;
      for (const q of quarters) {
        lines.push(`\n${q}:`);
        for (const g of byQuarter.get(q)!) {
          const date = g.target_date ? ` (by ${fmtDate(g.target_date)})` : '';
          lines.push(`  ${idx++}. ${g.title}${date}`);
        }
      }
      return { success: true, message: `Your goals:${lines.join('\n')}` };
    }

    case 'add_thought': {
      const thought = await createThought({ content: intent.data.content });
      await logMutation({
        action: 'create',
        table_name: 'thoughts',
        record_id: thought.id,
        before_data: null,
        after_data: thought as unknown as Record<string, unknown>,
      });
      return { success: true, message: `Thought saved.`, data: thought };
    }

    case 'add_idea': {
      const idea = await createIdea(intent.data);
      await logMutation({
        action: 'create',
        table_name: 'ideas',
        record_id: idea.id,
        before_data: null,
        after_data: idea as unknown as Record<string, unknown>,
      });
      return { success: true, message: `Idea saved.`, data: idea };
    }

    case 'add_win': {
      const win = await createWin(intent.data);
      await logMutation({
        action: 'create',
        table_name: 'wins',
        record_id: win.id,
        before_data: null,
        after_data: win as unknown as Record<string, unknown>,
      });
      return { success: true, message: `Win logged: "${win.content}"`, data: win };
    }

    case 'add_goal': {
      const goal = await createGoal(intent.data);
      await logMutation({
        action: 'create',
        table_name: 'goals',
        record_id: goal.id,
        before_data: null,
        after_data: goal as unknown as Record<string, unknown>,
      });
      return { success: true, message: `Goal added: "${goal.title}"`, data: goal };
    }

    case 'create_resource': {
      // Safety check: if the content looks like a calendar event, don't silently save as resource
      const combined = `${intent.data.title ?? ''} ${intent.data.content_or_url ?? ''}`.toLowerCase();
      const hasSchedulingSignal =
        /\b(\d{1,2}:\d{2}|\d{1,2}\s*(am|pm)|at\s+\d|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening)\b/i.test(combined) &&
        /\b(padel|lunch|dinner|meeting|call|session|appointment|event|brunch|coffee|drinks)\b/i.test(combined);
      if (hasSchedulingSignal) {
        return {
          success: false,
          message: `This looks like a calendar event, not a resource. Try: "add ${intent.data.title ?? 'event'} to my calendar"`,
        };
      }

      const resource = await createResource(intent.data);
      await logMutation({
        action: 'create',
        table_name: 'resources',
        record_id: resource.id,
        before_data: null,
        after_data: resource as unknown as Record<string, unknown>,
      });
      return {
        success: true,
        message: `Resource saved: "${resource.title}"`,
        data: resource,
      };
    }

    case 'save_debrief': {
      const { entry_date, debrief_date, wake_time, work_start, mit, p1, p2, open_journal, wins, task_completions, task_due_date_changes, task_deletions } =
        intent.data;
      // entry_date = planDate (MIT/K1/K2), debrief_date = day being debriefed (journal/wins)
      const journalDate = debrief_date ?? entry_date;

      if (!entry_date) {
        return {
          success: false,
          message: 'Debrief could not be saved: missing date. Please try the debrief again.',
        };
      }

      // UUID validation — catches 8-char prefix IDs if Claude produced them from truncated context.
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const isValidUUID = (id: string) => UUID_RE.test(id);

      console.log('[save_debrief] start — entry_date:', entry_date, '| mit:', mit ?? 'none', '| p1:', p1 ?? 'none', '| p2:', p2 ?? 'none');
      console.log('[save_debrief] task_completions payload:', JSON.stringify(task_completions ?? []));
      console.log('[save_debrief] task_due_date_changes payload:', JSON.stringify(task_due_date_changes ?? []));

      // Save journal/wins under debriefDate; MIT/K1/K2 under planDate
      console.log('[save_debrief] upserting journal for', journalDate, '(debrief) and', entry_date, '(plan)');
      const journal = await upsertJournal({ entry_date: journalDate, open_journal, wins_json: wins });
      console.log('[save_debrief] journal upsert done — id:', journal.id);
      await logMutation({
        action: 'upsert',
        table_name: 'journals',
        record_id: journal.id,
        before_data: null,
        after_data: journal as unknown as Record<string, unknown>,
      });

      // Save MIT/P1/P2 under the plan date (entry_date) if they differ
      if (mit || p1 || p2) {
        await upsertJournal({ entry_date, mit, p1, p2 });
      }

      const messages: string[] = [`Journal for ${journalDate} saved.`];

      if (task_completions?.length) {
        for (const id of task_completions) {
          console.log('[save_debrief] completing task id:', id, '| valid UUID:', isValidUUID(id));
          if (!isValidUUID(id)) {
            console.warn('[save_debrief] skipping invalid task ID (not a UUID):', id);
            messages.push(`Could not complete task — the reference "${id}" is not a valid task ID. Try completing it directly with "mark task done".`);
            continue;
          }
          const task = await getTaskById(id);
          console.log('[save_debrief] getTaskById →', task ? `"${task.title}"` : 'not found');
          if (task) {
            const updated = await completeTask(id);
            console.log('[save_debrief] completeTask result:', updated ? 'ok' : 'no rows returned');
            await logMutation({ action: 'complete', table_name: 'tasks', record_id: id });
            messages.push(`Completed: "${task.title}"`);
          } else {
            messages.push(`Task not found for ID: ${id.slice(0, 8)}… (may already be done)`);
          }
        }
      }

      if (task_due_date_changes?.length) {
        for (const change of task_due_date_changes) {
          console.log('[save_debrief] rescheduling task id:', change.id, '→', change.due_date, '| valid UUID:', isValidUUID(change.id));
          if (!isValidUUID(change.id)) {
            console.warn('[save_debrief] skipping invalid task ID (not a UUID):', change.id);
            messages.push(`Could not reschedule task — the reference "${change.id}" is not a valid task ID. Try moving it directly with "move task X to <date>".`);
            continue;
          }
          const task = await getTaskById(change.id);
          console.log('[save_debrief] getTaskById for reschedule →', task ? `"${task.title}"` : 'not found');
          if (task) {
            const updated = await updateTaskDueDate(change.id, change.due_date);
            console.log('[save_debrief] updateTaskDueDate result:', updated ? 'ok' : 'no rows returned');
            await logMutation({ action: 'move_date', table_name: 'tasks', record_id: change.id });
            messages.push(`Moved "${task.title}" to ${fmtDate(change.due_date)}`);
          } else {
            messages.push(`Task not found for ID: ${change.id.slice(0, 8)}…`);
          }
        }
      }

      if (task_deletions?.length) {
        for (const id of task_deletions) {
          console.log('[save_debrief] deleting task id:', id, '| valid UUID:', isValidUUID(id));
          if (!isValidUUID(id)) {
            console.warn('[save_debrief] skipping invalid task ID for deletion:', id);
            messages.push(`Could not delete task — "${id}" is not a valid task ID.`);
            continue;
          }
          const task = await getTaskById(id);
          if (task) {
            await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
            await logMutation({
              action: 'delete',
              table_name: 'tasks',
              record_id: id,
              before_data: task as unknown as Record<string, unknown>,
            });
            messages.push(`Deleted: "${task.title}"`);
          } else {
            messages.push(`Task not found for deletion: ${id.slice(0, 8)}…`);
          }
        }
      }

      if (wins?.length) {
        for (const w of wins) {
          const win = await createWin({ content: w, entry_date: journalDate });
          await logMutation({
            action: 'create',
            table_name: 'wins',
            record_id: win.id,
            after_data: win as unknown as Record<string, unknown>,
          });
        }
        messages.push(`${wins.length} win(s) saved.`);
      }

      // Auto-move overdue tasks that were NOT explicitly completed or rescheduled
      // to the plan date (entry_date). This is deterministic — user sees it in confirmation.
      {
        const handledIds = new Set<string>([
          ...(task_completions ?? []),
          ...(task_due_date_changes?.map((c) => c.id) ?? []),
          ...(task_deletions ?? []),
        ]);
        const { rows: overdueRows } = await pool.query(
          `SELECT id, title FROM tasks WHERE status = 'todo' AND due_date < $1`,
          [entry_date]
        );
        const toAutoMove = overdueRows.filter((t: { id: string }) => !handledIds.has(t.id));
        if (toAutoMove.length > 0) {
          console.log('[save_debrief] auto-moving', toAutoMove.length, 'overdue tasks to', entry_date);
          for (const t of toAutoMove) {
            const updated = await updateTaskDueDate(t.id, entry_date);
            if (updated) {
              await logMutation({ action: 'move_date', table_name: 'tasks', record_id: t.id });
            }
          }
          const names = toAutoMove.map((t: { title: string }) => `"${t.title}"`).join(', ');
          messages.push(`Auto-moved ${toAutoMove.length} overdue task${toAutoMove.length !== 1 ? 's' : ''} to ${fmtDate(entry_date)}: ${names}`);
        }
      }

      // Generate and save day plan if wake_time was provided
      if (wake_time) {
        try {
          console.log('[save_debrief] generating day plan for', entry_date, '| wake:', wake_time);
          const calEvents = await getEventsForDate(entry_date);
          const { schedule, overflow, work_start: computedWorkStart } = generateDayPlan({
            wakeTime: wake_time,
            calendarEvents: calEvents,
            mit,
            p1,
            p2,
          });
          const plan = await upsertDayPlan({
            plan_date: entry_date,
            wake_time,
            work_start: work_start ?? computedWorkStart,
            schedule,
            overflow,
          });
          console.log('[save_debrief] day plan saved — id:', plan.id);
          const startActions = intent.data as { mit_start_action?: string; p1_start_action?: string; p2_start_action?: string };
          if (startActions.mit_start_action || startActions.p1_start_action || startActions.p2_start_action) {
            await setDayPlanIntentions(entry_date, {
              mit_start_action: startActions.mit_start_action,
              p1_start_action: startActions.p1_start_action,
              p2_start_action: startActions.p2_start_action,
            });
          }
          const agendaText = formatAgendaForBot(schedule, overflow, entry_date);
          messages.push('');
          messages.push(agendaText);
        } catch (err) {
          console.error('[save_debrief] day plan generation failed:', err instanceof Error ? err.message : err);
        }
      }

      console.log('[save_debrief] complete — result lines:', messages.length);
      return { success: true, message: messages.join('\n'), data: journal };
    }

    case 'update_task_description': {
      const { task_id, task_title, description } = intent.data;
      let task = null;
      if (task_id) task = await getTaskById(task_id);
      if (!task && task_title) task = await getTaskByTitle(task_title);
      if (!task) return { success: false, message: 'Task not found. Try listing your tasks first.' };
      const updated = await updateTask(task.id, { description });
      if (!updated) return { success: false, message: `Could not update description for "${task.title}".` };
      await logMutation({
        action: 'update',
        table_name: 'tasks',
        record_id: task.id,
        before_data: task as unknown as Record<string, unknown>,
        after_data: updated as unknown as Record<string, unknown>,
      });
      return { success: true, message: `Description updated for "${task.title}".`, data: updated };
    }

    case 'create_reminder': {
      const { title, body, scheduled_at, recipient_name, suggested_message } = intent.data;
      const { createReminder } = await import('../db/queries/reminders');
      const chatId = process.env.TELEGRAM_USER_CHAT_ID ? parseInt(process.env.TELEGRAM_USER_CHAT_ID, 10) : null;
      if (!chatId) return { success: false, message: 'Chat ID not configured — cannot deliver reminders.' };
      const reminder = await createReminder({
        chat_id: chatId,
        title,
        body,
        scheduled_at,
        timezone: process.env.USER_TZ ?? 'UTC',
        recipient_name: recipient_name ?? null,
        suggested_message: suggested_message ?? null,
      });
      await logMutation({
        action: 'create',
        table_name: 'reminders',
        record_id: reminder.id,
        before_data: null,
        after_data: reminder as unknown as Record<string, unknown>,
      });
      const when = new Date(scheduled_at).toLocaleString('en-US', {
        timeZone: process.env.USER_TZ ?? 'UTC',
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      return { success: true, message: `Reminder set: "${title}" — ${when}`, data: reminder };
    }

    case 'undo_last': {
      return await undoLastMutation();
    }

    case 'daily_debrief': {
      // Signal to the handler to start the debrief flow
      return { success: true, message: '__START_DEBRIEF__' };
    }

    case 'weekly_review': {
      // Signal to bot.ts to run the weekly review flow
      return { success: true, message: '__WEEKLY_REVIEW__' };
    }

    case 'set_idea_next_step': {
      const { idea_id, idea_content, next_step } = intent.data;
      let idea = null;
      if (idea_id) {
        idea = await getIdeaById(idea_id);
      } else if (idea_content) {
        idea = await getIdeaByContent(idea_content);
      }
      if (!idea) return { success: false, message: 'Idea not found. Try listing your ideas first.' };
      const updated = await updateIdeaNextStep(idea.id, next_step);
      if (!updated) return { success: false, message: `Could not update next step for "${idea.content}".` };
      await logMutation({
        action: 'update',
        table_name: 'ideas',
        record_id: idea.id,
        before_data: idea as unknown as Record<string, unknown>,
        after_data: updated as unknown as Record<string, unknown>,
      });
      return { success: true, message: `Next step set for "${idea.content.slice(0, 60)}":\n→ ${next_step}`, data: updated };
    }

    case 'promote_idea_to_project': {
      const { idea_id, idea_content } = intent.data;
      let idea = null;
      if (idea_id) {
        idea = await getIdeaById(idea_id);
      } else if (idea_content) {
        idea = await getIdeaByContent(idea_content);
      }
      if (!idea) return { success: false, message: 'Idea not found. Try listing your ideas first.' };

      // Create a project from the idea
      const { rows: projRows } = await pool.query(
        `INSERT INTO projects (title, description) VALUES ($1, $2) RETURNING *`,
        [idea.content.slice(0, 120), `Promoted from idea on ${format(new Date(), 'yyyy-MM-dd')}`]
      );
      const project = projRows[0];
      await linkIdeaToProject(idea.id, project.id);

      await logMutation({
        action: 'create',
        table_name: 'projects',
        record_id: project.id,
        before_data: null,
        after_data: project as Record<string, unknown>,
      });

      return {
        success: true,
        message: `Idea promoted to project: "${project.title}"\nYou can now add tasks to this project.`,
        data: project,
      };
    }

    case 'calendar_create_event': {
      console.log('[executor] [CAL v2] calendar_create_event hit, configured:', isCalendarConfigured());
      if (!isCalendarConfigured()) {
        console.error('[executor] [CAL v2] Calendar NOT configured — check GOOGLE_CREDENTIALS_JSON + GOOGLE_TOKEN_JSON');
        return { success: false, message: '[CAL v2] Google Calendar is not configured. Ask the admin to set up calendar credentials.' };
      }
      const { title, start_datetime, end_datetime, all_day, description, location } = intent.data;
      console.log('[executor] [CAL v2] creating event:', JSON.stringify({ title, start_datetime, end_datetime, location }));
      const event = await createCalendarEvent({
        title,
        startDateTime: start_datetime,
        endDateTime: end_datetime,
        allDay: all_day,
        description,
        location,
      });
      if (!event) {
        return { success: false, message: 'Could not create the calendar event. Please try again.' };
      }
      try {
        await logMutation({
          action: 'create',
          table_name: 'calendar_events',
          before_data: null,
          after_data: { ...event, calendar_event_id: event.id } as unknown as Record<string, unknown>,
        });
      } catch (logErr) {
        console.error('[executor] [CAL v2] mutation log failed (create), continuing:', logErr instanceof Error ? logErr.message : logErr);
      }
      console.log('[executor] [CAL v2] calendar event inserted');
      const dateStr = fmtDate(start_datetime.slice(0, 10));
      const timeStr = event.allDay
        ? 'All day'
        : `${formatEventTime(event.start)}–${formatEventTime(event.end)}`;
      const lines = [`[CAL v2] Added to calendar:`, `${event.title}`, `${dateStr}, ${timeStr}`];
      if (location) lines.push(location);
      return {
        success: true,
        message: lines.join('\n'),
        data: { calendarEvent: event, affectsDate: start_datetime.slice(0, 10) },
      };
    }

    case 'calendar_create_events_bulk': {
      console.log('[executor] [CAL v2] calendar_create_events_bulk hit, count:', intent.data.events?.length);
      if (!isCalendarConfigured()) {
        return { success: false, message: '[CAL v2] Google Calendar is not configured. Ask the admin to set up calendar credentials.' };
      }
      const events = intent.data.events;
      if (!Array.isArray(events) || events.length === 0) {
        return { success: false, message: 'No events found to create.' };
      }

      const created: string[] = [];
      const failed: string[] = [];
      const affectsDates: string[] = [];

      for (const ev of events) {
        try {
          const result = await createCalendarEvent({
            title: ev.title,
            startDateTime: ev.start_datetime,
            endDateTime: ev.end_datetime,
            allDay: ev.all_day,
            description: ev.description,
            location: ev.location,
          });
          if (result) {
            const dateStr = fmtDate(ev.start_datetime.slice(0, 10));
            const timeStr = result.allDay
              ? 'All day'
              : `${formatEventTime(result.start)}–${formatEventTime(result.end)}`;
            const locStr = ev.location ? ` — ${ev.location}` : '';
            created.push(`${result.title}\n${dateStr}, ${timeStr}${locStr}`);
            affectsDates.push(ev.start_datetime.slice(0, 10));
            try {
              await logMutation({
                action: 'create',
                table_name: 'calendar_events',
                before_data: null,
                after_data: { ...result, calendar_event_id: result.id } as unknown as Record<string, unknown>,
              });
            } catch (logErr) {
              console.error('[executor] [CAL v2] mutation log failed (bulk create), continuing:', logErr instanceof Error ? logErr.message : logErr);
            }
          } else {
            failed.push(ev.title);
          }
        } catch (err) {
          console.error('[executor] [CAL v2] bulk create failed for:', ev.title, err instanceof Error ? err.message : err);
          failed.push(ev.title);
        }
      }

      console.log('[executor] [CAL v2] bulk calendar events inserted:', created.length, 'failed:', failed.length);

      const lines: string[] = [];
      if (created.length > 0) {
        lines.push(`[CAL v2] Added ${created.length} event${created.length > 1 ? 's' : ''} to calendar:\n`);
        lines.push(...created);
      }
      if (failed.length > 0) {
        lines.push(`\nFailed to add: ${failed.join(', ')}`);
      }

      return {
        success: created.length > 0,
        message: lines.join('\n'),
        data: { affectsDates },
      };
    }

    case 'calendar_update_event': {
      if (!isCalendarConfigured()) {
        return { success: false, message: 'Google Calendar is not configured.' };
      }
      const { event_id, event_title, search_date, new_title, new_start_datetime, new_end_datetime, new_description, new_location } = intent.data;

      // Find the event to update
      let targetEvent: CalendarEvent | null = null;
      let matchedEvents: CalendarEvent[] = [];

      if (event_id) {
        // Direct ID match from context
        const dateToSearch = search_date ?? new Date().toISOString().slice(0, 10);
        const events = await getEventsForDate(dateToSearch);
        targetEvent = events.find((e) => e.id === event_id) ?? null;
      }

      if (!targetEvent && event_title && search_date) {
        matchedEvents = await searchEvents(event_title, search_date, search_date);
        if (matchedEvents.length === 1) {
          targetEvent = matchedEvents[0];
        } else if (matchedEvents.length > 1) {
          return {
            success: false,
            message: `I found ${matchedEvents.length} events matching "${event_title}":\n${matchedEvents.map((e, i) => `${i + 1}. ${e.title} (${formatEventTime(e.start)})`).join('\n')}\nWhich one did you mean?`,
            data: { disambiguation: matchedEvents },
          };
        }
      }

      if (!targetEvent) {
        return { success: false, message: `Could not find an event${event_title ? ` called "${event_title}"` : ''}. Try checking your calendar first.` };
      }

      const before = { ...targetEvent };
      const updated = await updateCalendarEvent({
        eventId: targetEvent.id,
        title: new_title,
        startDateTime: new_start_datetime,
        endDateTime: new_end_datetime,
        description: new_description,
        location: new_location,
      });

      if (!updated) {
        return { success: false, message: `Could not update "${targetEvent.title}". Please try again.` };
      }

      try {
        await logMutation({
          action: 'update',
          table_name: 'calendar_events',
          before_data: { ...before, calendar_event_id: targetEvent.id } as unknown as Record<string, unknown>,
          after_data: { ...updated, calendar_event_id: targetEvent.id } as unknown as Record<string, unknown>,
        });
      } catch (logErr) {
        console.error('[executor] [CAL v2] mutation log failed (update), continuing:', logErr instanceof Error ? logErr.message : logErr);
      }

      const changeDesc = new_start_datetime
        ? `to ${formatEventTime(new_start_datetime)}`
        : new_title
          ? `renamed to "${new_title}"`
          : 'updated';
      const affectsDate = (new_start_datetime ?? targetEvent.start).slice(0, 10);
      return {
        success: true,
        message: `Moved ${targetEvent.title} ${changeDesc}`,
        data: { calendarEvent: updated, affectsDate },
      };
    }

    case 'calendar_delete_event': {
      if (!isCalendarConfigured()) {
        return { success: false, message: 'Google Calendar is not configured.' };
      }
      const { event_id, event_title, search_date } = intent.data;

      let targetEvent: CalendarEvent | null = null;
      let matchedEvents: CalendarEvent[] = [];

      if (event_id) {
        const dateToSearch = search_date ?? new Date().toISOString().slice(0, 10);
        const events = await getEventsForDate(dateToSearch);
        targetEvent = events.find((e) => e.id === event_id) ?? null;
      }

      if (!targetEvent && event_title && search_date) {
        matchedEvents = await searchEvents(event_title, search_date, search_date);
        if (matchedEvents.length === 1) {
          targetEvent = matchedEvents[0];
        } else if (matchedEvents.length > 1) {
          return {
            success: false,
            message: `I found ${matchedEvents.length} events matching "${event_title}":\n${matchedEvents.map((e, i) => `${i + 1}. ${e.title} (${formatEventTime(e.start)})`).join('\n')}\nWhich one did you mean?`,
            data: { disambiguation: matchedEvents },
          };
        }
      }

      if (!targetEvent) {
        return { success: false, message: `Could not find an event${event_title ? ` called "${event_title}"` : ''} to delete.` };
      }

      const deleted = await deleteCalendarEvent(targetEvent.id);
      if (!deleted) {
        return { success: false, message: `Could not delete "${targetEvent.title}". Please try again.` };
      }

      try {
        await logMutation({
          action: 'delete',
          table_name: 'calendar_events',
          before_data: { ...targetEvent, calendar_event_id: targetEvent.id } as unknown as Record<string, unknown>,
        });
      } catch (logErr) {
        console.error('[executor] [CAL v2] mutation log failed (delete), continuing:', logErr instanceof Error ? logErr.message : logErr);
      }

      const affectsDate = targetEvent.start.slice(0, 10);
      return {
        success: true,
        message: `Removed: ${targetEvent.title}`,
        data: { calendarEvent: targetEvent, affectsDate },
      };
    }

    case 'unknown':
    default: {
      return {
        success: false,
        message: "I didn't understand that. Try: create task, add thought, add idea, add win, add goal, create resource, list tasks, complete task, move task date, daily debrief, undo.",
      };
    }
  }
}

async function undoLastMutation(): Promise<MutationResult> {
  const last = await getLastMutation();
  if (!last) return { success: false, message: 'Nothing to undo.' };

  const { action, table_name, record_id, before_data } = last;
  console.log('[undo] mutation id:', last.id, '| action:', action, '| table:', table_name, '| record:', record_id);

  if (action === 'create' && record_id) {
    const result = await pool.query(`DELETE FROM ${table_name} WHERE id = $1`, [record_id]);
    console.log('[undo] delete rowCount:', result.rowCount);
    if (!result.rowCount) {
      return { success: false, message: `Could not undo: the ${table_name.replace(/s$/, '')} was already deleted or not found.` };
    }
    await logMutation({ action: 'undo_create', table_name, record_id, before_data: null, after_data: null });
    return { success: true, message: `Undone: last created ${table_name.replace(/s$/, '')} removed.` };
  }

  if (action === 'complete' && record_id && before_data) {
    const prevStatus = (before_data as Record<string, unknown>).status as string ?? 'todo';
    const prevCompletedAt = (before_data as Record<string, unknown>).completed_at ?? null;
    const result = await pool.query(
      `UPDATE tasks SET status = $1, completed_at = $2, updated_at = NOW() WHERE id = $3`,
      [prevStatus, prevCompletedAt, record_id]
    );
    console.log('[undo] restore task rowCount:', result.rowCount);
    if (!result.rowCount) {
      return { success: false, message: 'Could not undo: task no longer exists.' };
    }
    await logMutation({ action: 'undo_complete', table_name, record_id, before_data: null, after_data: before_data });
    return { success: true, message: 'Undone: task marked incomplete.' };
  }

  if (action === 'move_date' && record_id && before_data) {
    const prevDate = (before_data as Record<string, unknown>).due_date as string | null;
    const result = await pool.query(`UPDATE tasks SET due_date = $1, updated_at = NOW() WHERE id = $2`, [
      prevDate,
      record_id,
    ]);
    console.log('[undo] restore date rowCount:', result.rowCount);
    if (!result.rowCount) {
      return { success: false, message: 'Could not undo: task no longer exists.' };
    }
    await logMutation({ action: 'undo_move_date', table_name, record_id, after_data: before_data });
    const dateLabel = prevDate ? fmtDate(prevDate) : 'none';
    return { success: true, message: `Undone: task date restored to ${dateLabel}.` };
  }

  return {
    success: false,
    message: `Cannot undo action type "${action}".`,
  };
}
