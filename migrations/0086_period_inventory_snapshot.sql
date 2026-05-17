-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 0078_period_inventory_snapshot
-- Purpose:   Snapshot per-warehouse, per-item stock qty + value at period close.
--            Enables auditors to ask "what was stock on hand at end of March?"
--            without replaying all movement history.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS period_inventory_snapshots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL,
  period_id      INTEGER NOT NULL REFERENCES financial_periods(id) ON DELETE CASCADE,
  item_code      INTEGER NOT NULL,
  item_name      TEXT,
  warehouse      TEXT    NOT NULL,
  closing_qty    REAL    NOT NULL DEFAULT 0,
  closing_value  REAL    NOT NULL DEFAULT 0,
  snapshotted_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, period_id, item_code, warehouse)
);

CREATE INDEX IF NOT EXISTS idx_pinvsnap_company_period
  ON period_inventory_snapshots(company_id, period_id);
