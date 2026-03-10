-- Track intra-day completion of MIT, K1, K2 focus blocks.
-- These are set during the day (e.g. "mark MIT done") and preserved across plan regenerations.
ALTER TABLE day_plans ADD COLUMN IF NOT EXISTS mit_done BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE day_plans ADD COLUMN IF NOT EXISTS k1_done  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE day_plans ADD COLUMN IF NOT EXISTS k2_done  BOOLEAN NOT NULL DEFAULT FALSE;
