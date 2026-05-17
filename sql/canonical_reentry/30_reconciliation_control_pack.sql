-- Phase 3 reconciliation control pack
-- Run after posting job

-- 1) Null linkage checks
SELECT 'posted_supplier_without_je' AS metric, COUNT(*) AS cnt
FROM supplier_transactions
WHERE company_id = 1 AND status = 'posted' AND journal_entry_id IS NULL;

SELECT 'posted_cash_without_je' AS metric, COUNT(*) AS cnt
FROM cash_transactions
WHERE company_id = 1 AND status = 'posted' AND journal_entry_id IS NULL;

SELECT 'posted_inventory_without_je' AS metric, COUNT(*) AS cnt
FROM inventory_movements
WHERE company_id = 1
  AND status = 'posted'
  AND movement_type IN ('GRN', 'ISSUE')
  AND journal_entry_id IS NULL;

-- 2) Future-dated posted JEs
SELECT 'future_dated_posted_je' AS metric, COUNT(*) AS cnt
FROM journal_entries
WHERE company_id = 1
  AND is_posted = 1
  AND date(entry_date) > date('now');

-- 3) Mandatory semantic fields
SELECT 'posted_supplier_missing_service_type' AS metric, COUNT(*) AS cnt
FROM supplier_transactions
WHERE company_id = 1
  AND status = 'posted'
  AND (service_type_code IS NULL OR LENGTH(TRIM(service_type_code)) = 0);

SELECT 'posted_supplier_missing_statement' AS metric, COUNT(*) AS cnt
FROM supplier_transactions
WHERE company_id = 1
  AND status = 'posted'
  AND (statement_text IS NULL OR LENGTH(TRIM(statement_text)) < 3);

SELECT 'posted_issue_missing_center_or_service' AS metric, COUNT(*) AS cnt
FROM inventory_movements
WHERE company_id = 1
  AND status = 'posted'
  AND movement_type = 'ISSUE'
  AND (center_code IS NULL OR service_type_code IS NULL OR LENGTH(TRIM(service_type_code)) = 0);

-- 4) Supplier-service authorization drift
SELECT 'supplier_service_unauthorized' AS metric, COUNT(*) AS cnt
FROM supplier_transactions st
LEFT JOIN supplier_service_map ssm
  ON ssm.company_id = st.company_id
 AND ssm.supplier_code = st.supplier_code
 AND ssm.service_type_code = st.service_type_code
 AND ssm.is_active = 1
WHERE st.company_id = 1
  AND st.status = 'posted'
  AND st.supplier_code IS NOT NULL
  AND st.service_type_code IS NOT NULL
  AND ssm.id IS NULL;

-- 5) AP sub-ledger vs GL control account
WITH ap_subledger AS (
  SELECT COALESCE(SUM(credit - debit), 0) AS amount
  FROM supplier_transactions
  WHERE company_id = 1
    AND status = 'posted'
),
ap_gl AS (
  SELECT COALESCE(SUM(jel.credit - jel.debit), 0) AS amount
  FROM journal_entry_lines jel
  JOIN journal_entries je
    ON je.company_id = jel.company_id
   AND je.id = jel.entry_id
   AND je.is_posted = 1
  WHERE jel.company_id = 1
    AND jel.account_code IN (
      SELECT account_code
      FROM posting_rules
      WHERE company_id = 1
        AND rule_type = 'control'
        AND mapping_key = 'accounts_payable'
        AND is_active = 1
    )
)
SELECT
  'ap_subledger_vs_gl' AS metric,
  ap_subledger.amount AS subledger_amount,
  ap_gl.amount AS gl_amount,
  ROUND(ap_subledger.amount - ap_gl.amount, 2) AS variance
FROM ap_subledger, ap_gl;

-- 6) Inventory GRN/ISSUE value parity with GL inventory control account
WITH inv_subledger AS (
  SELECT COALESCE(SUM(value_in - value_out), 0) AS amount
  FROM inventory_movements
  WHERE company_id = 1
    AND status = 'posted'
),
inv_gl AS (
  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS amount
  FROM journal_entry_lines jel
  JOIN journal_entries je
    ON je.company_id = jel.company_id
   AND je.id = jel.entry_id
   AND je.is_posted = 1
  WHERE jel.company_id = 1
    AND jel.account_code IN (
      SELECT account_code
      FROM posting_rules
      WHERE company_id = 1
        AND rule_type = 'control'
        AND mapping_key = 'inventory'
        AND is_active = 1
    )
)
SELECT
  'inventory_subledger_vs_gl' AS metric,
  inv_subledger.amount AS subledger_amount,
  inv_gl.amount AS gl_amount,
  ROUND(inv_subledger.amount - inv_gl.amount, 2) AS variance
FROM inv_subledger, inv_gl;
