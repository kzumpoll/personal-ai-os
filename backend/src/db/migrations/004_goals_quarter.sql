-- Part 4: Add quarter column to goals for timeline grouping
-- Quarter format: 'YYYY-QN' e.g. '2026-Q1', '2026-Q2'
ALTER TABLE goals ADD COLUMN IF NOT EXISTS quarter TEXT;

-- Backfill existing goals from target_date if available
UPDATE goals
SET quarter = CONCAT(
  EXTRACT(YEAR FROM target_date::date)::TEXT,
  '-Q',
  CEIL(EXTRACT(MONTH FROM target_date::date) / 3.0)::TEXT
)
WHERE target_date IS NOT NULL AND quarter IS NULL;
