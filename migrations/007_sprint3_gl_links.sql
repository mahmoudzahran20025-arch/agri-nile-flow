-- ============================================================
-- Migration 007 — Sprint 3: GL Links + Views
-- Date: 2026-04-21
-- Purpose:
--   1. Link cash_transactions → journal_entries (back-reference)
--   2. Add warehouse to purchase_order_items (for auto-inventory on receive)
--   3. Index on journal_entry_lines.center_code for Dimension Reports
--   4. SQL Views: trial_balance + profit_and_loss
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Link cash_transactions back to their auto-GL entry
-- ────────────────────────────────────────────────────────────
ALTER TABLE cash_transactions ADD COLUMN journal_entry_id INTEGER REFERENCES journal_entries(id);

-- ────────────────────────────────────────────────────────────
-- 2. Warehouse on PO items (enables auto-inventory on receive)
-- ────────────────────────────────────────────────────────────
ALTER TABLE purchase_order_items ADD COLUMN warehouse TEXT;

-- ────────────────────────────────────────────────────────────
-- 3. Index: center_code on journal_entry_lines (Dimension Reports)
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_jel_center ON journal_entry_lines(company_id, center_code);

-- ────────────────────────────────────────────────────────────
-- 4. Trial Balance View
-- ────────────────────────────────────────────────────────────
CREATE VIEW IF NOT EXISTS trial_balance AS
SELECT
  jel.company_id,
  jel.account_code,
  coa.name          AS account_name,
  coa.account_type,
  SUM(jel.debit)    AS total_debit,
  SUM(jel.credit)   AS total_credit,
  SUM(jel.debit) - SUM(jel.credit) AS net_balance
FROM journal_entry_lines jel
JOIN journal_entries     je  ON je.id = jel.entry_id AND je.is_posted = 1
JOIN chart_of_accounts   coa ON coa.code = jel.account_code
                              AND coa.company_id = jel.company_id
GROUP BY jel.company_id, jel.account_code, coa.name, coa.account_type;

-- ────────────────────────────────────────────────────────────
-- 5. Profit & Loss View
-- ────────────────────────────────────────────────────────────
CREATE VIEW IF NOT EXISTS profit_and_loss AS
SELECT
  jel.company_id,
  coa.account_type,
  coa.code,
  coa.name,
  SUM(jel.credit) - SUM(jel.debit) AS balance
FROM journal_entry_lines jel
JOIN journal_entries   je  ON je.id = jel.entry_id AND je.is_posted = 1
JOIN chart_of_accounts coa ON coa.code = jel.account_code
                           AND coa.company_id = jel.company_id
WHERE coa.account_type IN ('revenue','expense')
GROUP BY jel.company_id, coa.account_type, coa.code, coa.name;

-- ────────────────────────────────────────────────────────────
-- 6. Cash Flow View (simplified — net cash movements per month)
-- ────────────────────────────────────────────────────────────
CREATE VIEW IF NOT EXISTS cash_flow_summary AS
SELECT
  company_id,
  year,
  month,
  SUM(CASE WHEN direction = 'د' THEN amount ELSE 0 END) AS total_in,
  SUM(CASE WHEN direction = 'م' THEN amount ELSE 0 END) AS total_out,
  SUM(CASE WHEN direction = 'د' THEN amount ELSE -amount END) AS net_flow
FROM cash_transactions
GROUP BY company_id, year, month;
