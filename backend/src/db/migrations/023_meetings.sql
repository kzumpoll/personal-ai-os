CREATE TABLE IF NOT EXISTS meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  meeting_date DATE NOT NULL,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  attendees TEXT[],
  transcript TEXT,
  summary TEXT,
  source TEXT NOT NULL DEFAULT 'granola',  -- 'granola', 'manual', 'calendar'
  source_id TEXT,                          -- external ID from Granola or Calendar
  calendar_event_id TEXT,                  -- linked Google Calendar event
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meeting_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  assignee TEXT,                           -- who is responsible
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'done', 'cancelled'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(meeting_date DESC);
CREATE INDEX IF NOT EXISTS idx_meeting_actions_meeting ON meeting_actions(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_actions_status ON meeting_actions(status);
