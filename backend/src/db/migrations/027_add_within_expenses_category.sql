-- 027: Add Within Expenses category (safe additive insert, no data migration)
-- Existing categorized transactions are fully preserved.

INSERT INTO finance_categories (name, color, is_income)
VALUES ('Within Expenses', '#d97706', false)
ON CONFLICT (name) DO NOTHING;
