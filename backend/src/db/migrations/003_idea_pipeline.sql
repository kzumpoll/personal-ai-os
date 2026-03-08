-- Idea → Project pipeline columns

ALTER TABLE ideas ADD COLUMN IF NOT EXISTS next_step TEXT;
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS linked_project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS ideas_status_idx ON ideas(status);
CREATE INDEX IF NOT EXISTS ideas_linked_project_idx ON ideas(linked_project_id) WHERE linked_project_id IS NOT NULL;
