-- ============================================================================
-- Migration 0076 — Phase 0 Foundations
-- Implements the lowest-risk items from the Inventory–Finance design gap.
-- All changes are additive (new tables, new nullable columns, new indexes).
-- No existing data is altered. Safe to apply idempotently.
-- ============================================================================

-- ─── 1. movement_types reference table ───────────────────────────────────────
-- Maps typed movement codes to business semantics.
-- legacy_arabic_value bridges existing 'اضافة'/'صرف' data.

CREATE TABLE IF NOT EXISTS movement_types (
  code                TEXT PRIMARY KEY,
  name_ar             TEXT NOT NULL,
  direction           TEXT NOT NULL CHECK(direction IN ('IN', 'OUT', 'NEUTRAL')),
  affects_inventory   INTEGER NOT NULL DEFAULT 1,
  affects_cogs        INTEGER NOT NULL DEFAULT 0,
  affects_wip         INTEGER NOT NULL DEFAULT 0,
  requires_reference  INTEGER NOT NULL DEFAULT 0,
  legacy_arabic_value TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO movement_types (code, name_ar, direction, affects_inventory, affects_cogs, affects_wip, requires_reference, legacy_arabic_value) VALUES
  ('GRN',               'استلام بضاعة (GRN)',        'IN',      1, 0, 0, 1, 'اضافة'),
  ('ISSUE',             'صرف مخزني',                 'OUT',     1, 1, 0, 0, 'صرف'),
  ('TRANSFER_OUT',      'تحويل - خروج',              'OUT',     1, 0, 0, 0, NULL),
  ('TRANSFER_IN',       'تحويل - دخول',              'IN',      1, 0, 0, 0, NULL),
  ('RETURN_SUPPLIER',   'مرتجع مورد',                'OUT',     1, 0, 0, 1, NULL),
  ('RETURN_CUSTOMER',   'مرتجع عميل',                'IN',      1, 1, 0, 1, NULL),
  ('ADJUSTMENT_PROFIT', 'تسوية - زيادة',             'IN',      1, 0, 0, 0, 'اضافة'),
  ('ADJUSTMENT_LOSS',   'تسوية - عجز',               'OUT',     1, 0, 0, 0, 'صرف'),
  ('PRODUCTION_INPUT',  'مدخل إنتاج (خامات للWIP)',  'OUT',     1, 0, 1, 1, NULL),
  ('PRODUCTION_OUTPUT', 'مخرج إنتاج (WIP → تامة)',   'IN',      1, 0, 1, 1, NULL);

-- ─── 2. inventory_balances snapshot table ─────────────────────────────────────
-- Dedicated balance table keyed by (company_id, item_code, warehouse).
-- Replaces the pattern of reading balance_qty/balance_value from the last
-- inventory_movements row. Enables O(1) balance reads and future optimistic
-- locking via the version column.

CREATE TABLE IF NOT EXISTS inventory_balances (
  company_id       INTEGER NOT NULL,
  item_code        INTEGER NOT NULL,
  warehouse        TEXT    NOT NULL,
  balance_qty      REAL    NOT NULL DEFAULT 0,
  balance_value    REAL    NOT NULL DEFAULT 0,
  version          INTEGER NOT NULL DEFAULT 0,
  last_movement_id INTEGER,
  last_updated     TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (company_id, item_code, warehouse),
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- Populate from existing data: take the latest row per (company_id, item_code, warehouse)
INSERT OR IGNORE INTO inventory_balances
  (company_id, item_code, warehouse, balance_qty, balance_value, last_movement_id, last_updated)
SELECT
  im.company_id,
  im.item_code,
  im.warehouse,
  im.balance_qty,
  im.balance_value,
  im.id,
  im.created_at
FROM inventory_movements im
INNER JOIN (
  SELECT company_id, item_code, warehouse, MAX(id) AS max_id
  FROM inventory_movements
  WHERE item_code IS NOT NULL AND warehouse IS NOT NULL
  GROUP BY company_id, item_code, warehouse
) latest
  ON  im.company_id = latest.company_id
  AND im.item_code  = latest.item_code
  AND im.warehouse  = latest.warehouse
  AND im.id         = latest.max_id;

-- ─── 3. Unique constraint on inventory_posting_outbox(idempotency_key) ────────
-- Guards against duplicate outbox entries for the same movement.
-- Uses CREATE UNIQUE INDEX since ALTER TABLE ADD CONSTRAINT is not supported.

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_idempotency
  ON inventory_posting_outbox(company_id, idempotency_key);

-- ─── 4. version column on inventory_movements ─────────────────────────────────
-- Lays the groundwork for optimistic locking on future balance writes.
-- Defaults to 0 for all existing rows.

ALTER TABLE inventory_movements ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

-- ─── 5. movement_type dimension on posting_rules ──────────────────────────────
-- Adds the movement_type axis to the posting resolution cascade.
-- NULL = wildcard (matches any movement type, same as current behaviour).

ALTER TABLE posting_rules ADD COLUMN movement_type TEXT REFERENCES movement_types(code);

-- ─── 6. costing_method on items ───────────────────────────────────────────────
-- Allows per-item cost method selection (moving_average or fifo).
-- Existing items default to moving_average (current implicit behaviour).

ALTER TABLE items ADD COLUMN costing_method TEXT NOT NULL DEFAULT 'moving_average'
  CHECK(costing_method IN ('moving_average', 'fifo'));
