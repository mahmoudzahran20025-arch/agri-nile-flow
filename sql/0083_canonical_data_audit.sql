-- 0083_canonical_data_audit.sql
-- Purpose: Canonical data audit for financial dimensions and posting integrity.
-- Scope: company_id = 1
-- Mode: READ ONLY (no data changes)

-- ============================================================================
-- A) CORE CANONICAL KPI SNAPSHOT
-- ============================================================================

SELECT 'coa_total' AS metric, COUNT(*) AS value
FROM chart_of_accounts
WHERE company_id = 1;

SELECT 'coa_duplicate_codes' AS metric, COUNT(*) AS value
FROM (
  SELECT code
  FROM chart_of_accounts
  WHERE company_id = 1
  GROUP BY code
  HAVING COUNT(*) > 1
);

SELECT 'jel_orphan_account_code' AS metric, COUNT(*) AS value
FROM journal_entry_lines jel
LEFT JOIN chart_of_accounts coa
  ON coa.company_id = jel.company_id
 AND coa.code = CAST(jel.account_code AS TEXT)
WHERE jel.company_id = 1
  AND coa.code IS NULL;

SELECT 'jel_header_account_usage' AS metric, COUNT(*) AS value
FROM journal_entry_lines jel
JOIN chart_of_accounts coa
  ON coa.company_id = jel.company_id
 AND coa.code = CAST(jel.account_code AS TEXT)
WHERE jel.company_id = 1
  AND coa.is_header = 1;

SELECT 'jel_inactive_account_usage' AS metric, COUNT(*) AS value
FROM journal_entry_lines jel
JOIN chart_of_accounts coa
  ON coa.company_id = jel.company_id
 AND coa.code = CAST(jel.account_code AS TEXT)
WHERE jel.company_id = 1
  AND coa.is_active = 0;

SELECT 'journal_duplicate_by_source' AS metric, COUNT(*) AS value
FROM (
  SELECT company_id, ref_type, ref_id, COUNT(*) AS c
  FROM journal_entries
  WHERE company_id = 1
    AND ref_type IN ('supplier_transaction', 'cash_transaction', 'inventory_movement')
  GROUP BY company_id, ref_type, ref_id
  HAVING COUNT(*) > 1
);

SELECT 'manual_reclass_entries_detected' AS metric, COUNT(*) AS value
FROM journal_entries
WHERE company_id = 1
  AND (
    local_id LIKE 'reclass_%'
    OR description LIKE 'إعادة تصنيف%'
  );

-- ============================================================================
-- B) SUPPLIER CANONICAL INTEGRITY
-- ============================================================================

SELECT 'supplier_posted_total' AS metric, COUNT(*) AS value
FROM supplier_transactions
WHERE company_id = 1
  AND status = 'posted';

SELECT 'supplier_posted_missing_supplier_master' AS metric, COUNT(*) AS value
FROM supplier_transactions st
LEFT JOIN suppliers s
  ON s.company_id = st.company_id
 AND s.code = st.supplier_code
WHERE st.company_id = 1
  AND st.status = 'posted'
  AND COALESCE(st.amount, 0) <> 0
  AND st.supplier_code IS NOT NULL
  AND s.code IS NULL;

SELECT 'supplier_posted_missing_supplier_code' AS metric, COUNT(*) AS value
FROM supplier_transactions st
WHERE st.company_id = 1
  AND st.status = 'posted'
  AND COALESCE(st.amount, 0) <> 0
  AND st.supplier_code IS NULL;

SELECT 'supplier_posted_missing_journal_link' AS metric, COUNT(*) AS value
FROM supplier_transactions st
LEFT JOIN journal_entries je
  ON je.company_id = st.company_id
 AND je.id = st.journal_entry_id
WHERE st.company_id = 1
  AND st.status = 'posted'
  AND COALESCE(st.amount, 0) <> 0
  AND (st.journal_entry_id IS NULL OR je.id IS NULL);

SELECT 'supplier_master_missing_gl_account' AS metric, COUNT(*) AS value
FROM suppliers s
WHERE s.company_id = 1
  AND s.is_active = 1
  AND s.gl_account_code IS NULL;

SELECT 'supplier_master_gl_not_in_coa' AS metric, COUNT(*) AS value
FROM suppliers s
LEFT JOIN chart_of_accounts coa
  ON coa.company_id = s.company_id
 AND coa.code = CAST(s.gl_account_code AS TEXT)
WHERE s.company_id = 1
  AND s.is_active = 1
  AND s.gl_account_code IS NOT NULL
  AND coa.code IS NULL;

-- ============================================================================
-- C) TREASURY / CASH CANONICAL INTEGRITY
-- ============================================================================

SELECT 'cash_posted_total' AS metric, COUNT(*) AS value
FROM cash_transactions
WHERE company_id = 1
  AND status = 'posted';

SELECT 'cash_posted_missing_journal_link' AS metric, COUNT(*) AS value
FROM cash_transactions c
LEFT JOIN journal_entries je
  ON je.company_id = c.company_id
 AND je.id = c.journal_entry_id
WHERE c.company_id = 1
  AND c.status = 'posted'
  AND COALESCE(c.amount, 0) <> 0
  AND (c.journal_entry_id IS NULL OR je.id IS NULL);

SELECT 'cash_posted_invalid_center_code' AS metric, COUNT(*) AS value
FROM cash_transactions c
LEFT JOIN cost_centers cc
  ON cc.company_id = c.company_id
 AND cc.code = CAST(c.center_code AS TEXT)
WHERE c.company_id = 1
  AND c.status = 'posted'
  AND c.center_code IS NOT NULL
  AND cc.code IS NULL;

-- ============================================================================
-- D) INVENTORY CANONICAL INTEGRITY
-- ============================================================================

SELECT 'inventory_posted_total' AS metric, COUNT(*) AS value
FROM inventory_movements
WHERE company_id = 1
  AND status = 'posted';

SELECT 'inventory_posted_missing_journal_link' AS metric, COUNT(*) AS value
FROM inventory_movements im
LEFT JOIN journal_entries je
  ON je.company_id = im.company_id
 AND je.id = im.journal_entry_id
WHERE im.company_id = 1
  AND im.status = 'posted'
  AND (COALESCE(im.value_in, 0) <> 0 OR COALESCE(im.value_out, 0) <> 0)
  AND (im.journal_entry_id IS NULL OR je.id IS NULL);

-- Purchase Receipt requires supplier dimension (NOT center_code).
SELECT 'inventory_receipt_missing_supplier' AS metric, COUNT(*) AS value
FROM inventory_movements im
WHERE im.company_id = 1
  AND im.status = 'posted'
  AND COALESCE(im.value_in, 0) > 0
  AND COALESCE(im.qty_in, 0) > 0
  AND (im.movement_type = 'اضافة' OR UPPER(im.movement_type) IN ('RECEIPT', 'GRN'))
  AND im.supplier_code IS NULL;

-- Inventory consumption requires cost center dimension.
SELECT 'inventory_consumption_missing_center' AS metric, COUNT(*) AS value
FROM inventory_movements im
WHERE im.company_id = 1
  AND im.status = 'posted'
  AND COALESCE(im.value_out, 0) > 0
  AND COALESCE(im.qty_out, 0) > 0
  AND (im.movement_type = 'صرف' OR UPPER(im.movement_type) IN ('ISSUE', 'CONSUMPTION'))
  AND im.center_code IS NULL;

-- Transfer requires from+to warehouse dimensions.
SELECT 'inventory_transfer_missing_wh_dim' AS metric, COUNT(*) AS value
FROM inventory_movements im
WHERE im.company_id = 1
  AND im.status = 'posted'
  AND (im.movement_type = 'تحويل' OR UPPER(im.movement_type) IN ('TRANSFER'))
  AND (im.warehouse_id IS NULL OR im.dest_warehouse_id IS NULL);

SELECT 'inventory_missing_warehouse_id_total' AS metric, COUNT(*) AS value
FROM inventory_movements im
WHERE im.company_id = 1
  AND im.status = 'posted'
  AND im.warehouse_id IS NULL;

SELECT 'inventory_missing_warehouse_id_resolvable_by_name' AS metric, COUNT(*) AS value
FROM inventory_movements im
JOIN warehouses w
  ON w.company_id = im.company_id
 AND w.name = im.warehouse
WHERE im.company_id = 1
  AND im.status = 'posted'
  AND im.warehouse_id IS NULL;

-- NOTE: D1 runtime has strict limits on compound SELECT terms, so this section
-- emits one row per query instead of UNION ALL.

SELECT
  'Purchase Receipt' AS transaction_type,
  COUNT(*) AS total_rows,
  SUM(CASE WHEN supplier_code IS NOT NULL THEN 1 ELSE 0 END) AS compliant_rows,
  COUNT(*) - SUM(CASE WHEN supplier_code IS NOT NULL THEN 1 ELSE 0 END) AS non_compliant_rows,
  CASE
    WHEN COUNT(*) = 0 THEN 100.0
    ELSE ROUND(100.0 * SUM(CASE WHEN supplier_code IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2)
  END AS compliance_pct
FROM inventory_movements
WHERE company_id = 1
  AND status = 'posted'
  AND COALESCE(value_in, 0) > 0
  AND COALESCE(qty_in, 0) > 0
  AND (movement_type = 'اضافة' OR UPPER(movement_type) IN ('RECEIPT', 'GRN'));

SELECT
  'Inventory Consumption' AS transaction_type,
  COUNT(*) AS total_rows,
  SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) AS compliant_rows,
  COUNT(*) - SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) AS non_compliant_rows,
  CASE
    WHEN COUNT(*) = 0 THEN 100.0
    ELSE ROUND(100.0 * SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2)
  END AS compliance_pct
FROM inventory_movements
WHERE company_id = 1
  AND status = 'posted'
  AND COALESCE(value_out, 0) > 0
  AND COALESCE(qty_out, 0) > 0
  AND (movement_type = 'صرف' OR UPPER(movement_type) IN ('ISSUE', 'CONSUMPTION'));

SELECT
  'Asset Purchase' AS transaction_type,
  COUNT(*) AS total_rows,
  SUM(CASE WHEN supplier_code IS NOT NULL AND COALESCE(TRIM(equipment), '') <> '' THEN 1 ELSE 0 END) AS compliant_rows,
  COUNT(*) - SUM(CASE WHEN supplier_code IS NOT NULL AND COALESCE(TRIM(equipment), '') <> '' THEN 1 ELSE 0 END) AS non_compliant_rows,
  CASE
    WHEN COUNT(*) = 0 THEN 100.0
    ELSE ROUND(100.0 * SUM(CASE WHEN supplier_code IS NOT NULL AND COALESCE(TRIM(equipment), '') <> '' THEN 1 ELSE 0 END) / COUNT(*), 2)
  END AS compliance_pct
FROM supplier_transactions
WHERE company_id = 1
  AND status = 'posted'
  AND COALESCE(amount, 0) > 0
  AND COALESCE(TRIM(equipment), '') <> '';

SELECT
  'Treasury Payment' AS transaction_type,
  COUNT(*) AS total_rows,
  SUM(CASE WHEN financial_account_id IS NOT NULL OR expense_code IS NOT NULL THEN 1 ELSE 0 END) AS compliant_rows,
  COUNT(*) - SUM(CASE WHEN financial_account_id IS NOT NULL OR expense_code IS NOT NULL THEN 1 ELSE 0 END) AS non_compliant_rows,
  CASE
    WHEN COUNT(*) = 0 THEN 100.0
    ELSE ROUND(100.0 * SUM(CASE WHEN financial_account_id IS NOT NULL OR expense_code IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2)
  END AS compliance_pct
FROM cash_transactions
WHERE company_id = 1
  AND status = 'posted'
  AND direction = 'م'
  AND COALESCE(amount, 0) > 0;

SELECT
  'Supplier Payment' AS transaction_type,
  COUNT(*) AS total_rows,
  SUM(CASE WHEN supplier_code IS NOT NULL THEN 1 ELSE 0 END) AS compliant_rows,
  COUNT(*) - SUM(CASE WHEN supplier_code IS NOT NULL THEN 1 ELSE 0 END) AS non_compliant_rows,
  CASE
    WHEN COUNT(*) = 0 THEN 100.0
    ELSE ROUND(100.0 * SUM(CASE WHEN supplier_code IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2)
  END AS compliance_pct
FROM supplier_transactions
WHERE company_id = 1
  AND status = 'posted'
  AND entry_type = 'م'
  AND COALESCE(amount, 0) > 0;

SELECT
  'Inventory Transfer' AS transaction_type,
  COUNT(*) AS total_rows,
  SUM(CASE WHEN warehouse_id IS NOT NULL AND dest_warehouse_id IS NOT NULL THEN 1 ELSE 0 END) AS compliant_rows,
  COUNT(*) - SUM(CASE WHEN warehouse_id IS NOT NULL AND dest_warehouse_id IS NOT NULL THEN 1 ELSE 0 END) AS non_compliant_rows,
  CASE
    WHEN COUNT(*) = 0 THEN 100.0
    ELSE ROUND(100.0 * SUM(CASE WHEN warehouse_id IS NOT NULL AND dest_warehouse_id IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2)
  END AS compliance_pct
FROM inventory_movements
WHERE company_id = 1
  AND status = 'posted'
  AND (movement_type = 'تحويل' OR UPPER(movement_type) IN ('TRANSFER'));

-- ============================================================================
-- F) INVESTIGATION DETAILS (TOP SAMPLE)
-- ============================================================================

SELECT
  id,
  movement_date,
  movement_type,
  item_code,
  warehouse,
  warehouse_id,
  supplier_code,
  qty_in,
  value_in,
  journal_entry_id,
  notes
FROM inventory_movements
WHERE company_id = 1
  AND status = 'posted'
  AND COALESCE(value_in, 0) > 0
  AND COALESCE(qty_in, 0) > 0
  AND (movement_type = 'اضافة' OR UPPER(movement_type) IN ('RECEIPT', 'GRN'))
  AND supplier_code IS NULL
ORDER BY movement_date DESC, id DESC
LIMIT 100;
