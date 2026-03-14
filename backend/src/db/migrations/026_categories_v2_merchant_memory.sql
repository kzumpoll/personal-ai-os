-- 026: Replace category set + add merchant memory for LLM-assisted categorization

-- Step 1: Null-out category references to categories not in the new set
-- (safe reset since imports are fresh; no manual categorization yet)
UPDATE finance_transactions
  SET category_id = NULL, status = 'uncategorized'
  WHERE category_id IN (
    SELECT id FROM finance_categories
    WHERE name NOT IN (
      'Income','Transfers','FX','Banking & Fees','Transport','Flights',
      'Stays','Food & Coffee','Groceries','Fitness & Padel','Health & Care',
      'Software & AI','Phone & Connectivity','Education','Shopping',
      'Entertainment & Events','Tea & Hobbies','Business Services',
      'Creator Economy','Uncategorized'
    )
  );

-- Step 2: Remove old categories not in the new set
DELETE FROM finance_categories
  WHERE name NOT IN (
    'Income','Transfers','FX','Banking & Fees','Transport','Flights',
    'Stays','Food & Coffee','Groceries','Fitness & Padel','Health & Care',
    'Software & AI','Phone & Connectivity','Education','Shopping',
    'Entertainment & Events','Tea & Hobbies','Business Services',
    'Creator Economy','Uncategorized'
  );

-- Step 3: Upsert new category set (preserves UUIDs for any existing matches)
INSERT INTO finance_categories (name, color, is_income) VALUES
  ('Income',                 '#10b981', true),
  ('Transfers',              '#06b6d4', false),
  ('FX',                     '#14b8a6', false),
  ('Banking & Fees',         '#64748b', false),
  ('Transport',              '#3b82f6', false),
  ('Flights',                '#0ea5e9', false),
  ('Stays',                  '#6366f1', false),
  ('Food & Coffee',          '#f59e0b', false),
  ('Groceries',              '#f97316', false),
  ('Fitness & Padel',        '#059669', false),
  ('Health & Care',          '#f43f5e', false),
  ('Software & AI',          '#8b5cf6', false),
  ('Phone & Connectivity',   '#a855f7', false),
  ('Education',              '#eab308', false),
  ('Shopping',               '#ec4899', false),
  ('Entertainment & Events', '#ef4444', false),
  ('Tea & Hobbies',          '#84cc16', false),
  ('Business Services',      '#2563eb', false),
  ('Creator Economy',        '#d946ef', false),
  ('Uncategorized',          '#94a3b8', false)
ON CONFLICT (name) DO UPDATE
  SET color = EXCLUDED.color, is_income = EXCLUDED.is_income;

-- Step 4: Merchant memory — remembers merchant→category decisions
CREATE TABLE IF NOT EXISTS merchant_category_memory (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_name TEXT NOT NULL UNIQUE,
  category_id   UUID REFERENCES finance_categories(id) ON DELETE SET NULL,
  category_name TEXT NOT NULL,
  usage_count   INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merchant_memory_name ON merchant_category_memory (merchant_name);
