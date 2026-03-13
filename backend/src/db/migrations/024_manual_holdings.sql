-- Manual holdings for crypto and stock assets, tracked as date-based snapshots.
-- Each row is one asset on one platform for one date. A "snapshot" is all rows
-- sharing the same as_of_date. The latest snapshot drives the dashboard totals.

CREATE TABLE IF NOT EXISTS finance_manual_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  as_of_date DATE NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('crypto', 'stock')),
  asset_name TEXT NOT NULL,            -- e.g. BTC, SOL, NVDA, AAPL
  platform TEXT NOT NULL DEFAULT 'Manual', -- e.g. Trezor, Phantom, Kraken, Broker
  quantity NUMERIC(18,8),              -- nullable: not always relevant
  usd_value NUMERIC(14,2) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manual_holdings_date ON finance_manual_holdings (as_of_date DESC);
CREATE INDEX IF NOT EXISTS idx_manual_holdings_type ON finance_manual_holdings (asset_type);
