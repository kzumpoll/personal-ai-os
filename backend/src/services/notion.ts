/**
 * Notion sync service — non-destructive daily task sync.
 *
 * Reads completed tasks from our DB for a given date and syncs their status
 * to the shared Notion workspace so Fay can see progress without manual updates.
 *
 * Strategy (non-destructive):
 *   1. Fetch tasks completed on the given date from our DB.
 *   2. For each task, search Notion for a matching page by title.
 *   3. If found, add a completion comment.
 *   4. If not found and createMissing=true, create a new page.
 *   5. Store the Notion page ID on the task for future lookups.
 *
 * Required env vars:
 *   NOTION_TOKEN          — integration token (starts with "ntn_" or "secret_")
 *   NOTION_TASKS_DB_ID    — Notion database ID
 *                           From URL: notion.so/workspace/DATABASE_ID?v=VIEW_ID
 */

import { Client, isFullPage } from '@notionhq/client';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import pool from '../db/client';

function getClient(): Client | null {
  const token = process.env.NOTION_TOKEN;
  if (!token) return null;
  return new Client({ auth: token });
}

function getTasksDbId(): string | null {
  return process.env.NOTION_TASKS_DB_ID ?? null;
}

export interface NotionSyncResult {
  synced: number;
  created: number;
  skipped: number;
  errors: string[];
  summary: string;
}

interface DbTask {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  notion_page_id: string | null;
}

/**
 * Search Notion for a page matching the given title in the specified database.
 * Uses the search API (stable across SDK versions) and filters by parent DB.
 */
async function findNotionPage(
  notion: Client,
  dbId: string,
  title: string
): Promise<PageObjectResponse | null> {
  try {
    const res = await notion.search({
      query: title.slice(0, 60),
      filter: { value: 'page', property: 'object' },
      page_size: 10,
    });

    for (const result of res.results) {
      if (!isFullPage(result)) continue;
      // Must be in our tasks database
      const parent = result.parent;
      if (parent.type !== 'database_id') continue;
      const parentDbId = parent.database_id.replace(/-/g, '');
      const targetDbId = dbId.replace(/-/g, '');
      if (parentDbId !== targetDbId) continue;

      // Title match
      const nameProp = result.properties['Name'] ?? result.properties['Task'] ?? result.properties['Title'];
      if (!nameProp || nameProp.type !== 'title') continue;
      const pageTitle = nameProp.title.map((t) => t.plain_text).join('').toLowerCase();
      if (pageTitle.includes(title.toLowerCase().slice(0, 30))) {
        return result;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Add a comment to a Notion page.
 */
async function addComment(
  notion: Client,
  pageId: string,
  message: string
): Promise<void> {
  try {
    await notion.comments.create({
      parent: { page_id: pageId },
      rich_text: [{ type: 'text', text: { content: message } }],
    });
  } catch {
    // Comment permissions may not be granted — fail silently
  }
}

/**
 * Create a new Notion page in the tasks database.
 */
async function createNotionPage(
  notion: Client,
  dbId: string,
  title: string
): Promise<PageObjectResponse | null> {
  try {
    const page = await notion.pages.create({
      parent: { database_id: dbId },
      properties: {
        Name: { title: [{ type: 'text', text: { content: title } }] },
      },
    });
    return isFullPage(page) ? page : null;
  } catch {
    return null;
  }
}

/**
 * Store the Notion page ID on our task row for fast future lookups.
 * No-op if the tasks table doesn't have a notion_page_id column yet.
 */
async function cacheNotionPageId(taskId: string, notionPageId: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE tasks SET notion_page_id = $1 WHERE id = $2`,
      [notionPageId, taskId]
    );
  } catch {
    // Column may not exist yet — silently ignore
  }
}

/**
 * Daily sync: mark completed tasks as done in Notion and add a summary comment.
 *
 * @param date           YYYY-MM-DD (defaults to today UTC)
 * @param createMissing  Create Notion pages for tasks not found (default false)
 */
export async function syncTasksToNotion(
  date: string,
  createMissing = false
): Promise<NotionSyncResult> {
  const result: NotionSyncResult = { synced: 0, created: 0, skipped: 0, errors: [], summary: '' };

  const notion = getClient();
  if (!notion) {
    result.summary = 'NOTION_TOKEN not set — sync skipped.';
    return result;
  }

  const dbId = getTasksDbId();
  if (!dbId) {
    result.summary = 'NOTION_TASKS_DB_ID not set — sync skipped.';
    return result;
  }

  // Fetch tasks completed on the given date from our DB
  let tasks: DbTask[] = [];
  try {
    const { rows } = await pool.query<DbTask>(
      `SELECT id, title, status, due_date, completed_at,
              (SELECT notion_page_id FROM tasks WHERE id = t.id LIMIT 1) as notion_page_id
       FROM tasks t
       WHERE status = 'done' AND completed_at::date = $1
       ORDER BY completed_at DESC`,
      [date]
    );
    tasks = rows;
  } catch {
    // notion_page_id column may not exist — fall back to simple query
    try {
      const { rows } = await pool.query(
        `SELECT id, title, status, due_date, completed_at, NULL as notion_page_id
         FROM tasks
         WHERE status = 'done' AND completed_at::date = $1
         ORDER BY completed_at DESC`,
        [date]
      );
      tasks = rows as DbTask[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`DB query failed: ${msg}`);
      result.summary = `Failed to fetch tasks: ${msg}`;
      return result;
    }
  }

  if (tasks.length === 0) {
    result.summary = `No completed tasks on ${date}.`;
    return result;
  }

  const completedTitles: string[] = [];

  for (const task of tasks) {
    try {
      // Use cached page ID if available, otherwise search
      let page: PageObjectResponse | null = null;
      if (task.notion_page_id) {
        try {
          const p = await notion.pages.retrieve({ page_id: task.notion_page_id });
          page = isFullPage(p) ? p : null;
        } catch {
          page = null; // page deleted or access revoked
        }
      }

      if (!page) {
        page = await findNotionPage(notion, dbId, task.title);
      }

      if (page) {
        // Cache the page ID for future lookups
        await cacheNotionPageId(task.id, page.id);
        // Add completion comment (non-destructive — don't update status)
        await addComment(notion, page.id, `✅ Completed ${date} via Personal OS`);
        result.synced++;
      } else if (createMissing) {
        const newPage = await createNotionPage(notion, dbId, task.title);
        if (newPage) {
          await cacheNotionPageId(task.id, newPage.id);
          await addComment(notion, newPage.id, `✅ Completed ${date} via Personal OS`);
          result.created++;
        } else {
          result.skipped++;
        }
      } else {
        result.skipped++;
      }

      completedTitles.push(task.title);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`"${task.title}": ${msg}`);
    }
  }

  result.summary = `Synced ${result.synced} tasks, created ${result.created}, skipped ${result.skipped}${result.errors.length ? `, ${result.errors.length} errors` : ''}.`;
  return result;
}
