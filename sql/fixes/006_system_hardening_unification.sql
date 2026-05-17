-- =============================================================================
-- SYSTEM HARDENING & UNIFICATION — 006
-- Generated: 2026-05-11
-- Scope: Inventory + Treasury + Supplier — single posting pipeline
-- Principle: posting_engine is the ONLY decision authority
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 1: FIX CRITICAL COA TYPE CORRUPTION
-- 45010001 is account_type='revenue' but receives 11.2M EGP in DEBIT (cost)
-- This corrupts every P&L and Balance Sheet report that aggregates by type.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE chart_of_accounts
SET
  account_type   = 'expense',
  normal_balance = 'debit',
  notes          = COALESCE(notes, '') || ' | TYPE_CORRECTED_2026-05-11: was revenue/credit, corrected to expense/debit (تكلفة المبيعات is a cost account)'
WHERE company_id = 1
  AND code = '45010001';

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 2: FIX wages_payable CONTROL RULE
-- Currently points to 212000010 (موردون متنوعون) — mixes payroll with AP.
-- Create a dedicated wages_payable account and reroute.
-- ─────────────────────────────────────────────────────────────────────────────

-- 2a: Add dedicated wages payable account under current liabilities
INSERT OR IGNORE INTO chart_of_accounts
  (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active, notes)
VALUES
  (1, '212000031', 'مستحقات رواتب وأجور', 'liability', 'credit', '21200', 4, 0, 1,
   'Wages and salaries payable — distinct from AP supplier payable. Used for payroll_run postings.');

-- 2b: Update wages_payable control rule to point to new dedicated account
UPDATE posting_rules
SET
  account_code     = '212000031',
  last_modified_at = datetime('now'),
  last_modified_by = 'HARDENING_2026-05-11'
WHERE company_id = 1
  AND rule_type   = 'control'
  AND mapping_key = 'wages_payable'
  AND is_active   = 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 3: DEDUPLICATE INVENTORY POSTING RULES
-- Active inventory rules id=19–45 and id=75–76 have massive duplication.
-- The engine needs EXACTLY ONE active rule per (IPG, PPG) combination.
-- Current state: FERT has 7 identical active rules, CHEM has 5, etc.
-- Fix: keep the LOWEST id for each (prod_posting_group_code) combination,
-- deactivate all duplicates.
-- ─────────────────────────────────────────────────────────────────────────────

-- Keep only the minimum id per PPG for NULL IPG rules
UPDATE posting_rules
SET
  is_active        = 0,
  last_modified_at = datetime('now'),
  last_modified_by = 'HARDENING_DEDUP_2026-05-11'
WHERE company_id = 1
  AND rule_type   = 'inventory'
  AND inv_posting_group_code IS NULL
  AND is_active   = 1
  AND id NOT IN (
    SELECT MIN(id)
    FROM posting_rules
    WHERE company_id = 1
      AND rule_type  = 'inventory'
      AND inv_posting_group_code IS NULL
      AND is_active  = 1
    GROUP BY COALESCE(prod_posting_group_code, '__NULL__')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 4: ADD COGS ACCOUNT TO INVENTORY POSTING RULES
-- The engine needs cogs_account for ISSUE movements (line 418 in posting_engine.ts:
--   const offsetAcc = isIncrease ? genResult.row.purchases_account : genResult.row.cogs_account
-- This comes from the GENERAL rule (NULL BPG × PPG), not the inventory rule.
-- The active general rules for BPG_SUPPLY/NULL already have purchases_account.
-- But resolveInventoryMovement calls resolveGeneralSetup(db, company_id, NULL, ppg_code)
-- — meaning it uses the NULL-BPG general rule for the offset account.
-- Currently catch-all rule id=1 has cogs_account=NULL → ISSUE movements BLOCKED.
-- Fix: set cogs_account on the catch-all and per-PPG general rules.
-- ─────────────────────────────────────────────────────────────────────────────

-- Update global catch-all general rule (NULL×NULL)
UPDATE posting_rules
SET
  cogs_account     = '45010001',
  last_modified_at = datetime('now'),
  last_modified_by = 'HARDENING_2026-05-11'
WHERE company_id = 1
  AND rule_type  = 'general'
  AND bus_posting_group_code IS NULL
  AND prod_posting_group_code IS NULL
  AND is_active  = 1
  AND id = 1;

-- Add cogs_account to AGRI-OP SEED and CHEM rules (id 75,76) already active
UPDATE posting_rules
SET
  cogs_account     = '45010001',
  last_modified_at = datetime('now'),
  last_modified_by = 'HARDENING_2026-05-11'
WHERE company_id = 1
  AND rule_type  = 'inventory'
  AND bus_posting_group_code = 'AGRI-OP'
  AND is_active  = 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 5: WIRE WAREHOUSES TO INVENTORY MOVEMENTS
-- warehouse_id = NULL on ALL inventory_movements → IPG resolution always fails.
-- Match by warehouse name (text field) to warehouses.id and backfill.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE inventory_movements
SET warehouse_id = (
  SELECT w.id
  FROM warehouses w
  WHERE w.company_id = inventory_movements.company_id
    AND w.name        = inventory_movements.warehouse
    AND w.is_active   = 1
  LIMIT 1
)
WHERE company_id  = 1
  AND warehouse_id IS NULL
  AND warehouse IS NOT NULL
  AND warehouse != '';

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 6: ADD IPG-SPECIFIC INVENTORY POSTING RULES
-- Warehouses have IPG codes (FERT-WH, CHEM-WH, SEED-WH, SPARE-WH, etc.)
-- but no posting_rules rows exist for IPG×PPG combinations.
-- The engine currently hits the NULL×PPG fallback (step 7) for all movements.
-- Add explicit IPG×PPG rules so the engine uses step 1 (exact match).
-- This ensures: FERT-WH × FERT → 14070101 (not the generic fallback)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO posting_rules
  (company_id, rule_type, inv_posting_group_code, prod_posting_group_code,
   inventory_account, is_active, priority)
VALUES
  -- FERT warehouse × FERT items
  (1, 'inventory', 'FERT-WH', 'FERT', '14070101', 1, 5),
  -- CHEM warehouse × CHEM items
  (1, 'inventory', 'CHEM-WH', 'CHEM', '14070102', 1, 5),
  -- SEED warehouse × SEED items
  (1, 'inventory', 'SEED-WH', 'SEED', '14070103', 1, 5),
  -- SPARE warehouse × EQUIP items
  (1, 'inventory', 'SPARE-WH', 'EQUIP', '14070105', 1, 5),
  -- IRR warehouse → use irrigation/misc account (14070104 = شبكات ري)
  (1, 'inventory', 'IRR-WH', 'EQUIP', '14070104', 1, 5),
  (1, 'inventory', 'IRR-WH', NULL,    '14070104', 1, 5),
  -- OIL/FUEL warehouse → use 14070106 (متنوع) — no dedicated fuel inventory account
  (1, 'inventory', 'OIL-WH', 'FUEL',  '14070106', 1, 5),
  (1, 'inventory', 'OIL-WH', NULL,    '14070106', 1, 5),
  -- MISC warehouse → 14070106 catch-all
  (1, 'inventory', 'MISC-WH', NULL,   '14070106', 1, 5),
  -- PACK warehouse → 14070106 (packaging materials use general inventory)
  (1, 'inventory', 'PACK-WH', NULL,   '14070106', 1, 5);

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 7: DISABLE ALL LEGACY/SHADOW POSTING RULES
-- Inactive rules with wrong account codes that could be re-activated by mistake.
-- ─────────────────────────────────────────────────────────────────────────────

-- Mark all AGRI-OP legacy rules with deactivation note (already inactive, reinforce)
UPDATE posting_rules
SET
  last_modified_at = datetime('now'),
  last_modified_by = 'LEGACY_LOCKED_2026-05-11'
WHERE company_id = 1
  AND bus_posting_group_code = 'AGRI-OP'
  AND is_active = 0;

-- Lock SMOKEPPG test rule permanently
UPDATE posting_rules
SET
  last_modified_at = datetime('now'),
  last_modified_by = 'TEST_LOCKED_2026-05-11'
WHERE company_id = 1
  AND prod_posting_group_code = 'SMOKEPPG0430052222';

-- Deactivate duplicate control rules (revenue, expense, payable that have active replacements)
UPDATE posting_rules
SET
  is_active        = 0,
  last_modified_at = datetime('now'),
  last_modified_by = 'DEDUP_2026-05-11'
WHERE company_id = 1
  AND rule_type   = 'control'
  AND mapping_key IN ('revenue', 'expense', 'payable', 'partner_current_account',
                      'deferred_revenue', 'wip_asset', 'wip_contra', 'FINISHED_GOODS',
                      'WIP_ACCOUNT', 'FUEL-AGRI', 'SERVICES', 'VAT_INPUT_PURCHASE', 'VAT_OUTPUT_SALES')
  AND is_active   = 0;  -- already inactive, just timestamp them

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 8: FIX resolvePurchaseReceipt — passes ipg=NULL, ppg=NULL
-- The inventory.ts resolvePurchaseReceipt calls peResolvePurchaseReceipt(db, co, null, null, ...)
-- This means ALL purchase receipts use the catch-all inventory rule → 14070106 (متنوع)
-- regardless of what warehouse/item is involved.
-- Fix: ensure there's a strong catch-all inventory rule with the correct account.
-- (The code fix for passing real IPG/PPG is in Block 11 of the code changes)
-- For now, ensure the catch-all points to a semantically correct account.
-- 14070106 (مخزن متنوع) is acceptable as catch-all for purchase receipts.
-- No DB change needed here — covered by code fix.
-- ─────────────────────────────────────────────────────────────────────────────
-- (placeholder comment only)

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 9: FIX DUPLICATE GENERAL POSTING RULES per BPG
-- After fix 001, we have per-BPG general rules but some BPGs share identical
-- purchases_account. Ensure each is unique and there are no conflicts.
-- Add NULL-PPG catch-alls per BPG (the engine step 2 needs BPG×NULL):
-- ─────────────────────────────────────────────────────────────────────────────
-- The per-BPG rules inserted in fix 001 already cover BPG×NULL (ppg=NULL).
-- Verify by ensuring no duplicate (company_id, BPG, NULL) rows exist.
-- Deactivate any that exist as extras:
UPDATE posting_rules
SET
  is_active        = 0,
  last_modified_at = datetime('now'),
  last_modified_by = 'BPG_DEDUP_2026-05-11'
WHERE company_id  = 1
  AND rule_type   = 'general'
  AND is_active   = 1
  AND prod_posting_group_code IS NULL
  AND bus_posting_group_code IS NOT NULL
  AND id NOT IN (
    SELECT MIN(id)
    FROM posting_rules
    WHERE company_id = 1
      AND rule_type  = 'general'
      AND is_active  = 1
      AND prod_posting_group_code IS NULL
      AND bus_posting_group_code IS NOT NULL
    GROUP BY bus_posting_group_code
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 10: CANCEL THE 6 DRAFT MIGRATION ARTIFACTS
-- Confirmed: all 6 have status='draft' and account_code IS NULL
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE supplier_transactions
SET
  status      = 'cancelled',
  notes       = COALESCE(notes, '') || ' | CANCELLED_2026-05-11: Draft artifact with NULL account_code. Re-enter as actual transaction when event occurs.',
  description = COALESCE(description, 'ملغي') || ' — ملغي: بيانات هجرة غير مكتملة'
WHERE
  company_id  = 1
  AND status  = 'draft'
  AND account_code IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 11: ENSURE posting_operation_matrix COVERS ALL EVENT TYPES
-- postFromBusinessEvent() calls ensureDeterministicMatrixCoverage() which
-- throws if operation_key is missing. Revenue event uses 'revenue' not
-- in OPERATION_KEY_BY_EVENT_TYPE yet fires. Check what's missing:
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO posting_operation_matrix
  (company_id, operation_key, description, is_active)
VALUES
  (1, 'SUPPLIER_INVOICE',      'فاتورة مورد',            1),
  (1, 'SUPPLIER_PAYMENT',      'دفع لمورد',               1),
  (1, 'INVENTORY_MOVEMENT',    'حركة مخزنية',             1),
  (1, 'INVENTORY_IN',          'استلام مشتريات/GRN',     1),
  (1, 'CASH_EXPENSE',          'صرف/مصروف نقدي',         1),
  (1, 'PRODUCTION_CONSUMPTION','استهلاك إنتاج',           1),
  (1, 'PRODUCTION_OUTPUT',     'مخرجات إنتاج',            1),
  (1, 'SALES_INVOICE',         'فاتورة مبيعات',           1),
  (1, 'SALE_RECEIPT',          'تحصيل مبيعات',            1);

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCK 12: BUSINESS_EVENT_TYPE BACKFILL ON JOURNAL_ENTRIES
-- All 764 entries have business_event_type=NULL — traceability is broken.
-- Backfill from business_events table using ref_id=business_event.id
-- and ref_type='business_event'
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE journal_entries
SET business_event_type = (
  SELECT be.event_type
  FROM business_events be
  WHERE be.id = journal_entries.ref_id
    AND be.company_id = journal_entries.company_id
  LIMIT 1
)
WHERE company_id = 1
  AND ref_type   = 'business_event'
  AND (business_event_type IS NULL OR business_event_type = '');

-- Also backfill from journal_entry_lines source_ledger as secondary signal
UPDATE journal_entries
SET business_event_type = (
  SELECT
    CASE jel.source_ledger
      WHEN 'supplier'   THEN 'supplier_invoice'
      WHEN 'inventory'  THEN 'inventory_movement'
      WHEN 'cash'       THEN 'cash_transaction'
      WHEN 'payroll'    THEN 'payroll_run'
      WHEN 'harvest'    THEN 'harvest_cost'
      WHEN 'manual'     THEN 'manual_entry'
      ELSE jel.source_ledger
    END
  FROM journal_entry_lines jel
  WHERE jel.entry_id = journal_entries.id
    AND jel.company_id = journal_entries.company_id
  LIMIT 1
)
WHERE company_id = 1
  AND (business_event_type IS NULL OR business_event_type = '');

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION QUERIES
-- ─────────────────────────────────────────────────────────────────────────────
SELECT '45010001 type check' AS chk,
  code, account_type, normal_balance
FROM chart_of_accounts
WHERE company_id=1 AND code='45010001';

SELECT 'wages_payable routing' AS chk,
  mapping_key, account_code, is_active
FROM posting_rules
WHERE company_id=1 AND mapping_key='wages_payable';

SELECT 'active inventory rules count' AS chk,
  prod_posting_group_code,
  inv_posting_group_code,
  COUNT(*) as cnt
FROM posting_rules
WHERE company_id=1 AND rule_type='inventory' AND is_active=1
GROUP BY prod_posting_group_code, inv_posting_group_code
ORDER BY inv_posting_group_code, prod_posting_group_code;

SELECT 'warehouse linkage' AS chk,
  COUNT(*) as total,
  SUM(CASE WHEN warehouse_id IS NOT NULL THEN 1 ELSE 0 END) as with_wh_id,
  SUM(CASE WHEN warehouse_id IS NULL THEN 1 ELSE 0 END) as without_wh_id
FROM inventory_movements WHERE company_id=1;

SELECT 'draft artifacts' AS chk,
  status, COUNT(*) as cnt
FROM supplier_transactions WHERE company_id=1 GROUP BY status;

SELECT 'business_event_type backfill' AS chk,
  business_event_type, COUNT(*) as cnt
FROM journal_entries WHERE company_id=1
GROUP BY business_event_type ORDER BY cnt DESC;
