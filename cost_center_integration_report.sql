-- Cost Center Integration Analysis Report
-- Analysis of cost center linkage to various data

-- ============================================
-- 1. OVERVIEW: Cost Centers and Their Transactions
-- ============================================
SELECT 
  cc.code as center_code,
  cc.name_ar as center_name,
  COUNT(DISTINCT im.id) as inventory_movements,
  COUNT(DISTINCT ct.id) as cash_transactions,
  COUNT(DISTINCT st.id) as supplier_transactions
FROM cost_centers cc
LEFT JOIN inventory_movements im ON cc.code = im.center_code AND im.company_id = 1
LEFT JOIN cash_transactions ct ON cc.code = ct.center_code AND ct.company_id = 1
LEFT JOIN supplier_transactions st ON cc.code = st.center_code AND st.company_id = 1
WHERE cc.company_id = 1
GROUP BY cc.code, cc.name_ar
ORDER BY cc.code;

-- ============================================
-- 2. INVENTORY MOVEMENTS BY CENTER AND ITEM TYPE
-- ============================================
SELECT 
  im.center_code,
  CASE 
    WHEN im.item_code BETWEEN 1010000 AND 1019999 THEN 'اسمدة'
    WHEN im.item_code BETWEEN 1020000 AND 1029999 THEN 'مبيدات'
    WHEN im.item_code BETWEEN 1030000 AND 1039999 THEN 'تقاوي'
    WHEN im.item_code BETWEEN 1050000 AND 1059999 THEN 'شبكات ري'
    ELSE 'اخرى'
  END as item_category,
  COUNT(*) as movements,
  SUM(im.quantity) as total_quantity
FROM inventory_movements im
WHERE im.company_id = 1 AND im.center_code IS NOT NULL
GROUP BY im.center_code, item_category
ORDER BY im.center_code, movements DESC;

-- ============================================
-- 3. SUPPLIER TRANSACTIONS BY CENTER AND TYPE
-- ============================================
SELECT 
  st.center_code,
  st.document_type,
  COUNT(*) as transactions,
  SUM(st.amount) as total_amount,
  ROUND(AVG(st.amount), 2) as avg_amount
FROM supplier_transactions st
WHERE st.company_id = 1 AND st.center_code IS NOT NULL
GROUP BY st.center_code, st.document_type
ORDER BY st.center_code, total_amount DESC;

-- ============================================
-- 4. CASH TRANSACTIONS BY CENTER
-- ============================================
SELECT 
  ct.center_code,
  COUNT(*) as transactions,
  SUM(CASE WHEN ct.direction = 'د' THEN ct.amount ELSE 0 END) as total_receipts,
  SUM(CASE WHEN ct.direction = 'م' THEN ct.amount ELSE 0 END) as total_payments,
  SUM(CASE WHEN ct.direction = 'د' THEN ct.amount ELSE -ct.amount END) as net_amount
FROM cash_transactions ct
WHERE ct.company_id = 1 AND ct.center_code IS NOT NULL
GROUP BY ct.center_code
ORDER BY net_amount DESC;

-- ============================================
-- 5. ORPHAN TRANSACTIONS (No Center Code)
-- ============================================
SELECT 
  'inventory' as type,
  COUNT(*) as orphan_count
FROM inventory_movements
WHERE company_id = 1 AND center_code IS NULL
UNION ALL
SELECT 
  'cash' as type,
  COUNT(*) as orphan_count
FROM cash_transactions
WHERE company_id = 1 AND center_code IS NULL
UNION ALL
SELECT 
  'supplier' as type,
  COUNT(*) as orphan_count
FROM supplier_transactions
WHERE company_id = 1 AND center_code IS NULL;
