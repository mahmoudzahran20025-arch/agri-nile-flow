-- 0062_account_balances_and_batch_post_jobs.sql
-- P1: Materialized account balances + batch posting queue scaffold.

CREATE TABLE IF NOT EXISTS account_balances (
  company_id INTEGER NOT NULL,
  period_id INTEGER NOT NULL,
  account_code TEXT NOT NULL,
  opening_balance REAL NOT NULL DEFAULT 0,
  period_debit REAL NOT NULL DEFAULT 0,
  period_credit REAL NOT NULL DEFAULT 0,
  closing_balance REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (company_id, period_id, account_code)
);

CREATE INDEX IF NOT EXISTS idx_account_balances_period
  ON account_balances(company_id, period_id);

CREATE INDEX IF NOT EXISTS idx_account_balances_account
  ON account_balances(company_id, account_code);

-- Build materialized balances from existing posted entries.
INSERT OR REPLACE INTO account_balances (
  company_id,
  period_id,
  account_code,
  opening_balance,
  period_debit,
  period_credit,
  closing_balance,
  updated_at
)
SELECT
  je.company_id,
  je.period_id,
  jel.account_code,
  0,
  SUM(COALESCE(jel.debit, 0)) AS period_debit,
  SUM(COALESCE(jel.credit, 0)) AS period_credit,
  SUM(COALESCE(jel.debit, 0) - COALESCE(jel.credit, 0)) AS closing_balance,
  datetime('now')
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.entry_id
WHERE je.is_posted = 1
  AND je.period_id IS NOT NULL
GROUP BY je.company_id, je.period_id, jel.account_code;

DROP TRIGGER IF EXISTS trg_account_balances_ai_jel;
CREATE TRIGGER trg_account_balances_ai_jel
AFTER INSERT ON journal_entry_lines
WHEN (SELECT is_posted FROM journal_entries WHERE id = NEW.entry_id) = 1
 AND (SELECT period_id FROM journal_entries WHERE id = NEW.entry_id) IS NOT NULL
BEGIN
  INSERT INTO account_balances (
    company_id, period_id, account_code,
    opening_balance, period_debit, period_credit, closing_balance, updated_at
  )
  VALUES (
    (SELECT company_id FROM journal_entries WHERE id = NEW.entry_id),
    (SELECT period_id FROM journal_entries WHERE id = NEW.entry_id),
    NEW.account_code,
    0,
    COALESCE(NEW.debit, 0),
    COALESCE(NEW.credit, 0),
    COALESCE(NEW.debit, 0) - COALESCE(NEW.credit, 0),
    datetime('now')
  )
  ON CONFLICT(company_id, period_id, account_code)
  DO UPDATE SET
    period_debit = period_debit + COALESCE(NEW.debit, 0),
    period_credit = period_credit + COALESCE(NEW.credit, 0),
    closing_balance = closing_balance + (COALESCE(NEW.debit, 0) - COALESCE(NEW.credit, 0)),
    updated_at = datetime('now');
END;

DROP TRIGGER IF EXISTS trg_account_balances_ad_jel;
CREATE TRIGGER trg_account_balances_ad_jel
AFTER DELETE ON journal_entry_lines
WHEN (SELECT is_posted FROM journal_entries WHERE id = OLD.entry_id) = 1
 AND (SELECT period_id FROM journal_entries WHERE id = OLD.entry_id) IS NOT NULL
BEGIN
  INSERT INTO account_balances (
    company_id, period_id, account_code,
    opening_balance, period_debit, period_credit, closing_balance, updated_at
  )
  VALUES (
    (SELECT company_id FROM journal_entries WHERE id = OLD.entry_id),
    (SELECT period_id FROM journal_entries WHERE id = OLD.entry_id),
    OLD.account_code,
    0,
    0,
    0,
    0,
    datetime('now')
  )
  ON CONFLICT(company_id, period_id, account_code)
  DO UPDATE SET
    period_debit = period_debit - COALESCE(OLD.debit, 0),
    period_credit = period_credit - COALESCE(OLD.credit, 0),
    closing_balance = closing_balance - (COALESCE(OLD.debit, 0) - COALESCE(OLD.credit, 0)),
    updated_at = datetime('now');
END;

DROP TRIGGER IF EXISTS trg_account_balances_au_jel;
CREATE TRIGGER trg_account_balances_au_jel
AFTER UPDATE ON journal_entry_lines
BEGIN
  -- Remove OLD contribution
  INSERT INTO account_balances (
    company_id, period_id, account_code,
    opening_balance, period_debit, period_credit, closing_balance, updated_at
  )
  VALUES (
    (SELECT company_id FROM journal_entries WHERE id = OLD.entry_id),
    (SELECT period_id FROM journal_entries WHERE id = OLD.entry_id),
    OLD.account_code,
    0,
    0,
    0,
    0,
    datetime('now')
  )
  ON CONFLICT(company_id, period_id, account_code)
  DO UPDATE SET
    period_debit = period_debit -
      (CASE WHEN (SELECT is_posted FROM journal_entries WHERE id = OLD.entry_id) = 1 AND (SELECT period_id FROM journal_entries WHERE id = OLD.entry_id) IS NOT NULL THEN COALESCE(OLD.debit, 0) ELSE 0 END),
    period_credit = period_credit -
      (CASE WHEN (SELECT is_posted FROM journal_entries WHERE id = OLD.entry_id) = 1 AND (SELECT period_id FROM journal_entries WHERE id = OLD.entry_id) IS NOT NULL THEN COALESCE(OLD.credit, 0) ELSE 0 END),
    closing_balance = closing_balance -
      (CASE WHEN (SELECT is_posted FROM journal_entries WHERE id = OLD.entry_id) = 1 AND (SELECT period_id FROM journal_entries WHERE id = OLD.entry_id) IS NOT NULL THEN (COALESCE(OLD.debit, 0) - COALESCE(OLD.credit, 0)) ELSE 0 END),
    updated_at = datetime('now');

  -- Add NEW contribution
  INSERT INTO account_balances (
    company_id, period_id, account_code,
    opening_balance, period_debit, period_credit, closing_balance, updated_at
  )
  VALUES (
    (SELECT company_id FROM journal_entries WHERE id = NEW.entry_id),
    (SELECT period_id FROM journal_entries WHERE id = NEW.entry_id),
    NEW.account_code,
    0,
    0,
    0,
    0,
    datetime('now')
  )
  ON CONFLICT(company_id, period_id, account_code)
  DO UPDATE SET
    period_debit = period_debit +
      (CASE WHEN (SELECT is_posted FROM journal_entries WHERE id = NEW.entry_id) = 1 AND (SELECT period_id FROM journal_entries WHERE id = NEW.entry_id) IS NOT NULL THEN COALESCE(NEW.debit, 0) ELSE 0 END),
    period_credit = period_credit +
      (CASE WHEN (SELECT is_posted FROM journal_entries WHERE id = NEW.entry_id) = 1 AND (SELECT period_id FROM journal_entries WHERE id = NEW.entry_id) IS NOT NULL THEN COALESCE(NEW.credit, 0) ELSE 0 END),
    closing_balance = closing_balance +
      (CASE WHEN (SELECT is_posted FROM journal_entries WHERE id = NEW.entry_id) = 1 AND (SELECT period_id FROM journal_entries WHERE id = NEW.entry_id) IS NOT NULL THEN (COALESCE(NEW.debit, 0) - COALESCE(NEW.credit, 0)) ELSE 0 END),
    updated_at = datetime('now');
END;

CREATE TABLE IF NOT EXISTS batch_post_jobs (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  source_module TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 100,
  total_items INTEGER NOT NULL DEFAULT 0,
  processed_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  payload TEXT,
  last_error TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_batch_post_jobs_status
  ON batch_post_jobs(company_id, status, priority, created_at);

CREATE TABLE IF NOT EXISTS batch_post_job_items (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  source_id INTEGER NOT NULL,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  journal_entry_id INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  UNIQUE(job_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_batch_post_job_items_job
  ON batch_post_job_items(company_id, job_id, status);

CREATE INDEX IF NOT EXISTS idx_batch_post_job_items_source
  ON batch_post_job_items(company_id, source_id);
