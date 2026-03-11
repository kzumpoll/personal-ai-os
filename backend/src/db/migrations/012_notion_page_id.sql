-- Add notion_page_id column to tasks for caching Notion page references.
-- notion.ts already handles the missing column gracefully via try/catch,
-- but having the column avoids repeated search API calls after first sync.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notion_page_id TEXT;
CREATE INDEX IF NOT EXISTS tasks_notion_page_id ON tasks (notion_page_id) WHERE notion_page_id IS NOT NULL;
