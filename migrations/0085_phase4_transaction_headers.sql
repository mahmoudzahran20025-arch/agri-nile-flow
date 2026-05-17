-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 4: Transaction Header Concept + Typed Code Support
--
-- Adds:
--   1. inventory_transactions  — lightweight header table grouping related movements
--   2. transaction_id          — FK column on inventory_movements
--
-- Why: Enables document-level grouping (GRN, batch issue, transfer) without
--      touching existing inventory_movements rows.  All new movements auto-get
--      a transaction_id; legacy rows remain NULL — no data loss, no breakage.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Header table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id           INTEGER NOT NULL,
  transaction_type     TEXT    NOT NULL,          -- GRN | ISSUE | TRANSFER | ADJUSTMENT_PROFIT | ADJUSTMENT_LOSS | RETURN_SUPPLIER | RETURN_CUSTOMER | PRODUCTION_INPUT | PRODUCTION_OUTPUT
  document_number      TEXT,
  movement_date        TEXT    NOT NULL,
  warehouse            TEXT,                      -- primary warehouse (transfer: from_warehouse)
  to_warehouse         TEXT,                      -- for transfers only
  notes                TEXT,
  line_count           INTEGER NOT NULL DEFAULT 0,
  total_qty            REAL    NOT NULL DEFAULT 0,
  total_value          REAL    NOT NULL DEFAULT 0,
  status               TEXT    NOT NULL DEFAULT 'confirmed' CHECK(status IN ('draft','confirmed','cancelled')),
  created_by_user_id   INTEGER,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inv_tx_company_date
  ON inventory_transactions(company_id, movement_date DESC);

CREATE INDEX IF NOT EXISTS idx_inv_tx_company_type
  ON inventory_transactions(company_id, transaction_type);

-- 2. FK column on inventory_movements ─────────────────────────────────────────

ALTER TABLE inventory_movements ADD COLUMN transaction_id INTEGER REFERENCES inventory_transactions(id);

CREATE INDEX IF NOT EXISTS idx_inv_mov_transaction_id
  ON inventory_movements(transaction_id);
