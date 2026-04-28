-- =============================================================================
-- Migration 0045: Fix purchase_orders → suppliers FK mismatch
-- =============================================================================
-- Problem:
--   purchase_orders.supplier_code  REFERENCES suppliers(id)
--   But suppliers has NO "id" column — its PK is (code, company_id).
--   This causes:  "foreign key mismatch - purchase_orders referencing suppliers"
--   whenever any INSERT/UPDATE is attempted on the suppliers table.
--
-- Fix strategy:
--   1. Drop dependent tables in reverse dependency order (all empty — 0 rows)
--   2. Drop purchase_orders
--   3. Recreate purchase_orders with:
--      a. supplier_code INTEGER (no broken single-column FK)
--      b. Correct composite FK: FOREIGN KEY (supplier_code, company_id)
--                                REFERENCES suppliers(code, company_id)
--   4. Recreate purchase_order_items with FK back to new purchase_orders
--   5. Recreate supplier_invoices and supplier_invoice_items
--
-- All tables affected have 0 rows — no data migration needed.
-- Safe to apply on clean production DB.
-- =============================================================================

PRAGMA defer_foreign_keys = TRUE;

-- ── Step 1: Drop dependent tables (most-dependent first) ─────────────────────

DROP TABLE IF EXISTS supplier_invoice_items;
DROP TABLE IF EXISTS supplier_invoices;
DROP TABLE IF EXISTS purchase_order_items;
DROP TABLE IF EXISTS purchase_orders;

-- ── Step 2: Recreate purchase_orders with correct composite FK ───────────────

CREATE TABLE purchase_orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  po_number       TEXT    NOT NULL,
  supplier_code   INTEGER,                             -- intentionally nullable: draft POs
  supplier_name   TEXT,                                -- cached name for display
  order_date      TEXT    NOT NULL,
  expected_date   TEXT,
  status          TEXT    NOT NULL DEFAULT 'draft'
                    CHECK(status IN ('draft','sent','partial','received','cancelled','closed')),
  total_amount    REAL    NOT NULL DEFAULT 0,
  notes           TEXT,
  requested_by    INTEGER REFERENCES users(id),
  approved_by     INTEGER REFERENCES users(id),
  approved_at     TEXT,
  received_by     INTEGER REFERENCES users(id),
  received_at     TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, po_number),
  -- Correct composite FK — matches suppliers' PRIMARY KEY (code, company_id)
  FOREIGN KEY (supplier_code, company_id) REFERENCES suppliers(code, company_id) ON DELETE RESTRICT
);

CREATE INDEX idx_po_company_status ON purchase_orders(company_id, status);
CREATE INDEX idx_po_supplier       ON purchase_orders(supplier_code, order_date);

-- ── Step 3: Recreate purchase_order_items ────────────────────────────────────

CREATE TABLE purchase_order_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id           INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  item_code       INTEGER,                             -- FK to items(code) if present
  item_name       TEXT    NOT NULL,
  unit            TEXT,
  qty_ordered     REAL    NOT NULL DEFAULT 1,
  qty_received    REAL    NOT NULL DEFAULT 0,
  unit_price      REAL    NOT NULL DEFAULT 0,
  total_price     REAL    GENERATED ALWAYS AS (qty_ordered * unit_price) STORED,
  notes           TEXT,
  warehouse       TEXT,
  center_code     INTEGER,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_po_items_po    ON purchase_order_items(po_id);
CREATE INDEX idx_po_items_item  ON purchase_order_items(item_code, company_id);

-- ── Step 4: Recreate supplier_invoices ───────────────────────────────────────

CREATE TABLE supplier_invoices (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  po_id           INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL,
  invoice_number  TEXT    NOT NULL,
  invoice_date    TEXT    NOT NULL,
  supplier_code   INTEGER,
  total_amount    REAL    NOT NULL DEFAULT 0,
  paid_amount     REAL    NOT NULL DEFAULT 0,
  due_date_days   INTEGER DEFAULT 30,
  payment_date    TEXT,
  payment_ref     TEXT,
  notes           TEXT,
  status          TEXT    NOT NULL DEFAULT 'draft'
                    CHECK(status IN ('draft','approved','paid','cancelled')),
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  -- Correct composite FK to suppliers
  FOREIGN KEY (supplier_code, company_id) REFERENCES suppliers(code, company_id) ON DELETE RESTRICT,
  UNIQUE(company_id, invoice_number)
);

CREATE INDEX idx_supplier_invoices_po      ON supplier_invoices(po_id, company_id);
CREATE INDEX idx_supplier_invoices_supp    ON supplier_invoices(supplier_code, company_id);

-- ── Step 5: Recreate supplier_invoice_items ──────────────────────────────────

CREATE TABLE supplier_invoice_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id    INTEGER NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  po_item_id    INTEGER REFERENCES purchase_order_items(id),
  company_id    INTEGER NOT NULL REFERENCES companies(id),
  item_code     INTEGER,
  item_name     TEXT,
  qty_invoiced  REAL    NOT NULL,
  unit_price    REAL    NOT NULL DEFAULT 0,
  total_amount  REAL    GENERATED ALWAYS AS (qty_invoiced * unit_price) STORED
);

CREATE INDEX idx_invoice_items_inv  ON supplier_invoice_items(invoice_id);
