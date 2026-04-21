-- ── Migration 003: Documents Manager ─────────────────────────
-- Phase 6 — Compliance & Document Tracking

CREATE TABLE IF NOT EXISTS documents (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL REFERENCES companies(id),
  title               TEXT    NOT NULL,
  doc_type            TEXT    NOT NULL,
  -- commercial_reg / trade_license / safety_cert / civil_defense
  -- employee_contract / insurance / vehicle_license / other
  ref_table           TEXT,     -- employees / suppliers / companies / fields / vehicles
  ref_id              INTEGER,  -- FK to ref_table.id
  issue_date          TEXT,
  expiry_date         TEXT,     -- alerts generated from this
  responsible_user_id INTEGER   REFERENCES users(id),
  file_r2_key         TEXT,     -- Cloudflare R2 object key (future upload)
  file_name           TEXT,     -- original file name
  file_size_kb        INTEGER,
  status              TEXT    NOT NULL DEFAULT 'active',
  -- active / expired / renewed / cancelled
  notes               TEXT,
  created_by          INTEGER REFERENCES users(id),
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_doc_company  ON documents(company_id, doc_type);
CREATE INDEX IF NOT EXISTS idx_doc_expiry   ON documents(expiry_date);
CREATE INDEX IF NOT EXISTS idx_doc_ref      ON documents(ref_table, ref_id);
CREATE INDEX IF NOT EXISTS idx_doc_status   ON documents(company_id, status);
