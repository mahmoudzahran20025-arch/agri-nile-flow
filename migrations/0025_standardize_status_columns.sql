-- Migration 0025: Standardize Status and GL Linkage
-- This ensures all transaction tables have 'status' and 'journal_entry_id'

-- 1. Supplier Transactions
-- Note: status already exists in remote, journal_entry_id is missing.
ALTER TABLE supplier_transactions ADD COLUMN journal_entry_id INTEGER;

-- 2. Inventory Movements
-- Both are missing in remote.
ALTER TABLE inventory_movements ADD COLUMN status TEXT DEFAULT 'posted';
ALTER TABLE inventory_movements ADD COLUMN journal_entry_id INTEGER;

-- 3. Ensure Indexes for Status Filtering
CREATE INDEX IF NOT EXISTS idx_st_status ON supplier_transactions(company_id, status);
CREATE INDEX IF NOT EXISTS idx_ct_status ON cash_transactions(company_id, status);
CREATE INDEX IF NOT EXISTS idx_im_status ON inventory_movements(company_id, status);
