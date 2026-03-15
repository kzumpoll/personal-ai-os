-- 028: Add Rent and Food Delivery expense categories (safe additive inserts)
-- Existing categorized transactions are fully preserved — only new rows added.

INSERT INTO finance_categories (name, color, is_income)
VALUES
  ('Rent',          '#dc2626', false),
  ('Food Delivery', '#ea580c', false)
ON CONFLICT (name) DO NOTHING;
