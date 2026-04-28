-- =============================================================================
-- Migration 0051: Rule Slot Traceability + Integrity Infrastructure
-- =============================================================================
-- Closes the final architectural gaps defined in the Principal Architect document:
--   1. rule_slot on journal_entry_lines   → which account slot generated each line
--   2. posting_rule_trace on journal_entries → full JSON trace of rule resolution
--   3. posting_rule_resolutions table     → every engine call logged for debugging
--   4. period_account_balances table      → closed-period snapshot for fast reports
--   5. system_integrity_scores table      → daily integrity score history
-- =============================================================================

PRAGMA foreign_keys = OFF;

-- ── 1. rule_slot on journal_entry_lines ────────────────────────────────────
-- Stores which posting slot produced each GL line:
-- e.g. 'inventory_account', 'purchases_account', 'cogs_account',
--      'cash_account', 'expense_account', 'accounts_payable', etc.
-- NULL for lines written before this migration (legacy rows).
ALTER TABLE journal_entry_lines ADD COLUMN rule_slot TEXT;

-- ── 2. posting_rule_trace on journal_entries ───────────────────────────────
-- Stores the full JSON trace of which rule resolved this entry:
-- { rule_type, input_keys, resolution_step (1-8), matched_rule_id,
--   resolved_accounts: { slot: account_code }, resolved_at }
-- NULL for entries written before this migration.
ALTER TABLE journal_entries ADD COLUMN posting_rule_trace TEXT;

-- ── 3. Posting Rule Resolution Log ─────────────────────────────────────────
-- Every engine call is logged here for debugging and audit.
CREATE TABLE IF NOT EXISTS posting_rule_resolutions (
  id                 INTEGER PRIMARY KEY,
  company_id         INTEGER NOT NULL,
  resolved_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  rule_type          TEXT    NOT NULL,
  input_bpg          TEXT,
  input_ppg          TEXT,
  input_ipg          TEXT,
  resolution_step    INTEGER,             -- 1-8 (which cascade level matched)
  matched_rule_id    INTEGER,             -- FK to posting_rules.id (nullable if failed)
  result             TEXT    NOT NULL CHECK(result IN ('resolved','failed')),
  error_message      TEXT,
  journal_entry_id   INTEGER,             -- FK to journal_entries.id (nullable until committed)
  source_event_id    INTEGER              -- FK to business_events.id
);

CREATE INDEX IF NOT EXISTS idx_prr_company_date
  ON posting_rule_resolutions(company_id, resolved_at DESC);

CREATE INDEX IF NOT EXISTS idx_prr_entry
  ON posting_rule_resolutions(journal_entry_id)
  WHERE journal_entry_id IS NOT NULL;

-- ── 4. Period Account Balances (closed-period snapshot) ────────────────────
-- Written once when a period closes. Fast reads for historical reports.
-- The open/current period always reads journal_lines in real time.
CREATE TABLE IF NOT EXISTS period_account_balances (
  id            INTEGER PRIMARY KEY,
  company_id    INTEGER NOT NULL,
  period_id     INTEGER NOT NULL,
  account_code  TEXT    NOT NULL,
  opening_debit REAL    NOT NULL DEFAULT 0,
  opening_credit REAL   NOT NULL DEFAULT 0,
  period_debit  REAL    NOT NULL DEFAULT 0,
  period_credit REAL    NOT NULL DEFAULT 0,
  closing_debit REAL    NOT NULL DEFAULT 0,
  closing_credit REAL   NOT NULL DEFAULT 0,
  snapshotted_at TEXT   NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, period_id, account_code)
);

CREATE INDEX IF NOT EXISTS idx_pab_company_period
  ON period_account_balances(company_id, period_id);

-- ── 5. System Integrity Scores (daily history) ─────────────────────────────
CREATE TABLE IF NOT EXISTS system_integrity_scores (
  id                      INTEGER PRIMARY KEY,
  company_id              INTEGER NOT NULL,
  scored_at               TEXT    NOT NULL DEFAULT (datetime('now')),
  overall_score           INTEGER NOT NULL,   -- 0-100
  posting_coverage_score  INTEGER NOT NULL,   -- % events with journal_entry_id
  balance_integrity_score INTEGER NOT NULL,   -- % entries that balance
  orphan_score            INTEGER NOT NULL,   -- 100 - orphan_pct
  reconciliation_score    INTEGER NOT NULL,   -- GL vs inventory delta score
  rule_coverage_score     INTEGER NOT NULL,   -- % group combos with rules
  unbalanced_count        INTEGER NOT NULL DEFAULT 0,
  orphan_count            INTEGER NOT NULL DEFAULT 0,
  draft_event_count       INTEGER NOT NULL DEFAULT 0,
  error_event_count       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sis_company_date
  ON system_integrity_scores(company_id, scored_at DESC);

PRAGMA foreign_keys = ON;
