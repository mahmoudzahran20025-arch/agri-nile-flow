-- 0046_backfill_inventory_journal_links.sql
-- Purpose: backfill inventory_movements.journal_entry_id from journal_entries.ref_id
-- Idempotent: updates only rows that are still NULL / not yet tagged.

-- Link inventory movements to journal entries where a deterministic key already exists.
UPDATE inventory_movements
SET journal_entry_id = (
  SELECT je.id
  FROM journal_entries je
  WHERE je.company_id = inventory_movements.company_id
    AND je.ref_type = 'inventory_movement'
    AND je.ref_id = inventory_movements.id
)
WHERE company_id = 1
  AND journal_entry_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM journal_entries je
    WHERE je.company_id = inventory_movements.company_id
      AND je.ref_type = 'inventory_movement'
      AND je.ref_id = inventory_movements.id
  );

-- Tag zero-value/unpriced rows that intentionally do not have JE linkage.
UPDATE inventory_movements
SET status = 'unpriced'
WHERE company_id = 1
  AND journal_entry_id IS NULL
  AND COALESCE(unit_price, 0) = 0
  AND COALESCE(value_in, 0) = 0
  AND COALESCE(value_out, 0) = 0
  AND COALESCE(status, '') <> 'unpriced';
