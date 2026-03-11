-- Rename K1/K2 to P1/P2 across journals and day_plans tables.
-- RENAME COLUMN is transactional, instant, and preserves all data.

ALTER TABLE journals RENAME COLUMN k1 TO p1;
ALTER TABLE journals RENAME COLUMN k2 TO p2;

ALTER TABLE day_plans RENAME COLUMN k1_done  TO p1_done;
ALTER TABLE day_plans RENAME COLUMN k2_done  TO p2_done;
ALTER TABLE day_plans RENAME COLUMN planned_k1 TO planned_p1;
ALTER TABLE day_plans RENAME COLUMN planned_k2 TO planned_p2;
