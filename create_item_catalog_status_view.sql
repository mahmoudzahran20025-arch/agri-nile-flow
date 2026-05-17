DROP VIEW IF EXISTS vw_item_catalog_status;

CREATE VIEW vw_item_catalog_status AS
WITH movement_stats AS (
  SELECT
    company_id,
    item_code,
    COUNT(*) AS movement_count,
    SUM(COALESCE(qty_in, 0)) AS total_in,
    SUM(COALESCE(qty_out, 0)) AS total_out,
    SUM(COALESCE(qty_in, 0) - COALESCE(qty_out, 0)) AS balance_qty,
    SUM(COALESCE(value_in, 0) - COALESCE(value_out, 0)) AS balance_value
  FROM inventory_movements
  WHERE item_code IS NOT NULL
  GROUP BY company_id, item_code
)
SELECT
  i.company_id,
  i.code,
  i.name,
  i.unit,
  i.warehouse,
  i.is_active,
  COALESCE(ms.movement_count, 0) AS movement_count,
  COALESCE(ms.total_in, 0) AS total_in,
  COALESCE(ms.total_out, 0) AS total_out,
  COALESCE(ms.balance_qty, 0) AS balance_qty,
  COALESCE(ms.balance_value, 0) AS balance_value,
  CASE
    WHEN COALESCE(ms.balance_qty, 0) > 0 THEN 'in_stock'
    WHEN COALESCE(ms.movement_count, 0) > 0 THEN 'moved_zero_balance'
    ELSE 'catalog_only'
  END AS catalog_status
FROM items i
LEFT JOIN movement_stats ms
  ON ms.company_id = i.company_id
 AND ms.item_code = i.code;
