-- Add import-specific fields to finance_transactions for CSV ingestion

ALTER TABLE finance_transactions
  ADD COLUMN IF NOT EXISTS source_name TEXT,
  ADD COLUMN IF NOT EXISTS booking_date DATE,
  ADD COLUMN IF NOT EXISTS description_raw TEXT,
  ADD COLUMN IF NOT EXISTS merchant_raw TEXT,
  ADD COLUMN IF NOT EXISTS fee NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS direction TEXT CHECK (direction IN ('credit', 'debit')),
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS import_batch_id UUID;

-- Partial unique index for deduplication across re-imports
CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_tx_external_id
  ON finance_transactions (external_id)
  WHERE external_id IS NOT NULL;
