-- =============================================================================
-- Migration 0118 — Schema Hardening (Pre-Import)
-- Date: 2026-05-15
--
-- Purpose:
--   Fix four structural gaps identified before clean data re-import:
--
--   1. fields.area_feddan — no NOT NULL enforcement; division-by-zero in
--      cost-per-feddan reports for any field without an explicit area.
--      SQLite cannot ALTER a column to NOT NULL directly, so we add a
--      CHECK constraint via a trigger on INSERT/UPDATE instead, plus set
--      all current NULL/0 rows to 1 as a safe default.
--
--   2. supplier_transactions.expense_category — old column from the frozen
--      expense_types table. Still being populated by legacy paths. Mark it
--      deprecated by adding a companion column expense_category_deprecated=1
--      so queries can filter it out. The column itself stays for now (SQLite
--      cannot DROP COLUMN in older compat modes) but is frozen at the API
--      layer (0113/0114 already block new expense_types inserts).
--
--   3. inventory_movements.blocking_reason — referenced in migration 0112
--      archive logic but never created. Add it now so the archive table
--      INSERT works correctly on future blocked-movement detection.
--
--   4. supplier_transactions invoice uniqueness — no UNIQUE index exists on
--      (company_id, supplier_code, document_number, entry_type). Double-
--      import will silently create duplicate AP entries. Add partial UNIQUE
--      index covering posted invoices (entry_type='invoice', status='posted').
--
-- Rollback:
--   All changes are additive (new columns, new index, new trigger).
--   D1/SQLite does not support DROP COLUMN or DROP TRIGGER in all modes,
--   but no existing data is modified (except NULL→1 on area_feddan).
-- =============================================================================

-- ── 1. fields.area_feddan NULL / zero guard ──────────────────────────────────

-- Patch any existing NULL or 0 rows to 1 (admin/overhead default)
UPDATE fields
SET area_feddan = 1
WHERE area_feddan IS NULL OR area_feddan = 0;

-- Trigger: block INSERT of NULL or 0 area_feddan going forward
CREATE TRIGGER IF NOT EXISTS trg_fields_area_feddan_insert
BEFORE INSERT ON fields
FOR EACH ROW
WHEN NEW.area_feddan IS NULL OR NEW.area_feddan <= 0
BEGIN
  SELECT RAISE(ABORT, 'area_feddan must be greater than 0');
END;

-- Trigger: block UPDATE to NULL or 0 area_feddan
CREATE TRIGGER IF NOT EXISTS trg_fields_area_feddan_update
BEFORE UPDATE OF area_feddan ON fields
FOR EACH ROW
WHEN NEW.area_feddan IS NULL OR NEW.area_feddan <= 0
BEGIN
  SELECT RAISE(ABORT, 'area_feddan must be greater than 0');
END;


-- ── 2. supplier_transactions.expense_category — mark deprecated ──────────────

-- Add a flag column so application code and queries can detect the deprecated field
ALTER TABLE supplier_transactions ADD COLUMN expense_category_deprecated INTEGER NOT NULL DEFAULT 1;

-- All existing rows where expense_category is populated are legacy rows —
-- mark them so the AP aging / reporting views exclude this column from logic
-- (service_type_code is the authoritative column going forward)
UPDATE supplier_transactions
SET expense_category_deprecated = 1
WHERE expense_category IS NOT NULL;


-- ── 3. inventory_movements.blocking_reason ───────────────────────────────────

-- Used by the future-date blocking logic and the _archived_blocked_movements
-- archive INSERT. Was referenced in 0112 but never created.
ALTER TABLE inventory_movements ADD COLUMN blocking_reason TEXT;

-- Index for fast lookup of blocked movements
CREATE INDEX IF NOT EXISTS idx_im_blocking_reason
  ON inventory_movements(company_id, blocking_reason)
  WHERE blocking_reason IS NOT NULL;


-- ── 4. supplier_transactions invoice uniqueness ──────────────────────────────

-- Prevent double-import of the same invoice.
-- Partial index: only enforce uniqueness on posted invoices with a document_number.
-- Payments (entry_type='payment') and drafts are excluded — they may legitimately
-- reference the same document.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_st_invoice_uniqueness
  ON supplier_transactions(company_id, supplier_code, document_number, entry_type)
  WHERE entry_type = 'invoice'
    AND status     = 'posted'
    AND document_number IS NOT NULL;


-- ── Verification ─────────────────────────────────────────────────────────────
SELECT
  'migration_0118_complete'                                                    AS status,
  (SELECT COUNT(*) FROM fields WHERE area_feddan IS NULL OR area_feddan <= 0)  AS fields_zero_area_remaining,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger'
    AND name IN ('trg_fields_area_feddan_insert','trg_fields_area_feddan_update')) AS area_triggers_created,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='index'
    AND name = 'uidx_st_invoice_uniqueness')                                   AS invoice_unique_index_created,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='index'
    AND name = 'idx_im_blocking_reason')                                       AS blocking_reason_index_created;
