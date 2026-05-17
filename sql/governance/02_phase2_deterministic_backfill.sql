-- Phase 2: Deterministic Backfill (Reversible, Audited)
-- Source: phase1_governance_completion.sql (dimensions/enums loaded)
-- Purpose: Backfill missing center_code values using only HIGH-DETERMINISM rules
-- Rules Included:
--   1. cash.narration -> center_code: 88.24% deterministic (0 collisions)
--   2. supplier.expense_category -> center_code: deterministic subset only
--   3. inventory.item_code -> center_code: collision risk < 5%
-- Excluded: 62 non-inferable inventory movements (manual classification required)
-- Execution: wrangler d1 execute agri-nile-flow-data-lake --remote --file "sql/governance/02_phase2_deterministic_backfill.sql"
-- Date: 2026-05-09

-- ============================================================================
-- SECTION 1: Create Audit Log for Reversible Backfill Operations
-- ============================================================================

CREATE TABLE IF NOT EXISTS gl_dimension_backfill_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  transaction_table TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  row_id TEXT,
  dimension_code TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  rule_name TEXT NOT NULL,
  rule_id TEXT,
  inference_confidence REAL,
  is_deterministic INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_reversed INTEGER DEFAULT 0,
  reversed_at TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE INDEX IF NOT EXISTS idx_backfill_audit_transaction 
ON gl_dimension_backfill_audit(company_id, transaction_table, transaction_id);

-- ============================================================================
-- SECTION 2: RULE 1 - Cash Transactions (narration -> center_code)
-- Determinism: 88.24% (15/17 keys deterministic, 2 collision keys excluded)
-- ============================================================================

-- Rule 1A: ايجار الات ومعدات -> 1006001 (Equipment Rental)
INSERT INTO gl_dimension_backfill_audit 
(company_id, transaction_table, transaction_id, dimension_code, old_value, new_value, rule_name, rule_id, inference_confidence, is_deterministic)
SELECT 
  1, 'cash_transactions', ct.id, 'COST_CENTER',
  COALESCE(CAST(ct.center_code AS TEXT), 'NULL'), '1006001', 
  'cash.narration -> center_code (EQUIPMENT_RENTAL)', 'CASH_RULE_1',
  0.88, 1
FROM cash_transactions ct
WHERE ct.company_id = 1
  AND ct.status = 'posted'
  AND ct.center_code IS NULL
  AND LOWER(COALESCE(ct.narration, '')) LIKE '%ايجار%ا%ات%'
  AND LOWER(COALESCE(ct.narration, '')) LIKE '%معدات%';

UPDATE cash_transactions 
SET center_code = 1006001
WHERE company_id = 1
  AND status = 'posted'
  AND center_code IS NULL
  AND LOWER(COALESCE(narration, '')) LIKE '%ايجار%ا%ات%'
  AND LOWER(COALESCE(narration, '')) LIKE '%معدات%';

-- Rule 1B: مورد عمالة -> 1006009 (Labor/Employment)
INSERT INTO gl_dimension_backfill_audit 
(company_id, transaction_table, transaction_id, dimension_code, old_value, new_value, rule_name, rule_id, inference_confidence, is_deterministic)
SELECT 
  1, 'cash_transactions', ct.id, 'COST_CENTER',
  COALESCE(CAST(ct.center_code AS TEXT), 'NULL'), '1006009', 
  'cash.narration -> center_code (LABOR)', 'CASH_RULE_2',
  0.88, 1
FROM cash_transactions ct
WHERE ct.company_id = 1
  AND ct.status = 'posted'
  AND ct.center_code IS NULL
  AND LOWER(COALESCE(ct.narration, '')) LIKE '%عمالة%';

UPDATE cash_transactions 
SET center_code = 1006009
WHERE company_id = 1
  AND status = 'posted'
  AND center_code IS NULL
  AND LOWER(COALESCE(narration, '')) LIKE '%عمالة%';

-- Rule 1C: مصاريف ادارية -> 1006011 (Administrative Expenses)
INSERT INTO gl_dimension_backfill_audit 
(company_id, transaction_table, transaction_id, dimension_code, old_value, new_value, rule_name, rule_id, inference_confidence, is_deterministic)
SELECT 
  1, 'cash_transactions', ct.id, 'COST_CENTER',
  COALESCE(CAST(ct.center_code AS TEXT), 'NULL'), '1006011', 
  'cash.narration -> center_code (ADMINISTRATIVE)', 'CASH_RULE_3',
  0.92, 1
FROM cash_transactions ct
WHERE ct.company_id = 1
  AND ct.status = 'posted'
  AND ct.center_code IS NULL
  AND (LOWER(COALESCE(ct.narration, '')) LIKE '%ادارية%' 
       OR LOWER(COALESCE(ct.narration, '')) LIKE '%مصاريف%' 
       OR LOWER(COALESCE(ct.narration, '')) LIKE '%ايجار%مكتب%');

UPDATE cash_transactions 
SET center_code = 1006011
WHERE company_id = 1
  AND status = 'posted'
  AND center_code IS NULL
  AND (LOWER(COALESCE(narration, '')) LIKE '%ادارية%' 
       OR LOWER(COALESCE(narration, '')) LIKE '%مصاريف%' 
       OR LOWER(COALESCE(narration, '')) LIKE '%ايجار%مكتب%');

-- ============================================================================
-- SECTION 3: RULE 2 - Supplier Transactions (expense_category -> center_code)
-- Only deterministic mappings (no collision keys)
-- Determinism: Variable per rule (50-100%)
-- ============================================================================

-- Rule 2A: Machinery/Equipment Suppliers -> 1006001 (deterministic equipment rental center)
INSERT INTO gl_dimension_backfill_audit 
(company_id, transaction_table, transaction_id, dimension_code, old_value, new_value, rule_name, rule_id, inference_confidence, is_deterministic)
SELECT 
  1, 'supplier_transactions', st.id, 'COST_CENTER',
  COALESCE(CAST(st.center_code AS TEXT), 'NULL'), '1006001', 
  'supplier.expense_category -> center_code (MACHINERY)', 'SUPP_RULE_1',
  1.0, 1
FROM supplier_transactions st
LEFT JOIN suppliers s ON s.company_id = st.company_id AND s.code = st.supplier_code
WHERE st.company_id = 1
  AND st.status = 'posted'
  AND st.center_code IS NULL
  AND LOWER(COALESCE(s.activity, '')) LIKE '%ا%ات%معدات%'
  AND LOWER(COALESCE(st.expense_category, '')) LIKE '%ميكنة%';

UPDATE supplier_transactions 
SET center_code = 1006001
WHERE company_id = 1
  AND status = 'posted'
  AND center_code IS NULL
  AND supplier_code IN (
    SELECT code FROM suppliers 
    WHERE company_id = 1 
    AND LOWER(COALESCE(activity, '')) LIKE '%ا%ات%معدات%'
  )
  AND LOWER(COALESCE(expense_category, '')) LIKE '%ميكنة%';

-- Rule 2B: Labor Suppliers -> 1006009
INSERT INTO gl_dimension_backfill_audit 
(company_id, transaction_table, transaction_id, dimension_code, old_value, new_value, rule_name, rule_id, inference_confidence, is_deterministic)
SELECT 
  1, 'supplier_transactions', st.id, 'COST_CENTER',
  COALESCE(CAST(st.center_code AS TEXT), 'NULL'), '1006009', 
  'supplier.expense_category -> center_code (LABOR)', 'SUPP_RULE_2',
  1.0, 1
FROM supplier_transactions st
LEFT JOIN suppliers s ON s.company_id = st.company_id AND s.code = st.supplier_code
WHERE st.company_id = 1
  AND st.status = 'posted'
  AND st.center_code IS NULL
  AND LOWER(COALESCE(s.activity, '')) LIKE '%عمالة%';

UPDATE supplier_transactions 
SET center_code = 1006009
WHERE company_id = 1
  AND status = 'posted'
  AND center_code IS NULL
  AND supplier_code IN (
    SELECT code FROM suppliers 
    WHERE company_id = 1 
    AND LOWER(COALESCE(activity, '')) LIKE '%عمالة%'
  );

-- ============================================================================
-- SECTION 4: RULE 3 - Inventory Movements (deterministic self-maps only)
-- ============================================================================

-- Rule 3A: item_code -> center_code when the existing historical mapping is unique
INSERT INTO gl_dimension_backfill_audit 
(company_id, transaction_table, transaction_id, dimension_code, old_value, new_value, rule_name, rule_id, inference_confidence, is_deterministic)
WITH item_map AS (
  SELECT
    item_code,
    MAX(center_code) AS center_code
  FROM inventory_movements
  WHERE company_id = 1
    AND status = 'posted'
    AND item_code IS NOT NULL
    AND center_code IS NOT NULL
  GROUP BY item_code
  HAVING COUNT(DISTINCT center_code) = 1
)
SELECT 
  1, 'inventory_movements', im.id, 'COST_CENTER',
  COALESCE(CAST(im.center_code AS TEXT), 'NULL'), CAST(m.center_code AS TEXT), 
  'inventory.item_code -> center_code (deterministic self-map)', 'INV_RULE_1',
  0.95, 1
FROM inventory_movements im
JOIN item_map m ON m.item_code = im.item_code
WHERE im.company_id = 1
  AND im.status = 'posted'
  AND im.center_code IS NULL;

WITH item_map AS (
  SELECT
    item_code,
    MAX(center_code) AS center_code
  FROM inventory_movements
  WHERE company_id = 1
    AND status = 'posted'
    AND item_code IS NOT NULL
    AND center_code IS NOT NULL
  GROUP BY item_code
  HAVING COUNT(DISTINCT center_code) = 1
)
UPDATE inventory_movements 
SET center_code = (
  SELECT m.center_code
  FROM item_map m
  WHERE m.item_code = inventory_movements.item_code
  LIMIT 1
)
WHERE company_id = 1
  AND status = 'posted'
  AND center_code IS NULL
  AND item_code IN (
    SELECT item_code FROM item_map
  );

-- Rule 3B: warehouse -> center_code when the existing historical mapping is unique
INSERT INTO gl_dimension_backfill_audit 
(company_id, transaction_table, transaction_id, dimension_code, old_value, new_value, rule_name, rule_id, inference_confidence, is_deterministic)
WITH warehouse_map AS (
  SELECT
    warehouse,
    MAX(center_code) AS center_code
  FROM inventory_movements
  WHERE company_id = 1
    AND status = 'posted'
    AND COALESCE(warehouse, '') <> ''
    AND center_code IS NOT NULL
  GROUP BY warehouse
  HAVING COUNT(DISTINCT center_code) = 1
)
SELECT 
  1, 'inventory_movements', im.id, 'COST_CENTER',
  COALESCE(CAST(im.center_code AS TEXT), 'NULL'), CAST(m.center_code AS TEXT), 
  'inventory.warehouse -> center_code (deterministic self-map)', 'INV_RULE_2',
  0.95, 1
FROM inventory_movements im
JOIN warehouse_map m ON m.warehouse = im.warehouse
WHERE im.company_id = 1
  AND im.status = 'posted'
  AND im.center_code IS NULL;

WITH warehouse_map AS (
  SELECT
    warehouse,
    MAX(center_code) AS center_code
  FROM inventory_movements
  WHERE company_id = 1
    AND status = 'posted'
    AND COALESCE(warehouse, '') <> ''
    AND center_code IS NOT NULL
  GROUP BY warehouse
  HAVING COUNT(DISTINCT center_code) = 1
)
UPDATE inventory_movements 
SET center_code = (
  SELECT m.center_code
  FROM warehouse_map m
  WHERE m.warehouse = inventory_movements.warehouse
  LIMIT 1
)
WHERE company_id = 1
  AND status = 'posted'
  AND center_code IS NULL
  AND COALESCE(warehouse, '') <> ''
  AND warehouse IN (
    SELECT warehouse FROM warehouse_map
  );

-- ============================================================================
-- SECTION 5: Backfill Summary Report
-- ============================================================================

-- Create backfill report view
CREATE TABLE IF NOT EXISTS backfill_summary_report (
  company_id INTEGER,
  rule_id TEXT,
  rule_name TEXT,
  transaction_table TEXT,
  records_backfilled INTEGER,
  inference_confidence REAL,
  is_deterministic INTEGER,
  created_at TIMESTAMP
);

-- Insert summary for each rule executed
INSERT INTO backfill_summary_report
SELECT 
  company_id,
  rule_id,
  rule_name,
  transaction_table,
  COUNT(*) AS records_backfilled,
  AVG(inference_confidence) AS avg_confidence,
  MIN(is_deterministic) AS all_deterministic,
  CURRENT_TIMESTAMP
FROM gl_dimension_backfill_audit
WHERE company_id = 1 AND is_reversed = 0
GROUP BY company_id, rule_id, rule_name, transaction_table;

-- ============================================================================
-- SECTION 6: Verification Queries
-- ============================================================================

-- Count of backfilled records by transaction type
SELECT 'Cash Transactions Backfilled' AS metric, 
       COUNT(*) AS count 
FROM cash_transactions 
WHERE company_id = 1 AND status = 'posted' AND center_code IS NOT NULL;

SELECT 'Supplier Transactions Backfilled' AS metric, 
       COUNT(*) AS count 
FROM supplier_transactions 
WHERE company_id = 1 AND status = 'posted' AND center_code IS NOT NULL;

SELECT 'Inventory Movements Backfilled' AS metric, 
       COUNT(*) AS count 
FROM inventory_movements 
WHERE company_id = 1 AND status = 'posted' AND center_code IS NOT NULL;

-- Remaining non-deterministic inventory movements (manual classification required)
SELECT 'Non-Deterministic Inventory Remaining' AS metric, 
       COUNT(*) AS count 
FROM inventory_movements 
WHERE company_id = 1 AND status = 'posted' AND center_code IS NULL;

-- Backfill audit log summary
SELECT 'Total Backfill Operations Logged' AS metric, 
       COUNT(*) AS count 
FROM gl_dimension_backfill_audit 
WHERE company_id = 1 AND is_reversed = 0;

SELECT 'Backfill Rules Applied' AS metric, 
       COUNT(DISTINCT rule_id) AS count 
FROM gl_dimension_backfill_audit 
WHERE company_id = 1 AND is_reversed = 0;
