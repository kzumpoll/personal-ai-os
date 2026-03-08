-- Claude Code status table — written by hooks/scripts, read by dashboard
-- Only ever has one row (id = 'default')
CREATE TABLE IF NOT EXISTS claude_code_status (
  id          TEXT PRIMARY KEY DEFAULT 'default',
  status      TEXT NOT NULL DEFAULT 'idle',      -- idle | running | waiting_for_permission
  current_task TEXT,                              -- short description of active task
  permission_request TEXT,                       -- what permission is being requested
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO claude_code_status (id, status) VALUES ('default', 'idle')
ON CONFLICT (id) DO NOTHING;
