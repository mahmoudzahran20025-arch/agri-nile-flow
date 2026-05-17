-- =============================================================================
-- Migration 0117 — Backfill Flag Columns (D1-compatible)
-- Date: 2026-05-15
--
-- Context:
--   Migration 0116 used "ALTER TABLE ... ADD COLUMN IF NOT EXISTS" which is
--   not valid SQLite/D1 syntax. The actual backfill data (due_date, PPG, etc.)
--   was applied successfully. This migration adds the tracking/audit columns
--   that 0116 failed to create, using standard ALTER TABLE syntax.
--
-- Rollback:
--   D1/SQLite does not support DROP COLUMN on older compatibility modes.
--   These columns are additive-only and safe to leave if rollback is needed.
-- =============================================================================

-- ── invoice_ref_backfilled flag ───────────────────────────────────────────────
ALTER TABLE supplier_transactions ADD COLUMN invoice_ref_backfilled INTEGER NOT NULL DEFAULT 0;

-- Mark rows where invoice_ref was derived from document_number
-- (rows that existed before 0116 and had document_number but no invoice_ref)
-- Since 0116 already ran the UPDATE, we infer: posted invoices with invoice_ref = document_number
UPDATE supplier_transactions
SET invoice_ref_backfilled = 1
WHERE entry_type       = 'invoice'
  AND status           = 'posted'
  AND invoice_ref      IS NOT NULL
  AND document_number  IS NOT NULL
  AND CAST(invoice_ref AS TEXT) = CAST(document_number AS TEXT);

-- ── statement_text_backfilled flag ────────────────────────────────────────────
ALTER TABLE supplier_transactions ADD COLUMN statement_text_backfilled INTEGER NOT NULL DEFAULT 0;

-- Mark rows where statement_text looks like a backfill value (service-type fallback labels)
UPDATE supplier_transactions
SET statement_text_backfilled = 1
WHERE status = 'posted'
  AND statement_text IN (
    'فاتورة ميكنة تاريخية',
    'فاتورة عمالة تاريخية',
    'فاتورة توريد تاريخية',
    'فاتورة إشراف زراعي تاريخية',
    'فاتورة قطع غيار تاريخية',
    'فاتورة نقل وشحن تاريخية',
    'حركة مالية تاريخية'
  );

-- ── Verification ──────────────────────────────────────────────────────────────
SELECT
  'migration_0117_complete'                                                       AS status,
  (SELECT COUNT(*) FROM supplier_transactions WHERE invoice_ref_backfilled = 1)   AS invoice_ref_backfilled_count,
  (SELECT COUNT(*) FROM supplier_transactions WHERE statement_text_backfilled = 1) AS stmt_text_backfilled_count;
