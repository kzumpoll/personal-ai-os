/**
 * Within Notion database service.
 *
 * Interacts with the shared Within workspace Notion database so Fay can
 * see project task updates. Uses the Notion REST API directly (via axios)
 * to avoid @notionhq/client SDK version compatibility issues.
 *
 * Database: https://www.notion.so/kz-automation/302aa8c43a1d80cf9a7af256a5ed3d36
 *
 * Allowed operations (non-destructive, read + limited write):
 *   ✓ Fetch all active tasks
 *   ✓ Add a comment to a task
 *   ✓ Update a task's due date
 *   ✓ Create a new task
 *   ✗ Change status / mark complete / edit other properties
 *
 * Required env var:
 *   NOTION_TOKEN — integration token (same one used for personal task sync)
 *
 * Configuration:
 *   NOTION_WITHIN_DB_ID (optional) — override the hardcoded database ID
 */

import axios from 'axios';
import { getLocalToday } from './localdate';

// The Within project Notion database ID (extracted from URL)
const DEFAULT_WITHIN_DB_ID = '302aa8c43a1d80cf9a7af256a5ed3d36';
const NOTION_VERSION = '2022-06-28';
const NOTION_API = 'https://api.notion.com/v1';

export interface WithinTask {
  id: string;          // Notion page ID
  title: string;
  due_date: string | null;  // YYYY-MM-DD or null
  status: string | null;
  url: string;
}

export interface WithinTaskFetchResult {
  tasks: WithinTask[];
  overdue: WithinTask[];
  due_today: WithinTask[];
  due_soon: WithinTask[];   // due in next 3 days (excluding today)
  no_date: WithinTask[];
}

function getToken(): string {
  const t = process.env.NOTION_TOKEN;
  if (!t) throw new Error('NOTION_TOKEN not set');
  return t;
}

function getDbId(): string {
  return process.env.NOTION_WITHIN_DB_ID ?? DEFAULT_WITHIN_DB_ID;
}

function notionHeaders() {
  return {
    Authorization: `Bearer ${getToken()}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

/** Extract the plain-text title from a Notion page object. */
function extractTitle(properties: Record<string, unknown>): string {
  for (const prop of Object.values(properties)) {
    const p = prop as Record<string, unknown>;
    if (p.type === 'title' && Array.isArray(p.title)) {
      return (p.title as Array<{ plain_text?: string }>)
        .map((t) => t.plain_text ?? '')
        .join('')
        .trim();
    }
  }
  return '(untitled)';
}

/** Extract a date value from Notion page properties — returns YYYY-MM-DD or null. */
function extractDueDate(properties: Record<string, unknown>): string | null {
  // Try property names in order of likelihood
  const candidates = ['Due', 'Due Date', 'Date', 'Deadline', 'Due date'];
  for (const name of candidates) {
    const prop = properties[name] as Record<string, unknown> | undefined;
    if (prop?.type === 'date' && prop.date) {
      const d = prop.date as { start?: string };
      return d.start ?? null;
    }
  }
  // Fall back to first date property found
  for (const prop of Object.values(properties)) {
    const p = prop as Record<string, unknown>;
    if (p.type === 'date' && p.date) {
      const d = p.date as { start?: string };
      return d.start ?? null;
    }
  }
  return null;
}

/** Extract status text from Notion page properties. */
function extractStatus(properties: Record<string, unknown>): string | null {
  const prop = (properties['Status'] ?? properties['State'] ?? properties['Progress']) as Record<string, unknown> | undefined;
  if (!prop) return null;
  if (prop.type === 'status' && prop.status) {
    return (prop.status as { name?: string }).name ?? null;
  }
  if (prop.type === 'select' && prop.select) {
    return (prop.select as { name?: string }).name ?? null;
  }
  return null;
}

const DONE_STATUSES = new Set(['done', 'complete', 'completed', 'archived', 'cancelled', 'canceled']);

function isDone(status: string | null): boolean {
  if (!status) return false;
  return DONE_STATUSES.has(status.toLowerCase().trim());
}

/** Convert a raw Notion page object into a WithinTask. */
function pageToTask(page: Record<string, unknown>): WithinTask {
  const id = page.id as string;
  const properties = (page.properties ?? {}) as Record<string, unknown>;
  const url = (page.url as string | undefined) ?? `https://notion.so/${id.replace(/-/g, '')}`;
  return {
    id,
    title: extractTitle(properties),
    due_date: extractDueDate(properties),
    status: extractStatus(properties),
    url,
  };
}

/**
 * Fetch all active (non-done) tasks from the Within Notion database.
 * Returns tasks categorized by urgency.
 */
export async function fetchWithinTasks(): Promise<WithinTaskFetchResult> {
  const dbId = getDbId();
  const today = getLocalToday();

  const allTasks: WithinTask[] = [];
  let cursor: string | undefined;

  // Paginate through all results
  do {
    const body: Record<string, unknown> = {
      page_size: 100,
      sorts: [{ property: 'Due', direction: 'ascending' }],
    };
    if (cursor) body.start_cursor = cursor;

    let data: { results: unknown[]; has_more: boolean; next_cursor: string | null };
    try {
      const res = await axios.post(
        `${NOTION_API}/databases/${dbId}/query`,
        body,
        { headers: notionHeaders() }
      );
      data = res.data as typeof data;
    } catch (err) {
      // If sorting by Due fails (property might have different name), try without sort
      const res = await axios.post(
        `${NOTION_API}/databases/${dbId}/query`,
        { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) },
        { headers: notionHeaders() }
      );
      data = res.data as typeof data;
    }

    for (const page of data.results) {
      const task = pageToTask(page as Record<string, unknown>);
      if (!isDone(task.status)) {
        allTasks.push(task);
      }
    }

    cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
  } while (cursor);

  // Categorize by due date
  const todayMs = new Date(today).getTime();
  const soon3 = new Date(today);
  soon3.setDate(soon3.getDate() + 3);
  const soon3Ms = soon3.getTime();

  const overdue: WithinTask[] = [];
  const due_today: WithinTask[] = [];
  const due_soon: WithinTask[] = [];
  const no_date: WithinTask[] = [];

  for (const t of allTasks) {
    if (!t.due_date) {
      no_date.push(t);
    } else {
      const dueMs = new Date(t.due_date).getTime();
      if (dueMs < todayMs) {
        overdue.push(t);
      } else if (dueMs === todayMs) {
        due_today.push(t);
      } else if (dueMs <= soon3Ms) {
        due_soon.push(t);
      }
    }
  }

  return { tasks: allTasks, overdue, due_today, due_soon, no_date };
}

/**
 * Add a comment to a Notion page.
 * Requires the integration to have "Insert comments" permission.
 */
export async function addCommentToTask(pageId: string, comment: string): Promise<void> {
  await axios.post(
    `${NOTION_API}/comments`,
    {
      parent: { page_id: pageId },
      rich_text: [{ type: 'text', text: { content: comment } }],
    },
    { headers: notionHeaders() }
  );
}

/**
 * Update the due date of a Notion task.
 * Tries the most common date property names.
 */
export async function updateTaskDueDate(pageId: string, dueDate: string): Promise<void> {
  // Try to detect the actual property name by fetching the page first
  const res = await axios.get(`${NOTION_API}/pages/${pageId}`, { headers: notionHeaders() });
  const properties = (res.data as { properties: Record<string, unknown> }).properties;

  // Find the date property name
  const datePropertyName =
    ['Due', 'Due Date', 'Date', 'Deadline', 'Due date'].find((n) => n in properties) ??
    Object.keys(properties).find((k) => {
      const p = properties[k] as Record<string, unknown>;
      return p.type === 'date';
    });

  if (!datePropertyName) {
    throw new Error('Could not find a date property on this Notion page to update.');
  }

  await axios.patch(
    `${NOTION_API}/pages/${pageId}`,
    {
      properties: {
        [datePropertyName]: { date: { start: dueDate } },
      },
    },
    { headers: notionHeaders() }
  );
}

/**
 * Create a new task in the Within Notion database.
 * Only sets title and optionally due date — no other properties.
 */
export async function createWithinTask(
  title: string,
  dueDate: string | null
): Promise<WithinTask> {
  // Discover the title and date property names from the database schema
  const schemaRes = await axios.get(`${NOTION_API}/databases/${getDbId()}`, { headers: notionHeaders() });
  const schema = (schemaRes.data as { properties: Record<string, { type: string }> }).properties;

  const titlePropName = Object.keys(schema).find((k) => schema[k].type === 'title') ?? 'Name';
  const datePropName =
    ['Due', 'Due Date', 'Date', 'Deadline', 'Due date'].find((n) => n in schema) ??
    Object.keys(schema).find((k) => schema[k].type === 'date');

  const properties: Record<string, unknown> = {
    [titlePropName]: { title: [{ type: 'text', text: { content: title } }] },
  };

  if (dueDate && datePropName) {
    properties[datePropName] = { date: { start: dueDate } };
  }

  const res = await axios.post(
    `${NOTION_API}/pages`,
    { parent: { database_id: getDbId() }, properties },
    { headers: notionHeaders() }
  );

  return pageToTask(res.data as Record<string, unknown>);
}

export function isWithinConfigured(): boolean {
  return Boolean(process.env.NOTION_TOKEN);
}

/** Format a WithinTask for display in Telegram. */
export function formatWithinTask(t: WithinTask, today: string): string {
  const due = t.due_date
    ? t.due_date < today
      ? `Due: ${t.due_date} ⚠️ Overdue`
      : `Due: ${t.due_date}`
    : 'No due date';
  const status = t.status ? ` [${t.status}]` : '';
  return `${t.title}${status}\n${due}`;
}
