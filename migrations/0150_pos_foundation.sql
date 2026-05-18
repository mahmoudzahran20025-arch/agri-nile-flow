-- Migration 0150 — POS Foundation Schema
--
-- Shared foundation for both agricultural sales and retail POS.
-- Deliberately minimal — does NOT implement full POS session management or receipt flow.
-- P2-C4/C5 (sales_sessions, sales_orders) are added here as skeletal tables;
-- full implementation requires P2-H3/H4 API endpoints.
--
-- Design principles:
--   customers: walk-in customer seeded as WALKIN; no credit required for basic sales
--   SALE movement type: added to posting_rules slot; governance enforced in movements.ts
--   branch_id on warehouses: makes "sell from branch stock" a warehouse lookup
--   sales_sessions + sales_orders: schema-ready, API not yet wired

-- ── customers ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL,
  code         TEXT    NOT NULL,
  name         TEXT    NOT NULL,
  phone        TEXT,
  credit_limit REAL    NOT NULL DEFAULT 0,
  balance      REAL    NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, code)
);

-- Seed walk-in customer for every active company
INSERT OR IGNORE INTO customers (company_id, code, name, is_active)
SELECT id, 'WALKIN', 'عميل نقدي (زيارة)', 1
FROM companies WHERE is_active = 1;

-- ── warehouses.branch_id ─────────────────────────────────────────────────────
ALTER TABLE warehouses ADD COLUMN branch_id INTEGER REFERENCES branches(id);

-- ── sales_sessions (cashier shift) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales_sessions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL,
  branch_id        INTEGER REFERENCES branches(id),
  cashier_user_id  INTEGER NOT NULL,
  opened_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  closed_at        TEXT,
  opening_float    REAL    NOT NULL DEFAULT 0,
  closing_count    REAL,
  status           TEXT    NOT NULL DEFAULT 'open'
                           CHECK(status IN ('open', 'closed', 'reconciled')),
  FOREIGN KEY (company_id, cashier_user_id) REFERENCES users(company_id, id)
);

-- ── sales_orders ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales_orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL,
  session_id     INTEGER REFERENCES sales_sessions(id),
  branch_id      INTEGER REFERENCES branches(id),
  warehouse_id   INTEGER,
  customer_id    INTEGER REFERENCES customers(id),
  order_date     TEXT    NOT NULL,
  subtotal       REAL    NOT NULL DEFAULT 0,
  tax_amount     REAL    NOT NULL DEFAULT 0,
  total          REAL    NOT NULL DEFAULT 0,
  payment_method TEXT    NOT NULL DEFAULT 'cash'
                         CHECK(payment_method IN ('cash', 'card', 'credit')),
  status         TEXT    NOT NULL DEFAULT 'open'
                         CHECK(status IN ('open', 'paid', 'voided')),
  notes          TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── sales_order_items ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales_order_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES sales_orders(id),
  company_id   INTEGER NOT NULL,
  item_code    INTEGER NOT NULL,
  quantity     REAL    NOT NULL,
  unit_price   REAL    NOT NULL,
  discount_pct REAL    NOT NULL DEFAULT 0,
  line_total   REAL    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_company
  ON customers(company_id, is_active, code);

CREATE INDEX IF NOT EXISTS idx_sales_orders_company_date
  ON sales_orders(company_id, order_date DESC);

CREATE INDEX IF NOT EXISTS idx_sales_sessions_company
  ON sales_sessions(company_id, status, opened_at DESC);
