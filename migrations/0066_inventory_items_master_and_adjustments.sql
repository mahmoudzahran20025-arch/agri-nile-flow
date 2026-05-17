-- Migration 0066: Fix inventory items-master and adjustments endpoints on production schema

-- 1) Add missing standard_cost used by /inventory/items-master and PATCH /items-master/:code
ALTER TABLE items ADD COLUMN standard_cost REAL;

-- 2) Create physical adjustment documents tables used by /inventory/adjustments APIs
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  adjustment_date TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  posted_at TEXT,
  posted_by INTEGER,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);

CREATE TABLE IF NOT EXISTS inventory_adjustment_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adjustment_id INTEGER NOT NULL,
  item_code INTEGER NOT NULL,
  theoretical_qty REAL NOT NULL DEFAULT 0,
  counted_qty REAL NOT NULL DEFAULT 0,
  difference REAL NOT NULL DEFAULT 0,
  notes TEXT,
  FOREIGN KEY (adjustment_id) REFERENCES inventory_adjustments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_company_date
  ON inventory_adjustments(company_id, adjustment_date DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_status
  ON inventory_adjustments(company_id, status);

CREATE INDEX IF NOT EXISTS idx_inventory_adjustment_lines_adj
  ON inventory_adjustment_lines(adjustment_id);

CREATE INDEX IF NOT EXISTS idx_inventory_adjustment_lines_item
  ON inventory_adjustment_lines(item_code);
