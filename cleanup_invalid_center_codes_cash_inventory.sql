-- Cleanup Pack: invalid center_code values in cash_transactions + inventory_movements
-- Scope: company_id = 1
-- Mode: starts as READONLY report, then optional SAFE_FIX block.

-- =============================
-- 1) READONLY AUDIT
-- =============================
WITH valid_centers AS (
  SELECT code FROM cost_centers WHERE company_id = 1 AND is_active = 1
),
invalid_cash AS (
  SELECT
    'cash_transactions' AS table_name,
    id AS row_id,
    CAST(center_code AS TEXT) AS center_code,
    transaction_date AS tx_date,
    supplier_code,
    debit,
    credit,
    amount,
    notes,
    CASE
      WHEN CAST(center_code AS TEXT) IN ('2104','210101') THEN 'NON_OPERATIONAL_CODE_KEEP_FOR_CAPITAL_FLOW'
      ELSE 'INVALID_CENTER_SET_NULL'
    END AS suggested_action
  FROM cash_transactions
  WHERE company_id = 1
    AND center_code IS NOT NULL
    AND CAST(center_code AS TEXT) NOT IN (SELECT code FROM valid_centers)
),
invalid_inventory AS (
  SELECT
    'inventory_movements' AS table_name,
    id AS row_id,
    CAST(center_code AS TEXT) AS center_code,
    movement_date AS tx_date,
    supplier_code,
    value_out AS debit,
    value_in AS credit,
    (COALESCE(value_in,0) + COALESCE(value_out,0)) AS amount,
    notes,
    CASE
      WHEN CAST(center_code AS TEXT) = CAST(supplier_code AS TEXT) THEN 'CENTER_EQUALS_SUPPLIER_CODE_SET_NULL'
      ELSE 'INVALID_CENTER_SET_NULL'
    END AS suggested_action
  FROM inventory_movements
  WHERE company_id = 1
    AND center_code IS NOT NULL
    AND CAST(center_code AS TEXT) NOT IN (SELECT code FROM valid_centers)
)
SELECT * FROM invalid_cash
UNION ALL
SELECT * FROM invalid_inventory
ORDER BY table_name, row_id;

-- Summary by invalid code
WITH valid_centers AS (
  SELECT code FROM cost_centers WHERE company_id = 1 AND is_active = 1
),
all_invalid AS (
  SELECT 'cash_transactions' AS table_name, CAST(center_code AS TEXT) AS center_code
  FROM cash_transactions
  WHERE company_id = 1 AND center_code IS NOT NULL
    AND CAST(center_code AS TEXT) NOT IN (SELECT code FROM valid_centers)
  UNION ALL
  SELECT 'inventory_movements' AS table_name, CAST(center_code AS TEXT) AS center_code
  FROM inventory_movements
  WHERE company_id = 1 AND center_code IS NOT NULL
    AND CAST(center_code AS TEXT) NOT IN (SELECT code FROM valid_centers)
)
SELECT table_name, center_code, COUNT(*) AS refs
FROM all_invalid
GROUP BY table_name, center_code
ORDER BY table_name, refs DESC;


-- =============================
-- 2) SAFE_FIX (optional)
-- =============================
-- Uncomment and run only after reviewing the audit above.
-- BEGIN TRANSACTION;
--
-- CREATE TABLE IF NOT EXISTS backup_invalid_cash_centers AS
-- SELECT * FROM cash_transactions
-- WHERE company_id = 1
--   AND center_code IS NOT NULL
--   AND CAST(center_code AS TEXT) NOT IN (
--     SELECT code FROM cost_centers WHERE company_id = 1 AND is_active = 1
--   );
--
-- CREATE TABLE IF NOT EXISTS backup_invalid_inventory_centers AS
-- SELECT * FROM inventory_movements
-- WHERE company_id = 1
--   AND center_code IS NOT NULL
--   AND CAST(center_code AS TEXT) NOT IN (
--     SELECT code FROM cost_centers WHERE company_id = 1 AND is_active = 1
--   );
--
-- -- Keep capital flow rows (2104, 210101) as-is in cash.
-- UPDATE cash_transactions
-- SET center_code = NULL
-- WHERE company_id = 1
--   AND center_code IS NOT NULL
--   AND CAST(center_code AS TEXT) NOT IN (
--     SELECT code FROM cost_centers WHERE company_id = 1 AND is_active = 1
--   )
--   AND CAST(center_code AS TEXT) NOT IN ('2104', '210101');
--
-- UPDATE inventory_movements
-- SET center_code = NULL
-- WHERE company_id = 1
--   AND center_code IS NOT NULL
--   AND CAST(center_code AS TEXT) NOT IN (
--     SELECT code FROM cost_centers WHERE company_id = 1 AND is_active = 1
--   );
--
-- COMMIT;
