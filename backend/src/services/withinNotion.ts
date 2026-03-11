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
 *   ✓ Fetch tasks assigned to me
 *   ✓ Add a comment to a task
 *   ✓ Update a task's due date
 *   ✓ Create a new task
 *   ✗ Change status / mark complete / edit other properties
 *
 * Required env vars:
 *   NOTION_TOKEN       — integration token (same one used for personal task sync)
 *   NOTION_USER_ID     — your Notion person UUID for assignment filtering
 *                        (find it via: GET https://api.notion.com/v1/users with your token)
 *
 * Optional env vars:
 *   NOTION_WITHIN_DB_ID — override the hardcoded database ID
 *
 * IMPORTANT — "Insert comments" capability:
 *   The Notion integration must have "Insert comments" enabled in its capability
 *   settings at notion.so/profile/integrations. Without this, comment writes will
 *   fail with HTTP 403 even if the token is otherwise valid.
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
  assignee_ids: string[];  // Notion person UUIDs assigned to this task
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

/**
 * Returns the Notion person UUID for assignment filtering.
 * Set NOTION_USER_ID in env. If not set, a warning is logged and
 * all tasks are returned (no assignment filter applied).
 *
 * How to find your Notion user ID:
 *   curl -s https://api.notion.com/v1/users \
 *     -H "Authorization: Bearer $NOTION_TOKEN" \
 *     -H "Notion-Version: 2022-06-28" | jq '.results[] | {id, name, email: .person.email}'
 */
function getNotionUserId(): string | null {
  return process.env.NOTION_USER_ID ?? null;
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

/**
 * Extract assignee person IDs from Notion page properties.
 * Checks common property names for people-type fields.
 *
 * Notion people property shape:
 *   { "type": "people", "people": [{ "id": "user-uuid", ... }] }
 *
 * Returns an array of person UUIDs (may be empty if none assigned).
 */
function extractAssignees(properties: Record<string, unknown>): string[] {
  const candidates = ['Assignee', 'Assigned to', 'Assigned To', 'Person', 'Owner', 'Responsible', 'Member'];
  for (const name of candidates) {
    const prop = properties[name] as Record<string, unknown> | undefined;
    if (prop?.type === 'people' && Array.isArray(prop.people)) {
      return (prop.people as Array<{ id?: string }>).map((p) => p.id ?? '').filter(Boolean);
    }
  }
  // Fall back to first people property found
  for (const prop of Object.values(properties)) {
    const p = prop as Record<string, unknown>;
    if (p.type === 'people' && Array.isArray(p.people)) {
      return (p.people as Array<{ id?: string }>).map((person) => person.id ?? '').filter(Boolean);
    }
  }
  return [];
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
    assignee_ids: extractAssignees(properties),
  };
}

/**
 * Fetch active tasks from the Within Notion database assigned to the current user.
 *
 * Assignment filter:
 *   - If NOTION_USER_ID is set: only returns tasks where assignee_ids includes that ID.
 *     Tasks with no assignees are excluded (treated as unassigned to anyone).
 *   - If NOTION_USER_ID is not set: returns all non-done tasks with a warning.
 *
 * Returns tasks categorized by urgency.
 */
export async function fetchWithinTasks(): Promise<WithinTaskFetchResult> {
  const dbId = getDbId();
  const today = getLocalToday();
  const userId = getNotionUserId();

  if (!userId) {
    console.warn('[withinNotion] NOTION_USER_ID not set — including all tasks (no assignment filter). Set NOTION_USER_ID to filter to your tasks only.');
  }

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
      console.warn('[withinNotion] Sort by Due failed, retrying without sort:', axios.isAxiosError(err) ? err.response?.data : err);
      const res = await axios.post(
        `${NOTION_API}/databases/${dbId}/query`,
        { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) },
        { headers: notionHeaders() }
      );
      data = res.data as typeof data;
    }

    for (const page of data.results) {
      const task = pageToTask(page as Record<string, unknown>);
      if (isDone(task.status)) continue;

      // Assignment filter: only include tasks assigned to this user
      if (userId) {
        if (!task.assignee_ids.includes(userId)) continue;
      }

      allTasks.push(task);
    }

    cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
  } while (cursor);

  console.log(`[withinNotion] Fetched ${allTasks.length} active tasks${userId ? ` assigned to user ${userId.slice(0, 8)}…` : ' (all users)'}`);

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
 *
 * PREREQUISITE: The Notion integration must have "Insert comments" capability
 * enabled at notion.so/profile/integrations — this is separate from content
 * permissions and must be explicitly checked.
 *
 * Notion API: POST /v1/comments
 * Body: { "parent": { "page_id": "..." }, "rich_text": [{ "type": "text", "text": { "content": "..." } }] }
 */
export async function addCommentToTask(pageId: string, comment: string): Promise<void> {
  if (!comment || !comment.trim()) {
    throw new Error(`addCommentToTask: comment text is empty for page ${pageId}`);
  }

  try {
    await axios.post(
      `${NOTION_API}/comments`,
      {
        parent: { page_id: pageId },
        rich_text: [{ type: 'text', text: { content: comment } }],
      },
      { headers: notionHeaders() }
    );
    console.log(`[withinNotion] Comment added to page ${pageId.slice(0, 8)}…`);
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      const status = err.response.status;
      const body = JSON.stringify(err.response.data);
      console.error(`[withinNotion] Comment write FAILED | page: ${pageId} | HTTP ${status} | response: ${body}`);

      if (status === 403) {
        throw new Error(
          `Notion 403 on comment write — the integration is missing "Insert comments" capability. ` +
          `Enable it at notion.so/profile/integrations for this integration.`
        );
      }
      if (status === 400) {
        throw new Error(`Notion 400 on comment write — bad request: ${body.slice(0, 120)}`);
      }
      if (status === 404) {
        throw new Error(`Notion 404 on comment write — page ${pageId} not found or integration lacks access to it`);
      }
    }
    throw err;
  }
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
  console.log(`[withinNotion] Due date updated: page ${pageId.slice(0, 8)}… → ${dueDate}`);
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

  const created = pageToTask(res.data as Record<string, unknown>);
  console.log(`[withinNotion] Created task: "${created.title}" (${created.id.slice(0, 8)}…)`);
  return created;
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
