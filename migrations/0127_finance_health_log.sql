-- Migration 0127: Finance health log table
-- Persists results from /gl/integrity-check so trends can be queried over time.
-- Rows are append-only; never updated or deleted by application code.

CREATE TABLE IF NOT EXISTS finance_health_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL,
  checked_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  health_score  INTEGER NOT NULL CHECK (health_score BETWEEN 0 AND 100),
  total_issues  INTEGER NOT NULL DEFAULT 0,
  critical_count INTEGER NOT NULL DEFAULT 0,
  high_count    INTEGER NOT NULL DEFAULT 0,
  medium_count  INTEGER NOT NULL DEFAULT 0,
  checks_json   TEXT    NOT NULL,   -- JSON array of check results (name, severity, count)
  triggered_by  TEXT    NOT NULL DEFAULT 'api'  -- 'api' | 'cron' | 'manual'
);

CREATE INDEX IF NOT EXISTS idx_fhl_company_checked
  ON finance_health_log (company_id, checked_at DESC);
