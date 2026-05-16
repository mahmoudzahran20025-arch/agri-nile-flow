-- 0124_inventory_runtime_stabilization.sql
-- Goal: Fix schema mismatches and missing objects that cause 500 errors in Inventory/GL APIs.

-- 1. inventory_balances reconciliation
-- The table was created with 'warehouse' (TEXT) but lib/inventory_posting.ts uses 'warehouse_id' (INT).
-- This is a blocking mismatch for all movement postings.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS inventory_balances_new (
  company_id       INTEGER NOT NULL,
  item_code        INTEGER NOT NULL,
  warehouse_id     INTEGER NOT NULL REFERENCES warehouses(id),
  balance_qty      REAL    NOT NULL DEFAULT 0,
  balance_value    REAL    NOT NULL DEFAULT 0,
  version          INTEGER NOT NULL DEFAULT 0,
  last_movement_id INTEGER,
  last_updated     TEXT    NOT NULL DEFAULT (datetime('now')),
  is_stale         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, item_code, warehouse_id),
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- Attempt to migrate data if old table exists with warehouse name
-- This is safe to fail if old table doesn't exist or doesn't have 'warehouse' column.
INSERT OR IGNORE INTO inventory_balances_new 
  (company_id, item_code, warehouse_id, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
SELECT 
  ib.company_id, ib.item_code, w.id, ib.balance_qty, ib.balance_value, ib.version, ib.last_movement_id, ib.last_updated, ib.is_stale
FROM inventory_balances ib
JOIN warehouses w ON w.name = ib.warehouse AND w.company_id = ib.company_id
WHERE ib.warehouse IS NOT NULL;

-- Fallback for systems already using warehouse_id but with different PK structure
INSERT OR IGNORE INTO inventory_balances_new 
  (company_id, item_code, warehouse_id, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
SELECT 
  ib.company_id, ib.item_code, ib.warehouse_id, ib.balance_qty, ib.balance_value, ib.version, ib.last_movement_id, ib.last_updated, ib.is_stale
FROM inventory_balances ib
WHERE ib.warehouse_id IS NOT NULL;

DROP TABLE IF EXISTS inventory_balances;
ALTER TABLE inventory_balances_new RENAME TO inventory_balances;

CREATE INDEX IF NOT EXISTS idx_inv_bal_stale ON inventory_balances(company_id, is_stale);

-- 2. business_events idempotency check
-- Ensure business_events exists (canonical for hardening dashboard)
CREATE TABLE IF NOT EXISTS business_events (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  event_date TEXT NOT NULL,
  source_module TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  journal_entry_id INTEGER,
  posted_by INTEGER,
  posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(status IN ('pending','posted','error','reversed')),
  UNIQUE(company_id, source_module, source_id, event_type)
);

-- 3. inventory_running_balances VIEW
-- Satisfies reconciliation-status.ts report.
DROP VIEW IF EXISTS inventory_running_balances;
CREATE VIEW inventory_running_balances AS
SELECT 
  company_id,
  item_code,
  warehouse_id,
  balance_qty   AS running_balance_qty,
  balance_value AS running_balance_value,
  last_updated
FROM inventory_balances;

-- 4. Fix stale trigger
DROP TRIGGER IF EXISTS trg_inv_bal_mark_stale;
CREATE TRIGGER trg_inv_bal_mark_stale
AFTER INSERT ON inventory_movements
BEGIN
  UPDATE inventory_balances
  SET    is_stale = 1
  WHERE  company_id   = NEW.company_id
    AND  item_code    = NEW.item_code
    AND  warehouse_id = NEW.warehouse_id;
END;

PRAGMA foreign_keys = ON;
