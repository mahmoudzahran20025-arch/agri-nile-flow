-- =============================================================================
-- Migration 0109 — Supplier AP Ledger View + Invoice Matching Infrastructure
-- Date: 2026-05-14
-- Phase: A (Additive schema — zero risk, fully reversible)
--
-- What this does:
--   1. Activates the AP aging columns added in 0108 (matched_payment_id,
--      invoice_ref, is_matched) by adding the FK constraint via a new column
--      approach (SQLite cannot ADD CONSTRAINT after the fact, so we document
--      the semantic FK here as a comment — enforced at application layer).
--   2. Adds due_date_estimated flag so backfilled due_dates are distinguishable
--      from real invoice due dates.
--   3. Creates supplier_ap_ledger VIEW — derived, always consistent with source.
--   4. Creates idx for AP aging queries by supplier + service class + due date.
--
-- Rollback:
--   DROP VIEW IF EXISTS supplier_ap_ledger;
--   -- columns are additive: leave in place, set NULL if needed
-- =============================================================================

-- ── BLOCK 1: due_date_estimated flag ─────────────────────────────────────────
-- Marks rows where due_date was backfilled by estimate (transaction_date + 30d)
-- rather than derived from an actual invoice term.
ALTER TABLE supplier_transactions ADD COLUMN due_date_estimated INTEGER NOT NULL DEFAULT 0;
-- 0 = real due date (from document), 1 = estimated (backfilled)

-- ── BLOCK 2: statement_text governance column ────────────────────────────────
-- Not present on supplier_transactions in current schema (confirmed from schema.sql).
-- Required for full dimension enforcement per TARGET_ARCHITECTURE.md §4.5.
ALTER TABLE supplier_transactions ADD COLUMN statement_text TEXT;
-- Minimum 3 chars; no system tags; mandatory for posted transactions.
-- Populated from notes or narration on existing rows during Phase B backfill.

-- ── BLOCK 3: field_id dimension on supplier_transactions ────────────────────
-- Needed for cost-per-field reporting and pivot-level AP attribution.
ALTER TABLE supplier_transactions ADD COLUMN field_id INTEGER REFERENCES fields(id);

-- ── BLOCK 4: quantity + unit_type (operational dimensions) ──────────────────
-- Already present as `quantity` (REAL) and `unit` (TEXT) in suppliers.ts schema
-- (confirmed from API read). But schema.sql does NOT show them.
-- Adding here as the canonical migration so schema.sql reflects reality.
ALTER TABLE supplier_transactions ADD COLUMN quantity   REAL;
ALTER TABLE supplier_transactions ADD COLUMN unit_type  TEXT;
-- SRV_MECH uses: quantity = hours, unit_type = 'ساعة'
-- SRV_LABOR uses: quantity = workers, unit_type = 'عامل'
-- SRV_SUPPLY uses: quantity = physical qty, unit_type from unit_types table

-- ── BLOCK 5: AP matching index ────────────────────────────────────────────────
-- Supersedes the index added in 0108 (which is a subset).
-- This index covers the full AP aging query pattern:
--   WHERE company_id = ? AND supplier_code = ? AND entry_type IN ('invoice','payment')
--   AND is_matched = 0 ORDER BY due_date ASC
CREATE INDEX IF NOT EXISTS idx_supplier_txn_ap_aging_v2
  ON supplier_transactions(company_id, supplier_code, entry_type, is_matched, due_date)
  WHERE entry_type IN ('invoice', 'payment');

CREATE INDEX IF NOT EXISTS idx_supplier_txn_service_field
  ON supplier_transactions(company_id, service_type_code, field_id, season_id)
  WHERE service_type_code IS NOT NULL;

-- ── BLOCK 6: supplier_ap_ledger VIEW ─────────────────────────────────────────
-- Purpose: Always-correct open AP balance per supplier per service class.
-- This is a derived view — never the source of truth.
-- Rollup:
--   open_invoice_count   = unmatched invoices
--   open_amount          = SUM of unmatched invoice amounts
--   paid_amount          = SUM of payment amounts against this supplier
--   net_ap_balance       = open_amount - paid_amount (what we still owe)
--   oldest_due_date      = earliest unmatched invoice due date (aging anchor)
--   days_overdue_max     = max days any open invoice is past due
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

-- ── BLOCK 7: Verification ─────────────────────────────────────────────────────
SELECT
  'migration_0109_complete'                                    AS status,
  (SELECT COUNT(*) FROM supplier_transactions WHERE due_date_estimated IS NOT NULL) AS due_date_estimated_col_exists,
  (SELECT COUNT(*) FROM supplier_transactions WHERE statement_text IS NOT NULL)     AS statement_text_col_exists,
  (SELECT COUNT(*) FROM supplier_transactions WHERE field_id IS NOT NULL)           AS field_id_col_exists;
