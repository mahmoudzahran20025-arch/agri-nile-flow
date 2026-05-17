-- 0084_canonical_data_remediation.sql
-- Purpose: Canonical remediation actions that UPDATE existing records only.
-- Scope: company_id = 1
-- Strategy: deterministic updates first; unresolved rows remain in explicit queue.

-- ============================================================================
-- 1) Deterministic warehouse dimension remediation
-- Backfill inventory_movements.warehouse_id from canonical warehouses.name.
-- This is safe because every missing row is resolvable by exact name match.
-- ============================================================================

UPDATE inventory_movements
SET warehouse_id = (
  SELECT w.id
  FROM warehouses w
  WHERE w.company_id = inventory_movements.company_id
    AND w.name = inventory_movements.warehouse
  LIMIT 1
)
WHERE company_id = 1
  AND status = 'posted'
  AND warehouse_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM warehouses w
    WHERE w.company_id = inventory_movements.company_id
      AND w.name = inventory_movements.warehouse
  );

-- ============================================================================
-- 2) Governance correction for GRN dimension policy tag
-- Old notes labeled NEEDS_DIMENSION:center_code on GRN rows.
-- Correct policy is supplier dimension for purchase receipt.
-- ============================================================================

UPDATE inventory_movements
SET notes = REPLACE(notes, 'NEEDS_DIMENSION:center_code', 'NEEDS_DIMENSION:supplier_code')
WHERE company_id = 1
  AND status = 'posted'
  AND (movement_type = 'اضافة' OR UPPER(movement_type) IN ('RECEIPT', 'GRN'))
  AND supplier_code IS NULL
  AND notes LIKE '%NEEDS_DIMENSION:center_code%';

-- ============================================================================
-- 3) Post-remediation verification
-- ============================================================================

SELECT 'inventory_missing_warehouse_id_total_after' AS metric, COUNT(*) AS value
FROM inventory_movements
WHERE company_id = 1
  AND status = 'posted'
  AND warehouse_id IS NULL;

SELECT 'inventory_receipt_missing_supplier_after' AS metric, COUNT(*) AS value
FROM inventory_movements
WHERE company_id = 1
  AND status = 'posted'
  AND COALESCE(value_in, 0) > 0
  AND COALESCE(qty_in, 0) > 0
  AND (movement_type = 'اضافة' OR UPPER(movement_type) IN ('RECEIPT', 'GRN'))
  AND supplier_code IS NULL;

SELECT 'inventory_notes_need_supplier_dimension_after' AS metric, COUNT(*) AS value
FROM inventory_movements
WHERE company_id = 1
  AND status = 'posted'
  AND (movement_type = 'اضافة' OR UPPER(movement_type) IN ('RECEIPT', 'GRN'))
  AND supplier_code IS NULL
  AND notes LIKE '%NEEDS_DIMENSION:supplier_code%';

-- ============================================================================
-- 4) Unresolved queue (manual remediation candidate list)
-- NOTE: no INSERT into new queue table; this is a review dataset for controlled fix.
-- ============================================================================

SELECT
  im.id,
  im.movement_date,
  im.movement_type,
  im.item_code,
  im.warehouse,
  im.warehouse_id,
  im.document_number,
  im.invoice_number,
  im.po_number,
  im.qty_in,
  im.value_in,
  im.journal_entry_id,
  im.notes
FROM inventory_movements im
WHERE im.company_id = 1
  AND im.status = 'posted'
  AND COALESCE(im.value_in, 0) > 0
  AND COALESCE(im.qty_in, 0) > 0
  AND (im.movement_type = 'اضافة' OR UPPER(im.movement_type) IN ('RECEIPT', 'GRN'))
  AND im.supplier_code IS NULL
ORDER BY im.movement_date DESC, im.id DESC;
