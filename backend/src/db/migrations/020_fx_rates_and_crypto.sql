-- FX rates for currency conversion to USD
CREATE TABLE IF NOT EXISTS fx_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  currency TEXT NOT NULL,          -- e.g. 'AED', 'EUR', 'THB'
  rate_to_usd NUMERIC(14,6) NOT NULL,  -- 1 unit of currency = X USD
  is_estimated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(date, currency)
);

CREATE INDEX IF NOT EXISTS idx_fx_rates_date ON fx_rates (date);
CREATE INDEX IF NOT EXISTS idx_fx_rates_currency ON fx_rates (currency);

-- Manual crypto holdings (total USD value per wallet/exchange)
CREATE TABLE IF NOT EXISTS crypto_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,          -- e.g. 'Kraken', 'Phantom', 'Trezor'
  usd_value NUMERIC(14,2) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  UNIQUE(platform)
);

-- Add amount_usd column to existing transactions for cached USD conversion
ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS amount_usd NUMERIC(12,2);

-- Add balance_usd column to existing snapshots
ALTER TABLE finance_balance_snapshots ADD COLUMN IF NOT EXISTS balance_usd NUMERIC(14,2);
