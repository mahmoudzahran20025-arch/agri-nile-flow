-- Migration 0154 — Pricing Engine (P2-M1, P2-M2, P2-M3)
--
-- Three tables that together implement a simple layered pricing model:
--   1. branch_price_overrides  — branch-specific list price override per item
--   2. promotions              — time-bounded discount rules (% or fixed amount)
--   3. customer_price_tiers    — named tiers that map to a discount % applied at checkout
--
-- Price resolution order (highest precedence first):
--   1. Active promotion matching item + branch + date
--   2. Customer price tier discount
--   3. Branch price override for item
--   4. Item.list_price (global default)
--   5. Item.min_selling_price floor (cannot go below this regardless of tier/promo)
--
-- All tables are company-scoped and soft-deletable (is_active flag).

-- ── 1. Branch price overrides ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS branch_price_overrides (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  branch_id    INTEGER NOT NULL,               -- FK to branches (company_id, id) — no formal FK, branch table varies
  item_code    INTEGER NOT NULL,               -- FK to items.code
  price        REAL    NOT NULL CHECK(price >= 0),
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, branch_id, item_code)
);

CREATE INDEX IF NOT EXISTS idx_branch_price_overrides_lookup
  ON branch_price_overrides(company_id, branch_id, item_code, is_active);

-- ── 2. Promotions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promotions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  name            TEXT    NOT NULL,
  promo_type      TEXT    NOT NULL CHECK(promo_type IN ('percent', 'fixed_amount')),
  discount_value  REAL    NOT NULL CHECK(discount_value > 0),
  -- NULL = applies to all items/branches
  item_code       INTEGER,
  branch_id       INTEGER,
  -- Date range — NULL = open-ended
  start_date      TEXT,
  end_date        TEXT,
  -- Optional minimum quantity to trigger the promotion
  min_qty         REAL,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_promotions_active_date
  ON promotions(company_id, is_active, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_promotions_item
  ON promotions(company_id, item_code, is_active)
  WHERE item_code IS NOT NULL;

-- ── 3. Customer price tiers ───────────────────────────────────────────────────
-- Named tiers (e.g. "wholesale", "vip") with a flat discount percentage.
-- Customers are assigned a tier_id. At checkout the discount is applied on
-- top of the resolved price (after branch override, before min_selling_price floor).
CREATE TABLE IF NOT EXISTS customer_price_tiers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  name            TEXT    NOT NULL,
  discount_pct    REAL    NOT NULL DEFAULT 0 CHECK(discount_pct >= 0 AND discount_pct < 100),
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, name)
);

CREATE INDEX IF NOT EXISTS idx_customer_price_tiers_company
  ON customer_price_tiers(company_id, is_active);

-- Attach tier_id to customers
ALTER TABLE customers ADD COLUMN tier_id INTEGER REFERENCES customer_price_tiers(id) ON DELETE SET NULL;
