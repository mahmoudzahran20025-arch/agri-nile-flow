-- Orderly backfill of inventory_balances from movement history
DELETE FROM inventory_balances WHERE company_id = 1;

INSERT INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated)
SELECT 
  im.company_id,
  im.item_code,
  im.warehouse,
  SUM(CASE WHEN im.movement_type = 'GRN' THEN im.quantity ELSE -im.quantity END) as balance_qty,
  SUM(CASE WHEN im.movement_type = 'GRN' THEN im.value_in ELSE -im.value_out END) as balance_value,
  1,
  MAX(im.id),
  datetime('now')
FROM inventory_movements im
WHERE im.company_id = 1
GROUP BY im.company_id, im.item_code, im.warehouse;

-- Verify
SELECT COUNT(*) as unique_balances, SUM(balance_qty) as total_qty, SUM(balance_value) as total_value
FROM inventory_balances
WHERE company_id = 1;
