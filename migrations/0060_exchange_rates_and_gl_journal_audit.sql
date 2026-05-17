-- ============================================================================
-- 0060_exchange_rates_and_gl_journal_audit.sql
--
-- Phase 2: Multi-Currency Support
-- Creates exchange_rates table + gl_journal_audit log
-- ============================================================================

-- ============================================================================
-- EXCHANGE RATES — Stores daily FX rates relative to base currency (EGP)
-- ============================================================================
CREATE TABLE IF NOT EXISTS exchange_rates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL,
  from_currency  TEXT    NOT NULL,
  to_currency    TEXT    NOT NULL,
  rate           REAL    NOT NULL,
  effective_date TEXT    NOT NULL,
  source         TEXT    NOT NULL DEFAULT 'manual',
  created_by     INTEGER,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fx_lookup
  ON exchange_rates(company_id, from_currency, to_currency, effective_date DESC);

-- ============================================================================
-- GL_JOURNAL_AUDIT — Dedicated audit trail for GL mutations
-- ============================================================================
CREATE TABLE IF NOT EXISTS gl_journal_audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL,
  entry_id      INTEGER,
  action        TEXT    NOT NULL
                CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'POST', 'REVERSE', 'CORRECT')),
  changed_by    INTEGER NOT NULL,
  changed_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  old_snapshot  TEXT,  -- JSON of before state
  new_snapshot  TEXT,  -- JSON of after state
  reason        TEXT,  -- required for REVERSE, CORRECT
  ip_address    TEXT,

);

CREATE INDEX IF NOT EXISTS idx_gl_audit_entry
  ON gl_journal_audit(company_id, entry_id, changed_at DESC);

-- Seed initial EGP exchange rates (rate = 1 since EGP is base)
INSERT OR IGNORE INTO exchange_rates
  (company_id, from_currency, to_currency, rate, effective_date, source)
VALUES
  (1, 'EGP', 'EGP', 1.0,    date('now'), 'manual'),
  (1, 'USD', 'EGP', 50.5,   date('now'), 'manual'),
  (1, 'EUR', 'EGP', 55.2,   date('now'), 'manual'),
  (1, 'SAR', 'EGP', 13.46,  date('now'), 'manual'),
  (1, 'AED', 'EGP', 13.74,  date('now'), 'manual'),
  (1, 'GBP', 'EGP', 63.8,   date('now'), 'manual');

SELECT 'Phase 2 Migration 0060 applied successfully' as status;
