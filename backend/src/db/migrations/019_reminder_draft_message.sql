-- Add draft_message to reminders (human-friendly message generated at creation time)
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS draft_message TEXT;
