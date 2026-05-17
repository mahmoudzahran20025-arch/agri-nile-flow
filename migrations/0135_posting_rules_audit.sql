-- Migration 0135: posting_rules_audit table
-- Maker-checker audit trail for posting_rules changes.
-- Was defined in 0097 but not applied to production D1.

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
  old_values      TEXT,
  new_values      TEXT
);

CREATE INDEX IF NOT EXISTS idx_pr_audit_rule
  ON posting_rules_audit (company_id, rule_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_pr_audit_pending
  ON posting_rules_audit (company_id, approval_status)
  WHERE approval_status = 'pending';
