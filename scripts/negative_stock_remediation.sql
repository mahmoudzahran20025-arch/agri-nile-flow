-- Negative Stock Historical Remediation (safe staged workflow)
-- Target: company_id = 1 (edit as needed)
-- Run remotely:
-- npx wrangler d1 execute agri-nile-flow-data-lake --remote --file=./scripts/negative_stock_remediation.sql

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS inventory_negative_stock_fix_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  item_code INTEGER NOT NULL,
  warehouse TEXT NOT NULL,
  source_movement_id INTEGER NOT NULL,
  current_balance_qty REAL NOT NULL,
  current_balance_value REAL NOT NULL,
  fix_quantity REAL NOT NULL,
  suggested_unit_price REAL NOT NULL,
  suggested_value_in REAL NOT NULL,
  plan_note TEXT,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  applied_at TEXT,
  applied_movement_id INTEGER
);

DELETE FROM inventory_negative_stock_fix_plan
WHERE company_id = 1 AND applied_at IS NULL;

WITH latest_by_item_wh AS (
  SELECT
    im.company_id,
    im.item_code,
    im.warehouse,
    MAX(im.id) AS max_id
  FROM inventory_movements im
  WHERE im.company_id = 1
  GROUP BY im.company_id, im.item_code, im.warehouse
),
negatives AS (
  SELECT
    lb.company_id,
    lb.item_code,
    lb.warehouse,
    im.id AS source_movement_id,
    COALESCE(im.balance_qty, 0) AS balance_qty,
    COALESCE(im.balance_value, 0) AS balance_value,
    COALESCE(i.standard_cost, 0) AS standard_cost,
    i.name AS item_name
  FROM latest_by_item_wh lb
  JOIN inventory_movements im ON im.id = lb.max_id
  LEFT JOIN items i ON i.company_id = lb.company_id AND i.code = lb.item_code
  WHERE COALESCE(im.balance_qty, 0) < 0
)
INSERT INTO inventory_negative_stock_fix_plan (
  company_id,
  item_code,
  warehouse,
  source_movement_id,
  current_balance_qty,
  current_balance_value,
  fix_quantity,
  suggested_unit_price,
  suggested_value_in,
  plan_note
)
SELECT
  n.company_id,
  n.item_code,
  n.warehouse,
  n.source_movement_id,
  n.balance_qty,
  n.balance_value,
  ABS(n.balance_qty) AS fix_quantity,
  CASE
    WHEN n.standard_cost > 0 THEN n.standard_cost
    WHEN ABS(n.balance_qty) > 0 THEN ABS(n.balance_value) / ABS(n.balance_qty)
    ELSE 0
  END AS suggested_unit_price,
  ABS(n.balance_qty) * CASE
    WHEN n.standard_cost > 0 THEN n.standard_cost
    WHEN ABS(n.balance_qty) > 0 THEN ABS(n.balance_value) / ABS(n.balance_qty)
    ELSE 0
  END AS suggested_value_in,
  'Auto-generated plan from latest negative balance snapshot'
FROM negatives n;

-- Summary
SELECT
  COUNT(*) AS planned_rows,
  COUNT(DISTINCT item_code) AS planned_items,
  COUNT(DISTINCT warehouse) AS planned_warehouses,
  ROUND(SUM(fix_quantity), 3) AS total_fix_qty,
  ROUND(SUM(suggested_value_in), 3) AS total_fix_value
FROM inventory_negative_stock_fix_plan
WHERE company_id = 1 AND applied_at IS NULL;

-- Detailed plan (review before applying)
SELECT
  item_code,
  warehouse,
  current_balance_qty,
  current_balance_value,
  fix_quantity,
  suggested_unit_price,
  suggested_value_in,
  plan_note
FROM inventory_negative_stock_fix_plan
WHERE company_id = 1 AND applied_at IS NULL
ORDER BY ABS(current_balance_qty) DESC, item_code, warehouse;

-- Optional: generate executable INSERT statements (copy/paste after manual review)
SELECT
  'INSERT INTO inventory_movements (company_id, item_code, movement_date, warehouse, movement_type, quantity, unit_price, qty_in, qty_out, balance_qty, value_in, value_out, balance_value, notes, year, month, created_by_user_id, local_id, posting_mode, gl_posting_status) VALUES (' ||
  company_id || ', ' ||
  item_code || ', ' ||
  quote(date('now')) || ', ' ||
  quote(warehouse) || ', ' ||
  quote('اضافة') || ', ' ||
  fix_quantity || ', ' ||
  suggested_unit_price || ', ' ||
  fix_quantity || ', 0, 0, ' ||
  suggested_value_in || ', 0, 0, ' ||
  quote('Historical negative stock remediation') || ', ' ||
  strftime('%Y', 'now') || ', ' ||
  strftime('%m', 'now') || ', 1, ' ||
  quote('neg_fix_' || company_id || '_' || item_code || '_' || replace(warehouse, ' ', '_') || '_' || strftime('%s', 'now')) || ', ' ||
  quote('decoupled') || ', ' ||
  quote('decoupled') || ');' AS generated_insert_sql
FROM inventory_negative_stock_fix_plan
WHERE company_id = 1 AND applied_at IS NULL;
