-- Migration: Add center_code to cash_transactions
-- Required for accurate cost-center reporting in treasury

ALTER TABLE cash_transactions ADD COLUMN center_code INTEGER;
