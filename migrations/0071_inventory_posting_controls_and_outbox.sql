-- =============================================================================
-- Migration 0071: Inventory Posting Controls + Outbox Skeleton
-- Date: 2026-05-02
-- =============================================================================

-- 1) Company-level controls for posting mode, zero-value policy, and period lock
CREATE TABLE IF NOT EXISTS inventory_posting_controls (
  company_id                  INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  posting_mode                TEXT NOT NULL DEFAULT 'strict_sync'
                                CHECK (posting_mode IN ('strict_sync', 'async_reliable', 'decoupled')),
  zero_value_require_reason   INTEGER NOT NULL DEFAULT 1,
  zero_value_approval_roles   TEXT NOT NULL DEFAULT 'super_admin,company_admin,accountant,field_supervisor',
  locked_through_date         TEXT,
  updated_by                  INTEGER,
  updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2) Outbox table for async reliable posting mode
CREATE TABLE IF NOT EXISTS inventory_posting_outbox (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL CHECK (event_type IN ('inventory_movement', 'inventory_transfer')),
  movement_id       INTEGER NOT NULL,
  payload_json      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  idempotency_key   TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at      TEXT,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_inv_outbox_company_status
  ON inventory_posting_outbox(company_id, status, created_at);

-- 3) Enrich inventory_movements with posting governance metadata
ALTER TABLE inventory_movements ADD COLUMN zero_value_reason TEXT;
ALTER TABLE inventory_movements ADD COLUMN zero_value_approved_by_role TEXT;
ALTER TABLE inventory_movements ADD COLUMN posting_mode TEXT;
ALTER TABLE inventory_movements ADD COLUMN gl_posting_status TEXT NOT NULL DEFAULT 'posted';
ALTER TABLE inventory_movements ADD COLUMN gl_posting_error TEXT;
ALTER TABLE inventory_movements ADD COLUMN gl_posted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_inventory_movements_gl_status
  ON inventory_movements(company_id, gl_posting_status, movement_date);
