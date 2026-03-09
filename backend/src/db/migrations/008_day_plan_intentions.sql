-- Allow storing MIT/K1/K2 intentions for future days before the debrief runs.
-- These are set explicitly and preserved across plan regenerations via COALESCE.
ALTER TABLE day_plans ADD COLUMN IF NOT EXISTS planned_mit TEXT;
ALTER TABLE day_plans ADD COLUMN IF NOT EXISTS planned_k1  TEXT;
ALTER TABLE day_plans ADD COLUMN IF NOT EXISTS planned_k2  TEXT;
