-- =============================================================================
-- Migration 0121 — Fix supplier_ap_ledger VIEW entry_type values
-- Date: 2026-05-15
--
-- Problem:
--   Migration 0109 created supplier_ap_ledger VIEW using entry_type IN ('invoice','payment').
--   However, the application (invoices.ts) inserts entry_type as Arabic chars:
--     'د' = debit = invoice (supplier owes us / we owe supplier)
--     'م' = credit = payment (we paid supplier)
--   The partial index on 0109 also filtered on ('invoice','payment') — so it
--   covers zero rows. The VIEW has returned 0 rows since applied.
--
-- Fix:
--   Rebuild VIEW and index using the actual stored values 'د' and 'م'.
--   No data changes — this is a VIEW and INDEX rebuild only.
--
-- Rollback:
--   Re-apply migration 0109 VIEW definition (or see below).
-- =============================================================================

-- ── Step 1: Drop the broken index from 0109 ───────────────────────────────────
DROP INDEX IF EXISTS idx_supplier_txn_ap_aging_v2;

-- ── Step 2: Rebuild index with correct entry_type values ──────────────────────
CREATE INDEX IF NOT EXISTS idx_supplier_txn_ap_aging_v2
  ON supplier_transactions(company_id, supplier_code, entry_type, is_matched, due_date)
  WHERE entry_type IN ('د', 'م');

-- ── Step 3: Rebuild supplier_ap_ledger VIEW with correct entry_type values ────
DROP VIEW IF EXISTS supplier_ap_ledger;
CREATE VIEW supplier_ap_ledger AS
SELECT
  st.company_id,
  st.supplier_code,
  s.name                                                     AS supplier_name,
  st.service_type_code,
  st.season_id,
  -- Open invoice summary (entry_type='د' = invoice/debit)
  COUNT(CASE WHEN st.entry_type = 'د' AND st.is_matched = 0 THEN 1 END)
                                                             AS open_invoice_count,
  COALESCE(SUM(CASE WHEN st.entry_type = 'د' AND st.is_matched = 0
                    THEN st.amount ELSE 0 END), 0)           AS open_amount,
  -- Payments applied (entry_type='م' = payment/credit)
  COALESCE(SUM(CASE WHEN st.entry_type = 'م'
                    THEN st.amount ELSE 0 END), 0)           AS paid_amount,
  -- Net AP = what we still owe
  COALESCE(SUM(CASE WHEN st.entry_type = 'د' AND st.is_matched = 0
                    THEN st.amount ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN st.entry_type = 'م'
                    THEN st.amount ELSE 0 END), 0)           AS net_ap_balance,
  -- Aging anchors
  MIN(CASE WHEN st.entry_type = 'د' AND st.is_matched = 0
           THEN st.due_date END)                             AS oldest_due_date,
  MAX(CASE WHEN st.entry_type = 'د' AND st.is_matched = 0
               AND st.due_date IS NOT NULL
               AND st.due_date < date('now')
           THEN CAST(julianday('now') - julianday(st.due_date) AS INTEGER)
           ELSE 0 END)                                       AS days_overdue_max,
  MAX(CASE WHEN st.entry_type = 'د' AND st.is_matched = 0
           THEN COALESCE(st.due_date_estimated, 0) ELSE 0 END)
                                                             AS has_estimated_due_date
FROM supplier_transactions st
LEFT JOIN suppliers s
  ON s.company_id = st.company_id AND s.code = st.supplier_code
WHERE st.status = 'posted'
GROUP BY st.company_id, st.supplier_code, st.service_type_code, st.season_id;

-- ── Verification ──────────────────────────────────────────────────────────────
SELECT
  'migration_0121_complete' AS status,
  (SELECT COUNT(*) FROM sqlite_master
   WHERE type = 'view' AND name = 'supplier_ap_ledger')      AS view_exists,
  (SELECT COUNT(*) FROM sqlite_master
   WHERE type = 'index' AND name = 'idx_supplier_txn_ap_aging_v2') AS index_exists;
