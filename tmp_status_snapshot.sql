SELECT 'supplier_dim' AS metric,
       COUNT(*) AS total,
       SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) AS with_center,
       SUM(CASE WHEN expense_category IS NOT NULL THEN 1 ELSE 0 END) AS with_expense,
       SUM(CASE WHEN equipment IS NOT NULL THEN 1 ELSE 0 END) AS with_equipment,
       SUM(CASE WHEN equipment_type_id IS NOT NULL THEN 1 ELSE 0 END) AS with_equipment_type,
       SUM(CASE WHEN equipment_usage_mode IS NOT NULL THEN 1 ELSE 0 END) AS with_usage_mode
FROM supplier_transactions WHERE company_id=1;

SELECT 'cash_dim' AS metric,
       COUNT(*) AS total,
       SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) AS with_center,
       SUM(CASE WHEN expense_code IS NOT NULL THEN 1 ELSE 0 END) AS with_expense_code
FROM cash_transactions WHERE company_id=1;

SELECT 'items_posting_groups' AS metric,
       COUNT(*) AS total,
       SUM(CASE WHEN prod_posting_group_code IS NOT NULL THEN 1 ELSE 0 END) AS with_ppg,
       SUM(CASE WHEN inv_posting_group_code IS NOT NULL THEN 1 ELSE 0 END) AS with_ipg
FROM items WHERE company_id=1;

SELECT 'equipment' AS metric,
       (SELECT COUNT(*) FROM equipment_types WHERE company_id=1) AS equipment_types,
       (SELECT COUNT(*) FROM supplier_transactions WHERE company_id=1 AND equipment IS NOT NULL) AS supplier_equipment_text,
       (SELECT COUNT(*) FROM supplier_transactions WHERE company_id=1 AND equipment_type_id IS NOT NULL) AS supplier_equipment_type_id,
       (SELECT COUNT(*) FROM work_order_equipment WHERE company_id=1) AS work_order_equipment_rows;
