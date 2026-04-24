-- Migration 0026: Ensure Status Column on Supplier Transactions
-- This fixes CRITICAL-1 from the audit report in the migration history.

-- We use a safe approach. SQLite doesn't support IF NOT EXISTS for ADD COLUMN.
-- If this fails on a DB that already has the column, it's expected.
ALTER TABLE supplier_transactions ADD COLUMN status TEXT DEFAULT 'posted';
CREATE INDEX IF NOT EXISTS idx_st_status ON supplier_transactions(company_id, status);
