-- 029: Net worth snapshots + life identity sections

-- Net worth snapshots: one row per snapshot date with aggregate values per asset class
CREATE TABLE IF NOT EXISTS net_worth_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date       DATE NOT NULL,
  crypto_value        NUMERIC NOT NULL DEFAULT 0,
  stocks_value        NUMERIC NOT NULL DEFAULT 0,
  bank_accounts_value NUMERIC NOT NULL DEFAULT 0,
  cash_value          NUMERIC NOT NULL DEFAULT 0,
  assets_value        NUMERIC NOT NULL DEFAULT 0,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_net_worth_snapshots_date ON net_worth_snapshots (snapshot_date DESC);

-- Life identity: editable sections of the morning/evening script
CREATE TABLE IF NOT EXISTS life_identity (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT NOT NULL UNIQUE,
  content    TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default sections (idempotent)
INSERT INTO life_identity (key, content) VALUES
  ('identity',   ''),
  ('values',     ''),
  ('mission',    ''),
  ('how_i_live', ''),
  ('standards',  ''),
  ('freedom',    ''),
  ('reminder',   '')
ON CONFLICT (key) DO NOTHING;
