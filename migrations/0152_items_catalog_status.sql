-- Migration 0152 — materialize catalog_status on items
--
-- Previously catalog_status was derived on every GET /items-master request via
-- a full CTE scan of inventory_movements. For companies with >10k movements
-- this query was expensive on every page load.
--
-- This migration adds a stored column and backfills it. The movement write path
-- (POST /movements, POST /movements/batch) already updates inventory_balances;
-- the catalog_status column is updated by the same write path in application code.
--
-- Values: 'catalog_only' | 'moved_zero_balance' | 'in_stock'

ALTER TABLE items ADD COLUMN catalog_status TEXT NOT NULL DEFAULT 'catalog_only'
  CHECK(catalog_status IN ('catalog_only', 'moved_zero_balance', 'in_stock'));

-- Backfill from current inventory_balances snapshot
UPDATE items
SET catalog_status = (
  SELECT CASE
    WHEN SUM(ib.balance_qty) > 0 THEN 'in_stock'
    ELSE 'moved_zero_balance'
  END
  FROM inventory_balances ib
  WHERE ib.company_id = items.company_id AND ib.item_code = items.code
  GROUP BY ib.item_code
)
WHERE EXISTS (
  SELECT 1 FROM inventory_balances ib
  WHERE ib.company_id = items.company_id AND ib.item_code = items.code
);

CREATE INDEX IF NOT EXISTS idx_items_catalog_status
  ON items(company_id, is_active, catalog_status);
