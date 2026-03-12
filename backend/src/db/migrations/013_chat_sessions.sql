-- Persistent chat session state for multi-step flows
-- Survives Railway deploys, restarts, and crashes

CREATE TABLE IF NOT EXISTS chat_sessions (
  chat_id BIGINT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'idle',
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS chat_sessions_expires_idx ON chat_sessions(expires_at);
