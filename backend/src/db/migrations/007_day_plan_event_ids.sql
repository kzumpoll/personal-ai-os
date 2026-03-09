-- Replace keyword-based event filtering with stable Google Calendar event ID filtering.
-- ignored_event_ids stores the exact GCal event ID (e.g. "abc123xyz@google.com").
-- ignored_event_snapshots stores lightweight metadata (title, start) for traceability.
ALTER TABLE day_plans RENAME COLUMN ignored_event_keywords TO ignored_event_ids;
ALTER TABLE day_plans ADD COLUMN IF NOT EXISTS ignored_event_snapshots JSONB NOT NULL DEFAULT '[]';
