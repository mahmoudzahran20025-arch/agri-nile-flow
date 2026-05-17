-- ============================================================
-- 0079: Backfill inventory_transactions headers for historical movements
-- ============================================================
-- All 716 pre-existing movements have transaction_id IS NULL because
-- the inventory_transactions table didn't exist when they were created.
--
-- Strategy:
--   GRN / اضافة movements: group by (movement_date, warehouse, document_number)
--     when document_number is the same — they came in together on one receipt.
--     Movements with NULL document_number each get their own header.
--
--   ISSUE / صرف movements: each gets its own header (individual draws).
--
-- The created_at on the transaction header is set to the movement_date so
-- the timeline is honest. Status = 'confirmed' (they are committed history).
-- ============================================================

-- ── Step 1: One transaction header per unique GRN document ─────────────────
-- Movements sharing movement_date + warehouse + document_number (non-null)
-- are assumed to be one physical receipt.
INSERT INTO inventory_transactions
  (company_id, transaction_type, document_number, movement_date, warehouse,
   notes, line_count, total_qty, total_value, status, created_by_user_id, created_at)
SELECT
  company_id,
  'GRN'                              AS transaction_type,
  document_number,
  movement_date,
  warehouse,
  'مرتجع محدث تلقائياً من حركات سابقة' AS notes,
  COUNT(*)                           AS line_count,
  SUM(quantity)                      AS total_qty,
  SUM(value_in)                      AS total_value,
  'confirmed'                        AS status,
  MIN(created_by_user_id)            AS created_by_user_id,
  movement_date                      AS created_at
FROM inventory_movements
WHERE company_id = 1
  AND movement_type IN ('اضافة', 'GRN')
  AND transaction_id IS NULL
  AND document_number IS NOT NULL
GROUP BY company_id, movement_date, warehouse, document_number;

-- ── Step 2: Link GRN movements (with doc number) to their new headers ───────
UPDATE inventory_movements
SET transaction_id = (
  SELECT t.id
  FROM inventory_transactions t
  WHERE t.company_id     = inventory_movements.company_id
    AND t.transaction_type = 'GRN'
    AND t.movement_date  = inventory_movements.movement_date
    AND t.warehouse      = inventory_movements.warehouse
    AND t.document_number = inventory_movements.document_number
  ORDER BY t.id DESC
  LIMIT 1
)
WHERE company_id = 1
  AND movement_type IN ('اضافة', 'GRN')
  AND transaction_id IS NULL
  AND document_number IS NOT NULL;

-- ── Step 3: One header per GRN movement with NULL document_number ───────────
-- These can't be grouped — each is its own standalone entry.
INSERT INTO inventory_transactions
  (company_id, transaction_type, document_number, movement_date, warehouse,
   notes, line_count, total_qty, total_value, status, created_by_user_id, created_at)
SELECT
  company_id,
  'GRN'       AS transaction_type,
  NULL        AS document_number,
  movement_date,
  warehouse,
  'إضافة مخزنية (مستورد من سجل قديم)' AS notes,
  1           AS line_count,
  quantity    AS total_qty,
  value_in    AS total_value,
  'confirmed' AS status,
  created_by_user_id,
  movement_date AS created_at
FROM inventory_movements
WHERE company_id = 1
  AND movement_type IN ('اضافة', 'GRN')
  AND transaction_id IS NULL
  AND document_number IS NULL;

-- ── Step 4: Link those NULL-doc GRN movements ────────────────────────────────
-- Match by id ordering: for each NULL-doc unlinked GRN movement, assign the
-- most recently created GRN header at the same date/warehouse with NULL doc.
-- SQLite doesn't support UPDATE ... JOIN, so use a correlated subquery.
UPDATE inventory_movements
SET transaction_id = (
  SELECT t.id
  FROM inventory_transactions t
  WHERE t.company_id      = inventory_movements.company_id
    AND t.transaction_type  = 'GRN'
    AND t.movement_date   = inventory_movements.movement_date
    AND t.warehouse       = inventory_movements.warehouse
    AND t.document_number IS NULL
    -- total_qty matches the single-row header we just created
    AND t.total_qty       = inventory_movements.quantity
    AND t.total_value     = inventory_movements.value_in
  ORDER BY t.id DESC
  LIMIT 1
)
WHERE company_id = 1
  AND movement_type IN ('اضافة', 'GRN')
  AND transaction_id IS NULL
  AND document_number IS NULL;

-- ── Step 5: One header per ISSUE movement ──────────────────────────────────
INSERT INTO inventory_transactions
  (company_id, transaction_type, document_number, movement_date, warehouse,
   notes, line_count, total_qty, total_value, status, created_by_user_id, created_at)
SELECT
  company_id,
  'ISSUE'     AS transaction_type,
  document_number,
  movement_date,
  warehouse,
  COALESCE(notes, 'صرف مخزني (مستورد من سجل قديم)') AS notes,
  1           AS line_count,
  quantity    AS total_qty,
  value_out   AS total_value,
  'confirmed' AS status,
  created_by_user_id,
  movement_date AS created_at
FROM inventory_movements
WHERE company_id = 1
  AND movement_type IN ('صرف', 'ISSUE')
  AND transaction_id IS NULL;

-- ── Step 6: Link ISSUE movements to their headers ───────────────────────────
-- Each ISSUE header wraps exactly one movement — match by date+warehouse+qty+value.
UPDATE inventory_movements
SET transaction_id = (
  SELECT t.id
  FROM inventory_transactions t
  WHERE t.company_id      = inventory_movements.company_id
    AND t.transaction_type  = 'ISSUE'
    AND t.movement_date   = inventory_movements.movement_date
    AND t.warehouse       = inventory_movements.warehouse
    AND t.total_qty       = inventory_movements.quantity
    AND t.total_value     = inventory_movements.value_out
    AND t.document_number IS NOT DISTINCT FROM inventory_movements.document_number
  ORDER BY t.id DESC
  LIMIT 1
)
WHERE company_id = 1
  AND movement_type IN ('صرف', 'ISSUE')
  AND transaction_id IS NULL;

-- ── Step 7: Verify — any remaining unlinked movements? ──────────────────────
-- (Informational SELECT — wrangler will show the count in output)
SELECT COUNT(*) AS still_unlinked
FROM inventory_movements
WHERE company_id = 1 AND transaction_id IS NULL;
