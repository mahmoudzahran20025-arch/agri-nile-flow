-- ============================================================
-- Migration: 0075_period_close_governance
-- Purpose:   Period-close checklist engine + balance snapshot
--            tables for the financial-period governance feature.
--
-- Applied to LIVE D1 (agri-nile-flow-data-lake) on 2026-05-03
-- via direct SQL during the period-close feature session.
-- This file formalises that schema so fresh environments can
-- replay it in order.
-- ============================================================

-- Persisted checklist steps for a period-close workflow.
-- One row per (company, period, step_key).  Rows survive across
-- sessions so the cockpit UI can show incremental progress.
CREATE TABLE IF NOT EXISTS period_close_checklist (
  id            INTEGER  PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER  NOT NULL,
  period_id     INTEGER  NOT NULL,
  step_key      TEXT     NOT NULL,
  step_order    INTEGER  NOT NULL DEFAULT 0,
  step_label    TEXT     NOT NULL DEFAULT '',
  is_critical   INTEGER  NOT NULL DEFAULT 1,
  status        TEXT     NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','running','passed','failed','warning')),
  count_blocked INTEGER  NOT NULL DEFAULT 0,
  details_json  TEXT     NOT NULL DEFAULT '',
  completed_by  INTEGER,
  completed_at  TEXT,
  UNIQUE (company_id, period_id, step_key),
  FOREIGN KEY (period_id) REFERENCES financial_periods(id) ON DELETE CASCADE
);

-- Immutable balance snapshot created when a period is closed.
-- One row per (company, period, account_code).
-- Used as the opening-balance seed for the following period.
CREATE TABLE IF NOT EXISTS period_account_balances (
  id             INTEGER PRIMARY KEY,
  company_id     INTEGER NOT NULL,
  period_id      INTEGER NOT NULL,
  account_code   TEXT    NOT NULL,
  opening_debit  REAL    NOT NULL DEFAULT 0,
  opening_credit REAL    NOT NULL DEFAULT 0,
  period_debit   REAL    NOT NULL DEFAULT 0,
  period_credit  REAL    NOT NULL DEFAULT 0,
  closing_debit  REAL    NOT NULL DEFAULT 0,
  closing_credit REAL    NOT NULL DEFAULT 0,
  snapshotted_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, period_id, account_code)
);
