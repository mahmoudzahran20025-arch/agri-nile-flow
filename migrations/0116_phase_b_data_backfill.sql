-- =============================================================================
-- Migration 0116 — Phase B Data Backfill (Execution)
-- Date: 2026-05-15
-- Phase: B — Deterministic, auditable backfill of NULL dimensions
--
-- Context:
--   The backfill queries were scaffolded as advisory comments in 0112.
--   Phase A (0109-0112 + 0115 emergency) is confirmed applied.
--   This migration executes all four backfill blocks unconditionally.
--   All UPDATEs are idempotent (WHERE clause guards prevent re-processing).
--
-- Rollback:
--   B-1: UPDATE items SET prod_posting_group_code = NULL, inv_posting_group_code = NULL
--        WHERE ... (impractical — no original value to restore; rollback = re-run inference)
--   B-2: UPDATE supplier_transactions SET due_date = NULL WHERE due_date_estimated = 1
--   B-3: UPDATE supplier_transactions SET invoice_ref = NULL WHERE invoice_ref_backfilled = 1
--   B-4: UPDATE supplier_transactions SET statement_text = NULL WHERE statement_text_backfilled = 1
-- =============================================================================

-- ── PHASE B-1: Backfill items.prod_posting_group_code from item_ppg_inferred ──
-- Uses the VIEW created in migration 0111 which infers PPG from item category
-- and name heuristics. Only updates rows where PPG is currently NULL.
UPDATE items
SET
  prod_posting_group_code = inf.inferred_ppg,
  inv_posting_group_code  = COALESCE(inf.inferred_ipg, inv_posting_group_code)
FROM item_ppg_inferred inf
WHERE items.code                = inf.item_code
  AND items.company_id          = inf.company_id
  AND items.prod_posting_group_code IS NULL
  AND inf.inferred_ppg IS NOT NULL;

-- ── PHASE B-2: Backfill supplier_transactions.due_date ────────────────────────
-- Rule: due_date = transaction_date + 30 days, flagged as estimated.
-- Only applies to: posted invoices with NULL due_date.
UPDATE supplier_transactions
SET
  due_date           = date(transaction_date, '+30 days'),
  due_date_estimated = 1
WHERE entry_type       = 'invoice'
  AND due_date         IS NULL
  AND status           = 'posted'
  AND transaction_date IS NOT NULL;

-- ── PHASE B-3: Backfill supplier_transactions.invoice_ref ─────────────────────
-- AP aging joins on invoice_ref to match payments to invoices.
-- Where NULL and document_number exists, copy document_number as invoice_ref.
ALTER TABLE supplier_transactions ADD COLUMN IF NOT EXISTS invoice_ref_backfilled INTEGER NOT NULL DEFAULT 0;

UPDATE supplier_transactions
SET
  invoice_ref           = CAST(document_number AS TEXT),
  invoice_ref_backfilled = 1
WHERE entry_type      = 'invoice'
  AND invoice_ref     IS NULL
  AND document_number IS NOT NULL
  AND status          = 'posted';

-- ── PHASE B-4: Backfill supplier_transactions.statement_text ──────────────────
-- dimension_validator.ts requires statement_text >= 3 chars for new ISSUE records.
-- Historical rows predate this rule — backfill with notes, then service-type fallback.
ALTER TABLE supplier_transactions ADD COLUMN IF NOT EXISTS statement_text_backfilled INTEGER NOT NULL DEFAULT 0;

-- Step 1: fill from notes field where available and long enough
UPDATE supplier_transactions
SET
  statement_text           = TRIM(notes),
  statement_text_backfilled = 1
WHERE status = 'posted'
  AND (statement_text IS NULL OR LENGTH(TRIM(statement_text)) < 3)
  AND notes IS NOT NULL
  AND LENGTH(TRIM(notes)) >= 3;

-- Step 2: remaining rows without usable notes — fall back to service_type_code label
UPDATE supplier_transactions
SET
  statement_text            = CASE service_type_code
    WHEN 'SRV_MECH'        THEN 'فاتورة ميكنة تاريخية'
    WHEN 'SRV_LABOR'       THEN 'فاتورة عمالة تاريخية'
    WHEN 'SRV_SUPPLY'      THEN 'فاتورة توريد تاريخية'
    WHEN 'SRV_SUPERVISION' THEN 'فاتورة إشراف زراعي تاريخية'
    WHEN 'SRV_SPARE_PARTS' THEN 'فاتورة قطع غيار تاريخية'
    WHEN 'SRV_LOGISTICS'   THEN 'فاتورة نقل وشحن تاريخية'
    ELSE                        'حركة مالية تاريخية'
  END,
  statement_text_backfilled = 1
WHERE status = 'posted'
  AND (statement_text IS NULL OR LENGTH(TRIM(statement_text)) < 3);

-- ── PHASE B-5: Verify fields.area_feddan population ──────────────────────────
-- area_feddan already exists on fields (migration 004).
-- No automated backfill possible — values are agronomically measured.
-- The verification SELECT below shows which pivots need manual entry.

-- ── PHASE B-GATE: Verification queries ───────────────────────────────────────
SELECT
  'phase_b_backfill_complete'                                               AS status,

  -- B-1 gate: must be 0 (or only un-inferrable items remain)
  (SELECT COUNT(*) FROM items WHERE prod_posting_group_code IS NULL)        AS items_null_ppg_remaining,

  -- B-2 gate: must be 0
  (SELECT COUNT(*) FROM supplier_transactions
   WHERE entry_type = 'invoice' AND due_date IS NULL AND status = 'posted') AS invoices_null_due_date_remaining,

  -- B-3: count of backfilled invoice_ref rows
  (SELECT COUNT(*) FROM supplier_transactions
   WHERE invoice_ref_backfilled = 1)                                        AS invoice_ref_backfilled_count,

  -- B-4: count of backfilled statement_text rows
  (SELECT COUNT(*) FROM supplier_transactions
   WHERE statement_text_backfilled = 1)                                     AS statement_text_backfilled_count,

  -- B-5: fields missing area_feddan (manual action required for these)
  (SELECT COUNT(*) FROM fields WHERE COALESCE(area_feddan, 0) = 0)          AS fields_missing_area_feddan;
