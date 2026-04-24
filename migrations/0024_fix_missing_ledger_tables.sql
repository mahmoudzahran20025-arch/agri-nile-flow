-- Migration 0024: Fix missing ledger tables and seed 2026 period
-- This ensures that financial_periods and journal_entries exist in production.

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL,
  code           TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  account_type   TEXT    NOT NULL CHECK(account_type IN ('asset','liability','equity','revenue','expense')),
  normal_balance TEXT    NOT NULL CHECK(normal_balance IN ('debit','credit')),
  parent_code    TEXT,
  level          INTEGER NOT NULL DEFAULT 1,
  is_header      INTEGER NOT NULL DEFAULT 0,
  is_active      INTEGER NOT NULL DEFAULT 1,
  notes          TEXT,
  UNIQUE(company_id, code),
  FOREIGN KEY(company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS financial_periods (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL,
  name        TEXT    NOT NULL,
  period_type TEXT    NOT NULL DEFAULT 'monthly'
              CHECK(period_type IN ('monthly','quarterly','annual')),
  start_date  TEXT    NOT NULL,
  end_date    TEXT    NOT NULL,
  is_closed   INTEGER NOT NULL DEFAULT 0,
  closed_at   TEXT,
  closed_by   INTEGER,
  FOREIGN KEY(company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL,
  period_id    INTEGER,
  entry_number TEXT,
  entry_date   TEXT    NOT NULL,
  description  TEXT    NOT NULL,
  ref_type     TEXT,
  ref_id       INTEGER,
  is_posted    INTEGER NOT NULL DEFAULT 1,
  created_by   INTEGER,
  local_id     TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(period_id)  REFERENCES financial_periods(id)
);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id     INTEGER NOT NULL,
  company_id   INTEGER NOT NULL,
  account_code TEXT    NOT NULL,
  debit        REAL    NOT NULL DEFAULT 0,
  credit       REAL    NOT NULL DEFAULT 0,
  description  TEXT,
  center_code  INTEGER,
  FOREIGN KEY(entry_id)   REFERENCES journal_entries(id) ON DELETE CASCADE,
  FOREIGN KEY(company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS gl_account_mappings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL,
  mapping_key  TEXT    NOT NULL,
  account_code TEXT    NOT NULL,
  UNIQUE(company_id, mapping_key),
  FOREIGN KEY(company_id) REFERENCES companies(id)
);

-- Seed financial periods for 2026 to allow current testing
INSERT OR IGNORE INTO financial_periods (company_id, name, period_type, start_date, end_date)
SELECT id, 'السنة المالية 2026', 'annual', '2026-01-01', '2026-12-31' FROM companies;

INSERT OR IGNORE INTO financial_periods (company_id, name, period_type, start_date, end_date)
SELECT id, 'السنة المالية 2025', 'annual', '2025-01-01', '2025-12-31' FROM companies;
