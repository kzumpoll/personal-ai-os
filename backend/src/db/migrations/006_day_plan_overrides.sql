-- Add planning override fields to day_plans
-- ignored_event_keywords: keywords (lowercase) matched against calendar event titles to exclude from schedule
ALTER TABLE day_plans ADD COLUMN IF NOT EXISTS ignored_event_keywords TEXT[] DEFAULT '{}';
