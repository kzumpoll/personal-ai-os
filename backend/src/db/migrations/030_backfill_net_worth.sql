-- 030: Add unique constraint on net_worth_snapshots.snapshot_date + backfill from manual holdings

-- Deduplicate existing rows first (keep the latest created_at per date)
DELETE FROM net_worth_snapshots
WHERE id NOT IN (
  SELECT DISTINCT ON (snapshot_date) id
  FROM net_worth_snapshots
  ORDER BY snapshot_date, created_at DESC
);

-- Add unique constraint so upserts work cleanly going forward
ALTER TABLE net_worth_snapshots
  ADD CONSTRAINT net_worth_snapshots_date_unique UNIQUE (snapshot_date);

-- Backfill from finance_manual_holdings grouped by as_of_date.
-- Also picks up bank balance totals from finance_balance_snapshots on matching dates.
-- ON CONFLICT DO NOTHING: never overwrite snapshots the user entered manually.
INSERT INTO net_worth_snapshots (snapshot_date, crypto_value, stocks_value, bank_accounts_value, cash_value, assets_value, notes)
SELECT
  h.as_of_date                                                                    AS snapshot_date,
  COALESCE(SUM(CASE WHEN h.asset_type = 'crypto' THEN h.usd_value ELSE 0 END), 0) AS crypto_value,
  COALESCE(SUM(CASE WHEN h.asset_type = 'stock'  THEN h.usd_value ELSE 0 END), 0) AS stocks_value,
  COALESCE(b.bank_total, 0)                                                        AS bank_accounts_value,
  0                                                                                AS cash_value,
  0                                                                                AS assets_value,
  'backfilled from finance_manual_holdings'                                        AS notes
FROM finance_manual_holdings h
LEFT JOIN (
  SELECT date, SUM(COALESCE(balance_usd, 0)) AS bank_total
  FROM finance_balance_snapshots
  GROUP BY date
) b ON b.date = h.as_of_date
GROUP BY h.as_of_date, b.bank_total
ON CONFLICT (snapshot_date) DO NOTHING;
