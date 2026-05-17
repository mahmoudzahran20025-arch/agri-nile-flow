-- Migration 0019: Backfill inventory_transactions from existing inventory_movements
-- ──────────────────────────────────────────────────────────────────────────────
-- Root cause: all 700 inventory_movements have transaction_id = NULL because
-- the inventory_transactions table was added in schema but existing migrated
-- data was never linked. This migration:
--   1. Creates one inventory_transaction header per logical document group
--      (grouped by: company_id + movement_type + document_number + warehouse + movement_date)
--   2. Links each inventory_movement to its transaction via transaction_id
--
-- ISSUE movements (which have NULL document_number) are grouped by:
--      company_id + movement_date + warehouse + movement_type + center_code
-- ──────────────────────────────────────────────────────────────────────────────

-- Step 1: Insert transaction headers for GRN movements (grouped by document_number + warehouse + date)
INSERT INTO inventory_transactions
  (company_id, transaction_type, document_number, movement_date, warehouse,
   notes, statement_text, service_type_code, line_count, total_qty, total_value,
   status, created_by_user_id)
SELECT
  company_id,
  movement_type AS transaction_type,
  document_number,
  movement_date,
  warehouse,
  notes,
  statement_text,
  service_type_code,
  COUNT(*) AS line_count,
  SUM(quantity) AS total_qty,
  SUM(value_in + value_out) AS total_value,
  'confirmed' AS status,
  MIN(created_by_user_id) AS created_by_user_id
FROM inventory_movements
WHERE company_id = 1
  AND transaction_id IS NULL
  AND movement_type = 'GRN'
  AND document_number IS NOT NULL
GROUP BY company_id, movement_type, document_number, warehouse, movement_date;

-- Step 2: Link GRN movements to their new transaction headers
UPDATE inventory_movements
SET transaction_id = (
  SELECT it.id
  FROM inventory_transactions it
  WHERE it.company_id = inventory_movements.company_id
    AND it.transaction_type = inventory_movements.movement_type
    AND it.document_number = inventory_movements.document_number
    AND it.warehouse = inventory_movements.warehouse
    AND it.movement_date = inventory_movements.movement_date
  LIMIT 1
)
WHERE company_id = 1
  AND transaction_id IS NULL
  AND movement_type = 'GRN'
  AND document_number IS NOT NULL;

-- Step 3: Insert transaction headers for ISSUE movements
-- ISSUE movements are grouped by date + warehouse + document_number (if present)
--   or by date + warehouse + center_code (if no document_number)
INSERT INTO inventory_transactions
  (company_id, transaction_type, document_number, movement_date, warehouse,
   notes, statement_text, service_type_code, line_count, total_qty, total_value,
   status, created_by_user_id)
SELECT
  company_id,
  movement_type AS transaction_type,
  document_number,
  movement_date,
  warehouse,
  notes,
  statement_text,
  service_type_code,
  COUNT(*) AS line_count,
  SUM(quantity) AS total_qty,
  SUM(value_in + value_out) AS total_value,
  'confirmed' AS status,
  MIN(created_by_user_id) AS created_by_user_id
FROM inventory_movements
WHERE company_id = 1
  AND transaction_id IS NULL
  AND movement_type = 'ISSUE'
GROUP BY company_id, movement_type, COALESCE(document_number, -1), movement_date, warehouse, COALESCE(center_code, -1);

-- Step 4: Link ISSUE movements to their new transaction headers
UPDATE inventory_movements
SET transaction_id = (
  SELECT it.id
  FROM inventory_transactions it
  WHERE it.company_id = inventory_movements.company_id
    AND it.transaction_type = inventory_movements.movement_type
    AND COALESCE(it.document_number, -1) = COALESCE(inventory_movements.document_number, -1)
    AND it.warehouse = inventory_movements.warehouse
    AND it.movement_date = inventory_movements.movement_date
  ORDER BY it.id ASC
  LIMIT 1
)
WHERE company_id = 1
  AND transaction_id IS NULL
  AND movement_type = 'ISSUE';

-- Step 5: Catch any remaining unlinked movements (safety net)
INSERT INTO inventory_transactions
  (company_id, transaction_type, document_number, movement_date, warehouse,
   notes, line_count, total_qty, total_value, status, created_by_user_id)
SELECT
  company_id,
  movement_type AS transaction_type,
  document_number,
  movement_date,
  warehouse,
  notes,
  COUNT(*) AS line_count,
  SUM(quantity) AS total_qty,
  SUM(value_in + value_out) AS total_value,
  'confirmed' AS status,
  MIN(created_by_user_id) AS created_by_user_id
FROM inventory_movements
WHERE company_id = 1
  AND transaction_id IS NULL
GROUP BY company_id, movement_type, COALESCE(document_number, -1), movement_date, warehouse;

UPDATE inventory_movements
SET transaction_id = (
  SELECT it.id
  FROM inventory_transactions it
  WHERE it.company_id = inventory_movements.company_id
    AND it.transaction_type = inventory_movements.movement_type
    AND COALESCE(it.document_number, -1) = COALESCE(inventory_movements.document_number, -1)
    AND it.warehouse = inventory_movements.warehouse
    AND it.movement_date = inventory_movements.movement_date
  ORDER BY it.id ASC
  LIMIT 1
)
WHERE company_id = 1
  AND transaction_id IS NULL;
