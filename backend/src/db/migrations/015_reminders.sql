-- Reminders system
CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id BIGINT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  recipient_name TEXT,
  suggested_message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'cancelled', 'snoozed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reminders_status_scheduled ON reminders (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_reminders_chat_id ON reminders (chat_id);
