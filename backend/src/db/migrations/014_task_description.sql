-- Add description field to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT;
