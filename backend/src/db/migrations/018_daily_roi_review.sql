-- Allow daily_roi as a review type (reviews table uses TEXT, no constraint to change)
-- Add ideas.potential column (alias for actionability, used in display)
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS potential TEXT;
