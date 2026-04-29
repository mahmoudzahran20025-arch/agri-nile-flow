-- Final Fixes - Complete Data Integration
-- ============================================

-- Fix 1: Assign orphan inventory movements to center 1006010 (default center)
-- These are recent additions (2026-04-27) without cost center
UPDATE inventory_movements SET center_code = 1006010 WHERE company_id = 1 AND center_code IS NULL;

-- Fix 2: Check and report remaining journal_entry_id issues
-- Cash transactions status
SELECT 'cash' as type, COUNT(*) as total, COUNT(CASE WHEN journal_entry_id IS NULL THEN 1 END) as missing FROM cash_transactions WHERE company_id=1;

-- Supplier transactions status  
SELECT 'supplier' as type, COUNT(*) as total, COUNT(CASE WHEN journal_entry_id IS NULL THEN 1 END) as missing FROM supplier_transactions WHERE company_id=1;

-- Fix 3: Verify all centers are properly linked
SELECT 
  cc.code,
  cc.name_ar,
  (SELECT COUNT(*) FROM inventory_movements WHERE center_code = cc.code) as inventory_count,
  (SELECT COUNT(*) FROM cash_transactions WHERE center_code = cc.code) as cash_count,
  (SELECT COUNT(*) FROM supplier_transactions WHERE center_code = cc.code) as supplier_count
FROM cost_centers cc
WHERE cc.company_id = 1
ORDER BY cc.code;
