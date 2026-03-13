CREATE TABLE IF NOT EXISTS manifestations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,          -- e.g. 'career', 'health', 'relationships', 'wealth', 'lifestyle', 'spiritual', 'creative', 'learning', 'travel', 'other'
  vision TEXT NOT NULL,            -- the manifestation statement
  why TEXT,                        -- deeper reason / emotional anchor
  timeframe TEXT,                  -- e.g. '3 months', '1 year', '5 years'
  status TEXT NOT NULL DEFAULT 'active',  -- 'active', 'manifested', 'released'
  evidence TEXT,                   -- signs of progress
  manifested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manifestations_status ON manifestations(status);
