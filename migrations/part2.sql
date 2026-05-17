-- 4. Link Supplier Transactions (SRV_MECH) to the newly created Work Orders
UPDATE supplier_transactions 
SET work_order_id = (
  SELECT wo.id FROM work_orders wo 
  JOIN fields f ON f.id = wo.field_id AND f.company_id = wo.company_id
  WHERE wo.company_id = supplier_transactions.company_id 
    AND f.center_code = supplier_transactions.center_code
    AND COALESCE(wo.season_id, -1) = COALESCE(supplier_transactions.season_id, -1)
    AND wo.status = 'costed'
    AND wo.name LIKE 'ميكنة %'
    AND CAST(strftime('%Y', wo.planned_date) AS INTEGER) = COALESCE(supplier_transactions.year, CAST(strftime('%Y', supplier_transactions.transaction_date) AS INTEGER))
    AND CAST(strftime('%m', wo.planned_date) AS INTEGER) = COALESCE(supplier_transactions.month, CAST(strftime('%m', supplier_transactions.transaction_date) AS INTEGER))
  ORDER BY wo.planned_date LIMIT 1
)
WHERE company_id = 1 
  AND service_type_code = 'SRV_MECH'
  AND status = 'posted'
  AND work_order_id IS NULL
  AND center_code IS NOT NULL;

-- 5. Link Supplier Transactions (SRV_LABOR) to the newly created Work Orders
UPDATE supplier_transactions 
SET work_order_id = (
  SELECT wo.id FROM work_orders wo 
  JOIN fields f ON f.id = wo.field_id AND f.company_id = wo.company_id
  WHERE wo.company_id = supplier_transactions.company_id 
    AND f.center_code = supplier_transactions.center_code
    AND COALESCE(wo.season_id, -1) = COALESCE(supplier_transactions.season_id, -1)
    AND wo.status = 'costed'
    AND wo.name LIKE 'عمالة %'
    AND CAST(strftime('%Y', wo.planned_date) AS INTEGER) = COALESCE(supplier_transactions.year, CAST(strftime('%Y', supplier_transactions.transaction_date) AS INTEGER))
    AND CAST(strftime('%m', wo.planned_date) AS INTEGER) = COALESCE(supplier_transactions.month, CAST(strftime('%m', supplier_transactions.transaction_date) AS INTEGER))
  ORDER BY wo.planned_date LIMIT 1
)
WHERE company_id = 1 
  AND service_type_code = 'SRV_LABOR'
  AND status = 'posted'
  AND work_order_id IS NULL
  AND center_code IS NOT NULL;

-- 6. Generate granular Equipment Usage records (work_order_equipment) for accurate reporting
INSERT INTO work_order_equipment (work_order_id, company_id, operation_id, equipment_name, task_date, hours_worked, cost_per_hour, equipment_usage_mode, supplier_code, notes, journal_entry_id)
SELECT 
  st.work_order_id,
  st.company_id,
  'migrated_eq_' || st.id,
  COALESCE(st.equipment, s.name, 'معدة مقاول'),
  st.transaction_date,
  COALESCE(st.quantity, 1),
  COALESCE(st.unit_price, st.amount),
  'rental',
  st.supplier_code,
  st.description,
  st.journal_entry_id
FROM supplier_transactions st
LEFT JOIN suppliers s ON s.code = st.supplier_code AND s.company_id = st.company_id
WHERE st.company_id = 1 
  AND st.service_type_code = 'SRV_MECH' 
  AND st.status = 'posted'
  AND st.work_order_id IS NOT NULL;

-- 7. Generate granular Labor records (work_tasks) for accurate reporting
INSERT INTO work_tasks (work_order_id, company_id, employee_id, task_date, description, quantity, unit, unit_cost, notes)
SELECT
  st.work_order_id,
  st.company_id,
  NULL,
  st.transaction_date,
  COALESCE(st.description, s.name, 'عمالة مقاول'),
  COALESCE(st.quantity, 1),
  'عامل/ساعة',
  COALESCE(st.unit_price, st.amount),
  st.description
FROM supplier_transactions st
LEFT JOIN suppliers s ON s.code = st.supplier_code AND s.company_id = st.company_id
WHERE st.company_id = 1
  AND st.service_type_code = 'SRV_LABOR'
  AND st.status = 'posted'
  AND st.work_order_id IS NOT NULL;
