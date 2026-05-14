-- =============================================================================
-- Migration 0112 — Archive Future-Blocked Rows + Phase B Backfill Scaffolding
-- Date: 2026-05-14
-- Phase: A/B boundary (archive is additive; backfill queries are advisory —
--        RUN EACH UPDATE BLOCK SEPARATELY after verifying the SELECT counts)
--
-- Context (from DATA-EXECUTION_PLAN.md + TARGET_ARCHITECTURE.md):
--   52 rows exist with transaction dates in the future as of 2026-05-11:
--     - 6  in supplier_transactions
--     - 46 in inventory_movements
--   Policy: KEEP_BLOCKED — these must NOT be date-tampered or force-posted.
--   They are archived here so they are removed from active query paths,
--   but their source records remain in the original tables (audit trail preserved).
--
-- STRUCTURE:
--   BLOCK 1: _archived_blocked_movements  — archive table
--   BLOCK 2: INSERT future-blocked rows   — copy, do not delete
--   BLOCK 3: Phase B advisory backfill queries (SELECT + UPDATE templates)
--            These are COMMENTED OUT. A human must review the SELECT counts
--            before executing each UPDATE.
--
-- Rollback:
--   DROP TABLE IF EXISTS _archived_blocked_movements;
--   (Source rows in supplier_transactions and inventory_movements are untouched)
-- =============================================================================

-- ── BLOCK 1: Archive table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS _archived_blocked_movements (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  source_table      TEXT    NOT NULL,   -- 'supplier_transactions' | 'inventory_movements'
  source_id         INTEGER NOT NULL,   -- original row id in the source table
  company_id        INTEGER NOT NULL,
  blocking_reason   TEXT    NOT NULL,   -- e.g., 'future_date', 'missing_ppg', etc.
  blocking_policy   TEXT    NOT NULL DEFAULT 'KEEP_BLOCKED',
  -- Snapshot of key fields at time of archive
  transaction_date  TEXT,
  amount            REAL,
  supplier_code     INTEGER,
  item_code         INTEGER,
  movement_type     TEXT,
  service_type_code TEXT,
  season_id         INTEGER,
  gl_posting_status TEXT,
  -- Metadata
  archived_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  archived_by       TEXT    NOT NULL DEFAULT 'migration_0112',
  release_condition TEXT,   -- when this block can be released, e.g., 'date >= 2026-06-01'
  notes             TEXT,
  UNIQUE(source_table, source_id)
);

CREATE INDEX IF NOT EXISTS idx_archived_blocked_source
  ON _archived_blocked_movements(source_table, blocking_reason, archived_at);

CREATE INDEX IF NOT EXISTS idx_archived_blocked_company
  ON _archived_blocked_movements(company_id, blocking_policy);

-- ── BLOCK 2: Copy future-blocked rows into archive ────────────────────────────
-- Supplier transactions with future transaction_date
-- (these are the 6 rows identified in the 2026-05-11 audit)
INSERT OR IGNORE INTO _archived_blocked_movements
  (source_table, source_id, company_id, blocking_reason, blocking_policy,
   transaction_date, amount, supplier_code, service_type_code, season_id,
   gl_posting_status, release_condition, notes)
SELECT
  'supplier_transactions',
  st.id,
  st.company_id,
  'future_date',
  'KEEP_BLOCKED',
  st.transaction_date,
  st.amount,
  st.supplier_code,
  st.service_type_code,
  st.season_id,
  'blocked_future',
  'Auto-release when transaction_date <= date(''now'')',
  'Future-dated supplier transaction blocked per 2026-05-11 governance policy'
FROM supplier_transactions st
WHERE st.transaction_date > date('now')
  AND st.status = 'posted';  -- only rows that were meant to post but can't

-- Inventory movements with future movement_date
-- (these are the 46 rows identified in the 2026-05-11 audit)
INSERT OR IGNORE INTO _archived_blocked_movements
  (source_table, source_id, company_id, blocking_reason, blocking_policy,
   transaction_date, amount, supplier_code, item_code, movement_type,
   service_type_code, season_id, gl_posting_status, release_condition, notes)
SELECT
  'inventory_movements',
  im.id,
  im.company_id,
  'future_date',
  'KEEP_BLOCKED',
  im.movement_date,
  (im.qty_in - im.qty_out) * COALESCE(im.unit_price, 0),
  im.supplier_code,
  im.item_code,
  im.movement_type,
  im.service_type_code,
  im.season_id,
  im.gl_posting_status,
  'Auto-release when movement_date <= date(''now'')',
  'Future-dated inventory movement blocked per 2026-05-11 governance policy'
FROM inventory_movements im
WHERE im.movement_date > date('now')
  AND im.gl_posting_status IN ('pending', 'failed', 'outbox_pending');

-- ── BLOCK 3: Phase B backfill advisory queries ────────────────────────────────
-- These are NOT executed by this migration.
-- They are included here as the authoritative backfill script to be run
-- MANUALLY by the operator AFTER reviewing the SELECT counts below.
-- Each block is preceded by a diagnostic SELECT that must return 0 after the UPDATE.

-- ──────────────────────────────────────────────────────────────────────────────
-- PHASE B-1: Backfill items.prod_posting_group_code from inference view
-- DIAGNOSTIC (run first, verify counts):
/*
SELECT inferred_ppg, COUNT(*) AS item_count
FROM item_ppg_inferred
WHERE inferred_ppg IS NOT NULL
GROUP BY inferred_ppg;

SELECT COUNT(*) AS unresolvable_items
FROM item_ppg_inferred
WHERE inferred_ppg IS NULL;
*/
-- EXECUTE (only after reviewing diagnostic):
/*
UPDATE items
SET
  prod_posting_group_code = inf.inferred_ppg,
  inv_posting_group_code  = COALESCE(inf.inferred_ipg, inv_posting_group_code)
FROM item_ppg_inferred inf
WHERE items.code       = inf.item_code
  AND items.company_id = inf.company_id
  AND items.prod_posting_group_code IS NULL
  AND inf.inferred_ppg IS NOT NULL;

-- Verify:
SELECT COUNT(*) AS remaining_null_ppg FROM items WHERE prod_posting_group_code IS NULL;
*/

-- ──────────────────────────────────────────────────────────────────────────────
-- PHASE B-2: Backfill supplier_transactions.due_date for invoices with NULL due_date
-- Rule: due_date = transaction_date + 30 days, flagged as estimated
-- DIAGNOSTIC:
/*
SELECT COUNT(*) AS invoices_missing_due_date
FROM supplier_transactions
WHERE entry_type = 'invoice'
  AND due_date IS NULL
  AND status = 'posted';
*/
-- EXECUTE:
/*
UPDATE supplier_transactions
SET
  due_date           = date(transaction_date, '+30 days'),
  due_date_estimated = 1
WHERE entry_type = 'invoice'
  AND due_date IS NULL
  AND status = 'posted'
  AND transaction_date IS NOT NULL;

-- Verify:
SELECT COUNT(*) AS remaining_null_due_date
FROM supplier_transactions
WHERE entry_type = 'invoice' AND due_date IS NULL AND status = 'posted';
*/

-- ──────────────────────────────────────────────────────────────────────────────
-- PHASE B-3: Backfill supplier_transactions.invoice_ref from document_number
-- DIAGNOSTIC:
/*
SELECT COUNT(*) AS invoices_missing_ref
FROM supplier_transactions
WHERE entry_type = 'invoice'
  AND invoice_ref IS NULL
  AND document_number IS NOT NULL
  AND status = 'posted';
*/
-- EXECUTE:
/*
UPDATE supplier_transactions
SET invoice_ref = CAST(document_number AS TEXT)
WHERE entry_type = 'invoice'
  AND invoice_ref IS NULL
  AND document_number IS NOT NULL
  AND status = 'posted';
*/

-- ──────────────────────────────────────────────────────────────────────────────
-- PHASE B-4: Backfill supplier_transactions.statement_text from notes/narration
-- DIAGNOSTIC:
/*
SELECT COUNT(*) AS missing_statement_text
FROM supplier_transactions
WHERE status = 'posted'
  AND (statement_text IS NULL OR LENGTH(TRIM(statement_text)) < 3);
*/
-- EXECUTE (fill from notes where available):
/*
UPDATE supplier_transactions
SET statement_text = TRIM(notes)
WHERE status = 'posted'
  AND (statement_text IS NULL OR LENGTH(TRIM(statement_text)) < 3)
  AND notes IS NOT NULL
  AND LENGTH(TRIM(notes)) >= 3;

-- For any remaining: fill with a generic description based on service_type_code
UPDATE supplier_transactions
SET statement_text = CASE service_type_code
  WHEN 'SRV_MECH'       THEN 'فاتورة ميكنة تاريخية'
  WHEN 'SRV_LABOR'      THEN 'فاتورة عمالة تاريخية'
  WHEN 'SRV_SUPPLY'     THEN 'فاتورة توريد تاريخية'
  WHEN 'SRV_SUPERVISION'THEN 'فاتورة إشراف زراعي تاريخية'
  WHEN 'SRV_SPARE_PARTS'THEN 'فاتورة قطع غيار تاريخية'
  WHEN 'SRV_LOGISTICS'  THEN 'فاتورة نقل وشحن تاريخية'
  ELSE 'حركة مالية تاريخية'
END
WHERE status = 'posted'
  AND (statement_text IS NULL OR LENGTH(TRIM(statement_text)) < 3);
*/

-- ── BLOCK 4: Verification ─────────────────────────────────────────────────────
SELECT
  'migration_0112_complete'                                                AS status,
  (SELECT COUNT(*) FROM _archived_blocked_movements)                      AS total_archived,
  (SELECT COUNT(*) FROM _archived_blocked_movements WHERE source_table='supplier_transactions') AS archived_supplier,
  (SELECT COUNT(*) FROM _archived_blocked_movements WHERE source_table='inventory_movements')   AS archived_inventory,
  -- Quick read on Phase B backfill readiness:
  (SELECT COUNT(*) FROM items WHERE prod_posting_group_code IS NULL)      AS items_still_missing_ppg,
  (SELECT COUNT(*) FROM supplier_transactions
   WHERE entry_type='invoice' AND due_date IS NULL AND status='posted')   AS invoices_missing_due_date;
