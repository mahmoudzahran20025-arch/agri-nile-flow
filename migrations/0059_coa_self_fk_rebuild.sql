-- =============================================================================
-- 0059_coa_self_fk_rebuild.sql
-- Rebuild chart_of_accounts to add composite self-FK:
--   (company_id, parent_code) -> (company_id, code)
-- This enforces in-table hierarchy integrity for direct DB writes.
-- =============================================================================

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS chart_of_accounts_new (
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
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(company_id, parent_code) REFERENCES chart_of_accounts_new(company_id, code)
);

INSERT INTO chart_of_accounts_new
(id, company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active, notes)
SELECT
id, company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active, notes
FROM chart_of_accounts;

DROP TABLE chart_of_accounts;
ALTER TABLE chart_of_accounts_new RENAME TO chart_of_accounts;

CREATE INDEX IF NOT EXISTS idx_coa_company_code ON chart_of_accounts(company_id, code);
CREATE INDEX IF NOT EXISTS idx_coa_company_parent ON chart_of_accounts(company_id, parent_code);

PRAGMA foreign_keys = ON;
