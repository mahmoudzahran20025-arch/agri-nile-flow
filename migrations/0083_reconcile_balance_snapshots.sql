-- =============================================================================
-- Migration 0083: Reconcile Balance Snapshot Mismatches
-- Date: 2026-05-04
-- =============================================================================
-- Audit found 16 inventory_balances rows where snapshot != movement ledger sum.
-- Root cause: opening balances were inserted directly into inventory_balances
-- without corresponding movement records. The snapshots are out of sync.
--
-- Strategy:
--   Mark all mismatched rows is_stale=1.
--   readInventoryBalance() will detect is_stale=1, recompute from the movement
--   ledger (SUM of qty_in - qty_out on last movement), and heal the snapshot.
--   This is safe — no data is deleted, no manual value is inserted.
--
-- For the 4 negative ledger positions: is_stale=1 will also trigger heal,
-- which will surface the true negative balance so ops team can see it clearly
-- rather than hiding behind a stale snapshot.
-- =============================================================================

UPDATE inventory_balances
SET is_stale = 1
WHERE (company_id, item_code, warehouse) IN (
  -- Find rows where snapshot disagrees with the movement ledger by more than 0.001
  SELECT ib.company_id, ib.item_code, ib.warehouse
  FROM inventory_balances ib
  LEFT JOIN (
    SELECT
      company_id,
      item_code,
      warehouse,
      balance_qty   AS ledger_qty,
      balance_value AS ledger_value
    FROM inventory_movements im_last
    WHERE id IN (
      SELECT MAX(id)
      FROM inventory_movements
      GROUP BY company_id, item_code, warehouse
    )
  ) ledger ON ledger.company_id = ib.company_id
           AND ledger.item_code  = ib.item_code
           AND ledger.warehouse  = ib.warehouse
  WHERE ABS(COALESCE(ledger.ledger_qty, 0) - ib.balance_qty) > 0.001
     OR ledger.ledger_qty IS NULL
);

-- =============================================================================
-- Verification query (run after applying):
-- SELECT COUNT(*) FROM inventory_balances WHERE is_stale = 1;
-- Should return ~16 (the mismatched rows).
-- After the next readInventoryBalance() call on each, they self-heal to 0.
-- =============================================================================
