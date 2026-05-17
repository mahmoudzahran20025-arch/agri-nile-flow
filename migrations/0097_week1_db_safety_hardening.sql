-- ============================================================
-- Migration 0097: Week 1 Day 1 — DB Safety Hardening
-- Scope:
--   1. Idempotency UNIQUE INDEX on business_events
--   2. Fix accounts_payable control rule (activate, deactivate wages_payable fallback)
--   3. Fix equipment_type_id=1 orphan (insert canonical ghost-buster row)
--   4. Feature flags infrastructure (hardening_flags table)
--   5. Supplier season_id tracking table for backfill plan
--   6. GL posting rule audit log table
-- ============================================================

-- ── 1. Idempotency: UNIQUE INDEX on business_events ──────────
-- Prevents duplicate JEs from race conditions or double-run of posting jobs.
-- Existing data has 0 duplicates (verified by audit), so this applies cleanly.
CREATE UNIQUE INDEX IF NOT EXISTS uq_be_posting_source
  ON business_events (company_id, source_module, source_id, event_type);

-- ── 2. AP Control Account Fix ─────────────────────────────────
-- accounts_payable rule (id=47) references account 21100001 which does NOT exist in COA.
-- The correct canonical AP account in this chart is 212000010 (موردون متنوعون).
-- Fix: update the rule's account_code to the existing active leaf account,
-- then activate it so the system routes through accounts_payable not wages_payable.
--
-- NOTE: trigger trg_pr_control_account_guard_update enforces that account_code
-- must be an active, non-header COA entry — 212000010 passes this check.
UPDATE posting_rules
SET
  account_code     = '212000010',
  is_active        = 1,
  last_modified_at = datetime('now'),
  last_modified_by = 1
WHERE company_id   = 1
  AND rule_type    = 'control'
  AND mapping_key  = 'accounts_payable'
  AND id           = 47;

-- wages_payable (account 212000010) was serving as AP fallback because accounts_payable
-- was inactive. Now that accounts_payable is active with the same account code,
-- we differentiate by giving wages_payable a dedicated payroll account.
-- For now: deactivate the wages_payable rule that was acting as AP proxy.
-- It will be reactivated in Week 2 once a dedicated wages_payable account is confirmed.
UPDATE posting_rules
SET
  is_active        = 0,
  last_modified_at = datetime('now'),
  last_modified_by = 1
WHERE company_id   = 1
  AND rule_type    = 'control'
  AND mapping_key  = 'wages_payable'
  AND account_code = '212000010'
  AND is_active    = 1;

-- ── 3. Equipment Type Orphan Fix ──────────────────────────────
-- 109 supplier_transactions reference equipment_type_id=1 which does not exist.
-- Insert a canonical "متنوع" type at id=1 as the ghost-buster.
-- This is a holding type only — Week 2 resolver rewrite will map real types.
INSERT OR IGNORE INTO equipment_types
  (id, company_id, name, asset_nature, default_life_months, created_at)
VALUES
  (1, 1, 'متنوع (تصنيف مؤقت)', 'operational', 60, datetime('now'));

-- ── 4. Hardening Feature Flags ────────────────────────────────
-- Central table for all hardening mode toggles. Avoids hardcoded env vars.
CREATE TABLE IF NOT EXISTS hardening_flags (
  id          INTEGER PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  flag_key    TEXT    NOT NULL,
  flag_value  INTEGER NOT NULL DEFAULT 0,   -- 0=off, 1=on
  description TEXT,
  set_by      INTEGER REFERENCES users(id),
  set_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT,                          -- NULL = permanent
  UNIQUE (company_id, flag_key)
);

-- Seed the three core Week-1 flags (all OFF by default — shadow mode first)
INSERT OR IGNORE INTO hardening_flags (company_id, flag_key, flag_value, description)
VALUES
  (1, 'strict_posting_mode',  0, 'Block posting if BPG/PPG/IPG missing. 0=warn, 1=block'),
  (1, 'catch_all_allowed',    1, 'Allow null/null catch-all resolution. 0=blocked in strict'),
  (1, 'report_fallback_mode', 1, 'Allow source-table fallback in financial reports. 0=GL-only');

-- ── 5. Supplier Subledger Reconciliation Snapshots ────────────
-- Daily snapshot: stores computed vs stored balance per supplier.
-- Drives the reconciliation drift alert in Week 4+.
CREATE TABLE IF NOT EXISTS supplier_balance_snapshots (
  id              INTEGER PRIMARY KEY,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  supplier_code   INTEGER NOT NULL,
  snapshot_date   TEXT    NOT NULL DEFAULT (date('now')),
  computed_balance    REAL NOT NULL,   -- SUM(credit-debit) from transactions
  stored_balance      REAL,            -- balance_no_checks from last posted row
  gl_ap_balance       REAL,            -- net from journal_entry_lines on AP accounts
  drift_computed_stored REAL GENERATED ALWAYS AS (
    ROUND(ABS(COALESCE(computed_balance,0) - COALESCE(stored_balance,0)), 4)
  ) STORED,
  drift_computed_gl REAL GENERATED ALWAYS AS (
    ROUND(ABS(COALESCE(computed_balance,0) - COALESCE(gl_ap_balance,0)), 4)
  ) STORED,
  has_discrepancy INTEGER GENERATED ALWAYS AS (
    CASE WHEN ABS(COALESCE(computed_balance,0) - COALESCE(stored_balance,0)) > 0.5 THEN 1 ELSE 0 END
  ) STORED,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, supplier_code, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_supplier_snapshots_date
  ON supplier_balance_snapshots (company_id, snapshot_date, has_discrepancy);

-- ── 6. Posting Rules Audit Log ────────────────────────────────
-- Every change to posting_rules must leave an immutable audit trail.
-- Application layer writes here before updating posting_rules.
CREATE TABLE IF NOT EXISTS posting_rules_audit (
  id              INTEGER PRIMARY KEY,
  company_id      INTEGER NOT NULL,
  rule_id         INTEGER NOT NULL,
  action          TEXT    NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE','ACTIVATE','DEACTIVATE')),
  changed_by      INTEGER REFERENCES users(id),
  changed_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  change_reason   TEXT    NOT NULL,
  approval_status TEXT    NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  approved_by     INTEGER REFERENCES users(id),
  approved_at     TEXT,
  old_values      TEXT,   -- JSON snapshot of row before change
  new_values      TEXT    -- JSON snapshot of row after change
);

CREATE INDEX IF NOT EXISTS idx_pr_audit_rule
  ON posting_rules_audit (company_id, rule_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_pr_audit_pending
  ON posting_rules_audit (company_id, approval_status)
  WHERE approval_status = 'pending';

-- Seed audit record for the AP fix above
INSERT INTO posting_rules_audit
  (company_id, rule_id, action, changed_by, change_reason, approval_status, approved_by, approved_at,
   old_values, new_values)
SELECT
  1,
  pr.id,
  'ACTIVATE',
  1,
  'Week 1 hardening: accounts_payable was incorrectly inactive, system was routing via wages_payable',
  'approved',
  1,
  datetime('now'),
  json_object('is_active', 0, 'mapping_key', pr.mapping_key),
  json_object('is_active', 1, 'mapping_key', pr.mapping_key)
FROM posting_rules pr
WHERE pr.company_id = 1
  AND pr.rule_type  = 'control'
  AND pr.mapping_key = 'accounts_payable';

-- ── 7. Cash Mirror Gap Record ─────────────────────────────────
-- txn 3763 (3700 EGP, supplier 20100033) has GL but no cash_transactions mirror.
-- Logged in system_error_logs for Week 5 resolution.
INSERT INTO system_error_logs
  (company_id, user_id, endpoint, method, error_message, stack_trace, request_payload, created_at)
VALUES
  (1, 1,
   'FINANCIAL_WORKFLOW:suppliers',
   'AUDIT_DISCOVERY',
   'Supplier payment txn 3763 (3700 EGP) has GL entry #105 but no cash_transactions mirror. Treasury balance understated by 3700.',
   'Discovered by enterprise audit 2026-05-10. Scheduled for Week 5 reconciliation fix.',
   '{"module":"suppliers","stage":"missing_cash_mirror","table_name":"supplier_transactions","record_id":3763,"supplier_code":20100033,"amount":3700,"transaction_date":"2025-12-16","journal_entry_id":105,"audit_discovery":"2026-05-10"}',
   datetime('now'));
