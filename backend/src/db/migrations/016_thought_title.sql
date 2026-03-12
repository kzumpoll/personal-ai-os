-- Add auto-generated title to thoughts
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS title TEXT;
