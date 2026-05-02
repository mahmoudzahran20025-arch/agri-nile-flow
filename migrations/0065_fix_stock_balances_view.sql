-- Migration 0065: Fix vw_stock_balances to read from inventory_movements
-- The stock_quants table is never populated by the current movement API;
-- balances are tracked as running totals in inventory_movements.balance_qty/value.
-- This view computes current stock by selecting the last row per company+item+warehouse.

DROP VIEW IF EXISTS vw_stock_balances;

CREATE VIEW vw_stock_balances AS
  SELECT
    im.company_id,
    w.id   AS warehouse_id,
    im.warehouse,
    im.item_code,
    i.name AS item_name,
    i.unit,
    im.balance_qty   AS balance_qty,
    im.balance_value AS balance_value
  FROM inventory_movements im
  JOIN warehouses w
    ON  w.company_id = im.company_id
    AND w.name       = im.warehouse
    AND w.is_active  = 1
  JOIN items i
    ON  i.code       = im.item_code
    AND i.company_id = im.company_id
  WHERE im.id IN (
    SELECT MAX(id)
    FROM   inventory_movements
    GROUP  BY company_id, item_code, warehouse
  )
  AND im.balance_qty != 0;
