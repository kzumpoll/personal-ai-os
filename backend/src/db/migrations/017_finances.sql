-- Finances: categories, transactions, balance snapshots, statements

CREATE TABLE IF NOT EXISTS finance_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  color TEXT,
  is_income BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default categories
INSERT INTO finance_categories (name, color, is_income) VALUES
  ('Food & Dining', '#f59e0b', false),
  ('Transport', '#3b82f6', false),
  ('Housing', '#8b5cf6', false),
  ('Subscriptions', '#06b6d4', false),
  ('Shopping', '#ec4899', false),
  ('Health', '#10b981', false),
  ('Entertainment', '#f97316', false),
  ('Travel', '#14b8a6', false),
  ('Business', '#6366f1', false),
  ('Other', '#64748b', false),
  ('Salary', '#10b981', true),
  ('Freelance', '#06b6d4', true),
  ('Investment', '#8b5cf6', true),
  ('Other Income', '#64748b', true)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS finance_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AED',
  category_id UUID REFERENCES finance_categories(id),
  account TEXT,
  is_income BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'uncategorized' CHECK (status IN ('uncategorized', 'categorized', 'excluded')),
  statement_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_tx_date ON finance_transactions (date);
CREATE INDEX IF NOT EXISTS idx_finance_tx_status ON finance_transactions (status);

CREATE TABLE IF NOT EXISTS finance_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  account TEXT,
  upload_date DATE NOT NULL DEFAULT CURRENT_DATE,
  raw_data BYTEA,
  parsed_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS finance_balance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account TEXT NOT NULL,
  date DATE NOT NULL,
  balance NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AED',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account, date)
);
