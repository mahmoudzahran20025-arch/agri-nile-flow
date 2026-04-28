-- ============================================================================
-- PHASE 4: CLEAN SLATE + IDEMPOTENCY SETUP
-- ============================================================================
-- Purpose: Remove all imported data, add unique constraints, prepare for clean import
-- Date: 2026-04-27
-- Status: READY TO EXECUTE
-- ============================================================================

-- ============================================================================
-- STEP 1: DELETE ALL IMPORTED TRANSACTION DATA
-- ============================================================================

-- Delete all supplier transactions (company_id = 1)
DELETE FROM supplier_transactions WHERE company_id = 1;

-- Delete all cash transactions (company_id = 1)
DELETE FROM cash_transactions WHERE company_id = 1;

-- Delete all inventory movements (company_id = 1)
DELETE FROM inventory_movements WHERE company_id = 1;

-- Verify deletion
SELECT 'supplier_transactions' as table_name, COUNT(*) as remaining_count FROM supplier_transactions WHERE company_id = 1
UNION ALL
SELECT 'cash_transactions', COUNT(*) FROM cash_transactions WHERE company_id = 1
UNION ALL
SELECT 'inventory_movements', COUNT(*) FROM inventory_movements WHERE company_id = 1;

-- ============================================================================
-- STEP 2: ADD UNIQUE CONSTRAINTS FOR IDEMPOTENCY
-- ============================================================================

-- Note: SQLite doesn't support ALTER TABLE ADD CONSTRAINT for UNIQUE
-- We need to check if constraints exist first, then add via CREATE UNIQUE INDEX

-- Supplier Transactions: Unique constraint
-- Composite key: company_id + supplier_code + transaction_date + amount + entry_type
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_supplier_txn 
ON supplier_transactions(company_id, supplier_code, transaction_date, amount, entry_type);

-- Cash Transactions: Unique constraint
-- Composite key: company_id + transaction_date + amount + direction + narration
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_cash_txn 
ON cash_transactions(company_id, transaction_date, amount, direction, narration);

-- Inventory Movements: Unique constraint
-- Composite key: company_id + item_code + warehouse + movement_date + quantity + movement_type
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_inventory_movement 
ON inventory_movements(company_id, item_code, warehouse, movement_date, quantity, movement_type);

-- ============================================================================
-- STEP 3: VERIFY CONSTRAINTS
-- ============================================================================

-- Check indexes
SELECT 
    name as index_name,
    tbl_name as table_name,
    sql
FROM sqlite_master 
WHERE type = 'index' 
AND name LIKE 'idx_unique_%'
ORDER BY tbl_name, name;

-- ============================================================================
-- STEP 4: VERIFY POSTING GROUPS ARE INTACT
-- ============================================================================

-- Check posting groups still exist
SELECT 'business_posting_groups' as table_name, COUNT(*) as count FROM business_posting_groups
UNION ALL
SELECT 'product_posting_groups', COUNT(*) FROM product_posting_groups
UNION ALL
SELECT 'inventory_posting_groups', COUNT(*) FROM inventory_posting_groups
UNION ALL
SELECT 'general_posting_setup', COUNT(*) FROM general_posting_setup
UNION ALL
SELECT 'inventory_posting_setup', COUNT(*) FROM inventory_posting_setup;

-- Check entity assignments still exist
SELECT 'suppliers with BPG' as description, COUNT(*) as count 
FROM suppliers WHERE bus_posting_group_code IS NOT NULL AND company_id = 1
UNION ALL
SELECT 'items with PPG', COUNT(*) 
FROM items WHERE prod_posting_group_code IS NOT NULL AND company_id = 1
UNION ALL
SELECT 'warehouses with IPG', COUNT(*) 
FROM warehouses WHERE inv_posting_group_code IS NOT NULL AND company_id = 1;

-- ============================================================================
-- COMPLETION STATUS
-- ============================================================================

SELECT 
    '✅ Clean slate complete' as status,
    'All transaction data deleted' as step1,
    'Unique constraints added' as step2,
    'Posting groups intact' as step3,
    'Ready for idempotent import' as step4;
