-- Migration 0134: daily_finance_health_log table
-- Persists results from the nightly finance health cron (runDailyFinanceHealth).
-- Separate from finance_health_log (which stores integrity-check snapshots).
-- Rows are append-only; never updated or deleted by application code.

CREATE TABLE IF NOT EXISTS daily_finance_health_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL,
  run_date        TEXT    NOT NULL,           -- YYYY-MM-DD of the check
  run_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  gl_balance      REAL    NOT NULL DEFAULT 0, -- SUM(debit) - SUM(credit), should be 0
  error_events    INTEGER NOT NULL DEFAULT 0,
  stale_balances  INTEGER NOT NULL DEFAULT 0,
  zero_jel        INTEGER NOT NULL DEFAULT 0,
  pending_outbox  INTEGER NOT NULL DEFAULT 0,
  alerts          TEXT,                       -- JSON array of alert strings, NULL if none
  status          TEXT    NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'warning', 'critical'))
);

CREATE INDEX IF NOT EXISTS idx_dfhl_company_run
  ON daily_finance_health_log (company_id, run_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dfhl_company_date
  ON daily_finance_health_log (company_id, run_date);
