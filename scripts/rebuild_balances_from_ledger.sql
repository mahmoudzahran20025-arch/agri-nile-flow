-- Rebuild inventory_balances from actual SUM aggregation of the clean ledger.
-- This replaces the incorrect snapshot that was built from m.balance_qty
-- (a running total column that reflected the old inflated duplicates).

DELETE FROM inventory_balances;

INSERT INTO inventory_balances
  (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
SELECT
  agg.company_id,
  agg.item_code,
  agg.warehouse,
  agg.balance_qty,
  agg.balance_value,
  1,
  last_mv.id,
  datetime('now'),
  0
FROM (
  SELECT
    company_id,
    item_code,
    warehouse,
    SUM(qty_in)   - SUM(qty_out)   AS balance_qty,
    SUM(value_in) - SUM(value_out) AS balance_value
  FROM inventory_movements
  GROUP BY company_id, item_code, warehouse
) agg
JOIN (
  SELECT company_id, item_code, warehouse, MAX(id) AS id
  FROM inventory_movements
  GROUP BY company_id, item_code, warehouse
) last_mv
  ON last_mv.company_id = agg.company_id
  AND last_mv.item_code  = agg.item_code
  AND last_mv.warehouse  = agg.warehouse;
