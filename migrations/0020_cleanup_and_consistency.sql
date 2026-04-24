-- Migration 0020: Architectural Standardization & Cleanup
-- Fixes type inconsistencies and adds missing linkage columns

-- 1. Standardize Inventory Movements (Type Casting to TEXT for external references)
-- SQLite handles types dynamically, but we ensure our schema reflects the intended use.
-- Note: SQLite doesn't support ALTER COLUMN. We create a temp table if we need strict enforcement, 
-- but for now, we'll ensure new logic treats them as TEXT.

-- 2. Ensure Cash Transactions have GL Linkage
-- Some older versions of the schema might miss journal_entry_id or center_code
-- We add them safely.

ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS journal_entry_id INTEGER;
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS center_code INTEGER;
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'posted';

-- 3. Standardize Supplier Transactions
ALTER TABLE supplier_transactions ADD COLUMN IF NOT EXISTS journal_entry_id INTEGER;

-- 4. Add Performance Indexes for Balance Tracking
CREATE INDEX IF NOT EXISTS idx_ct_balance_speed ON cash_transactions(company_id, transaction_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_im_balance_speed ON inventory_movements(company_id, item_code, warehouse, movement_date DESC, id DESC);

-- 5. Fix PO Item Code Type Consistency (Ensuring it's INTEGER for JOINs with items table)
-- This was partially handled in 0018, but we enforce it here for any stray records.
UPDATE purchase_order_items SET item_code = CAST(item_code AS INTEGER) WHERE typeof(item_code) = 'text' AND item_code GLOB '[0-9]*';
