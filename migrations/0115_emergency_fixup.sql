-- =============================================================================
-- Migration 0115 — Emergency Fix-up (Post-Phase B Audit)
-- Date: 2026-05-14
-- 
-- What this does:
--   1. Fixes missing columns that caused 500 errors in logs.
--   2. Adds expense_types.is_deprecated (missing from 0113).
--   3. Adds journal_entries.status (missing dimension).
--   4. Adds form_templates.requires_equipment (missing from my 0110 rewrite).
--   5. Re-creates supplier_ap_ledger view (missing from 0109).
-- =============================================================================

-- ── 1. expense_types ──────────────────────────────────────────────────────────
ALTER TABLE expense_types ADD COLUMN is_deprecated INTEGER NOT NULL DEFAULT 0;
UPDATE expense_types SET is_deprecated = 1;

-- ── 2. journal_entries ────────────────────────────────────────────────────────
ALTER TABLE journal_entries ADD COLUMN status TEXT NOT NULL DEFAULT 'posted';

-- ── 3. form_templates ────────────────────────────────────────────────────────
ALTER TABLE form_templates ADD COLUMN requires_equipment INTEGER NOT NULL DEFAULT 1;

-- ── 4. supplier_ap_ledger VIEW ───────────────────────────────────────────────
DROP VIEW IF EXISTS supplier_ap_ledger;
CREATE VIEW supplier_ap_ledger AS
SELECT
  st.company_id,
  st.supplier_code,
  s.name                                                    AS supplier_name,
  st.service_type_code,
  st.season_id,
  -- Open invoice summary
  COUNT(CASE WHEN st.entry_type = 'invoice' AND st.is_matched = 0 THEN 1 END)
                                                            AS open_invoice_count,
  COALESCE(SUM(CASE WHEN st.entry_type = 'invoice' AND st.is_matched = 0
                    THEN st.amount ELSE 0 END), 0)          AS open_amount,
  -- Payments applied
  COALESCE(SUM(CASE WHEN st.entry_type = 'payment'
                    THEN st.amount ELSE 0 END), 0)          AS paid_amount,
  -- Net AP = what we still owe (open invoices minus all payments)
  COALESCE(SUM(CASE WHEN st.entry_type = 'invoice' AND st.is_matched = 0
                    THEN st.amount ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN st.entry_type = 'payment'
                    THEN st.amount ELSE 0 END), 0)          AS net_ap_balance,
  -- Aging
  MIN(CASE WHEN st.entry_type = 'invoice' AND st.is_matched = 0
           THEN st.due_date END)                            AS oldest_due_date,
  MAX(CASE WHEN st.entry_type = 'invoice' AND st.is_matched = 0
               AND st.due_date IS NOT NULL
               AND st.due_date < date('now')
           THEN CAST(julianday('now') - julianday(st.due_date) AS INTEGER)
           ELSE 0 END)                                      AS days_overdue_max,
  -- Estimated flag: 1 if any open invoice has an estimated due date
  MAX(CASE WHEN st.entry_type = 'invoice' AND st.is_matched = 0
           THEN COALESCE(st.due_date_estimated, 0) ELSE 0 END)
                                                            AS has_estimated_due_date
FROM supplier_transactions st
LEFT JOIN suppliers s
  ON s.company_id = st.company_id AND s.code = st.supplier_code
WHERE st.status = 'posted'
GROUP BY st.company_id, st.supplier_code, st.service_type_code, st.season_id;

-- ── 5. Verification ──────────────────────────────────────────────────────────
SELECT 'Fix-up complete' as status;
