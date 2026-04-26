-- Migration 0035: True Warehouse & Quant Hierarchy

CREATE TABLE IF NOT EXISTS warehouses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  name         TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'internal', -- 'internal', 'view', 'vendor', 'customer', 'inventory', 'production'
  location     TEXT,
  manager_id   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  is_active    INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS stock_quants (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  item_code    INTEGER NOT NULL,
  quantity     REAL NOT NULL DEFAULT 0,
  value        REAL NOT NULL DEFAULT 0,
  last_updated TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, warehouse_id, item_code),
  FOREIGN KEY(item_code, company_id) REFERENCES items(code, company_id)
);

ALTER TABLE inventory_movements ADD COLUMN warehouse_id INTEGER REFERENCES warehouses(id);
ALTER TABLE inventory_movements ADD COLUMN dest_warehouse_id INTEGER REFERENCES warehouses(id);

DROP VIEW IF EXISTS vw_stock_balances;
CREATE VIEW vw_stock_balances AS
SELECT 
  sq.company_id,
  sq.warehouse_id,
  w.name as warehouse_name,
  sq.item_code,
  i.name as item_name,
  i.unit,
  sq.quantity,
  sq.value
FROM stock_quants sq
JOIN warehouses w ON sq.warehouse_id = w.id
JOIN items i ON sq.item_code = i.code AND sq.company_id = i.company_id;
