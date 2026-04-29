-- Analyze Beet and Variety Distribution by Cost Center
-- فهم دور البنجر والمتنوعات في التقسيم

-- ============================================
-- 1. البنجر - توزيع حركات المخزون
-- ============================================
SELECT 
  im.center_code,
  i.name as item_name,
  im.movement_type,
  COUNT(*) as movements,
  SUM(im.quantity) as total_quantity,
  SUM(im.total_cost) as total_cost
FROM inventory_movements im
JOIN items i ON im.item_code = i.code
WHERE i.name LIKE '%بنجر%' AND im.company_id = 1
GROUP BY im.center_code, i.name, im.movement_type
ORDER BY im.center_code, total_quantity DESC;

-- ============================================
-- 2. الأصناف المتنوعة (109xxxx) حسب المركز
-- ============================================
SELECT 
  im.center_code,
  i.name as item_name,
  im.movement_type,
  COUNT(*) as movements,
  SUM(im.quantity) as total_quantity
FROM inventory_movements im
JOIN items i ON im.item_code = i.code
WHERE i.code BETWEEN 1090000 AND 1099999 AND im.company_id = 1
GROUP BY im.center_code, i.name, im.movement_type
ORDER BY im.center_code, movements DESC;

-- ============================================
-- 3. حركات بدون مركز تكلفة
-- ============================================
SELECT 
  'inventory' as type,
  COUNT(*) as orphan_count,
  SUM(CASE WHEN movement_type = 'اضافة' THEN 1 ELSE 0 END) as additions,
  SUM(CASE WHEN movement_type = 'صرف' THEN 1 ELSE 0 END) as disbursements
FROM inventory_movements
WHERE company_id = 1 AND center_code IS NULL
UNION ALL
SELECT 
  'cash' as type,
  COUNT(*) as orphan_count,
  SUM(CASE WHEN direction = 'د' THEN 1 ELSE 0 END) as receipts,
  SUM(CASE WHEN direction = 'م' THEN 1 ELSE 0 END) as payments
FROM cash_transactions
WHERE company_id = 1 AND center_code IS NULL
UNION ALL
SELECT 
  'supplier' as type,
  COUNT(*) as orphan_count,
  SUM(CASE WHEN document_type = 'فاتورة' THEN 1 ELSE 0 END) as invoices,
  SUM(CASE WHEN document_type = 'مستخلص اعمال' THEN 1 ELSE 0 END) as work_certificates
FROM supplier_transactions
WHERE company_id = 1 AND center_code IS NULL;

-- ============================================
-- 4. عينة من الحركات بدون مركز
-- ============================================
SELECT id, item_code, quantity, movement_type, document_number, created_at
FROM inventory_movements
WHERE company_id = 1 AND center_code IS NULL
LIMIT 10;
