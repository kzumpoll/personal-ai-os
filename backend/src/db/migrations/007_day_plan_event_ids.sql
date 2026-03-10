-- Replace keyword-based event filtering with stable Google Calendar event ID filtering.
-- ignored_event_ids stores the exact GCal event ID (e.g. "abc123xyz@google.com").
-- ignored_event_snapshots stores lightweight metadata (title, start) for traceability.
--
-- Idempotent: only renames if old column exists AND new column does not yet exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'day_plans' AND column_name = 'ignored_event_keywords'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'day_plans' AND column_name = 'ignored_event_ids'
  ) THEN
    ALTER TABLE day_plans RENAME COLUMN ignored_event_keywords TO ignored_event_ids;
  END IF;
END $$;
ALTER TABLE day_plans ADD COLUMN IF NOT EXISTS ignored_event_snapshots JSONB NOT NULL DEFAULT '[]';
