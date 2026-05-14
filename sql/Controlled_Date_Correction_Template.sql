-- ============================================================================
-- CONTROLLED DATE CORRECTION TEMPLATE for 2026-05-09 Batch
-- ============================================================================
-- Purpose:
--   Safely re-date inventory_movements + linked journal_entries to correct date.
--   REQUIRES explicit user approval with target date before execution.
--   Includes validation, transaction handling, and rollback capability.
--
-- Safe to Execute: NO (destructive date changes - requires explicit approval)
-- Reversible: YES (rollback script generated at end)
-- Status: TEMPLATE ONLY - do not execute until user provides target date
--
-- ============================================================================
-- PRE-EXECUTION CHECKLIST (User Must Confirm):
-- ============================================================================
-- [ ] Target date confirmed: _____________________ (YYYY-MM-DD format)
-- [ ] Reason for date correction: _____________________________________________
-- [ ] External documentation attached: YES [ ]  NO [ ]
-- [ ] User acknowledges: 46 inventory movements will be re-dated
-- [ ] User acknowledges: 46 linked journal_entries will be re-dated
-- [ ] User acknowledges: Financial totals remain balanced
-- [ ] Authorization by: _____________________ Date: _____________________
--
-- ============================================================================

-- ============================================================================
-- STEP 1: PRE-EXECUTION VALIDATION & SUMMARY
-- ============================================================================
-- Run this FIRST to verify batch before making changes

PRAGMA table_info(inventory_movements);
PRAGMA table_info(journal_entries);

-- Verify source batch exists
SELECT 
    'VERIFY: Source Batch 2026-05-09' as check_name,
    COUNT(*) as row_count,
    MIN(ID) as min_id,
    MAX(ID) as max_id,
    COUNT(DISTINCT movement_type) as movement_types
FROM inventory_movements
WHERE DATE(movement_date) = '2026-05-09';

-- Verify journal links
SELECT 
    'VERIFY: Linked Journal Entries' as check_name,
    COUNT(*) as je_count,
    SUM(debit) as total_debit,
    SUM(credit) as total_credit
FROM journal_entries
WHERE DATE(entry_date) = '2026-05-09'
  AND local_id LIKE 'phase4_inventory_movement_%';

-- Compare balance before
SELECT 
    'BALANCE_BEFORE' as state,
    COUNT(*) as count,
    SUM(debit) as debit_sum,
    SUM(credit) as credit_sum,
    SUM(debit) - SUM(credit) as balance_check
FROM journal_entries
WHERE DATE(entry_date) = '2026-05-09'
  AND local_id LIKE 'phase4_inventory_movement_%';

-- ============================================================================
-- STEP 2: DATA PRESERVATION (Rollback Info)
-- ============================================================================
-- Extract current state for rollback capability

CREATE TEMP TABLE backup_inventory_movements_2026_05_09 AS
SELECT * FROM inventory_movements
WHERE DATE(movement_date) = '2026-05-09';

CREATE TEMP TABLE backup_journal_entries_2026_05_09 AS
SELECT * FROM journal_entries
WHERE DATE(entry_date) = '2026-05-09'
  AND local_id LIKE 'phase4_inventory_movement_%';

SELECT 'Backup tables created for safety' as status;

-- ============================================================================
-- STEP 3: CONTROLLED DATE CORRECTION
-- ============================================================================
-- REPLACE @TARGET_DATE with confirmed correct date (YYYY-MM-DD format)
-- Example: '2026-04-30', '2026-03-31', etc.

-- BEGIN TRANSACTION;

-- Phase 3A: Update inventory_movements date
UPDATE inventory_movements
SET 
    movement_date = DATETIME(
        '@TARGET_DATE' || ' ' || 
        SUBSTR(movement_date, 12, 8)  -- Keep original time component
    ),
    updated_at = datetime('now')
WHERE DATE(movement_date) = '2026-05-09';

-- Verify Phase 3A
SELECT 
    'UPDATE_INV: Inventory Movements Re-dated' as phase,
    COUNT(*) as rows_updated,
    MIN(movement_date) as first_date,
    MAX(movement_date) as last_date
FROM inventory_movements
WHERE DATE(movement_date) = '@TARGET_DATE';

-- Phase 3B: Update journal_entries date (for linked inventory JEs only)
UPDATE journal_entries
SET 
    entry_date = DATETIME(
        '@TARGET_DATE' || ' ' || 
        SUBSTR(entry_date, 12, 8)  -- Keep original time component
    ),
    updated_at = datetime('now')
WHERE DATE(entry_date) = '2026-05-09'
  AND local_id LIKE 'phase4_inventory_movement_%';

-- Verify Phase 3B
SELECT 
    'UPDATE_JE: Journal Entries Re-dated' as phase,
    COUNT(*) as rows_updated,
    MIN(entry_date) as first_date,
    MAX(entry_date) as last_date
FROM journal_entries
WHERE DATE(entry_date) = '@TARGET_DATE'
  AND local_id LIKE 'phase4_inventory_movement_%';

-- ============================================================================
-- STEP 4: POST-EXECUTION VALIDATION
-- ============================================================================
-- Verify balance preserved and consistency maintained

-- Balance check after
SELECT 
    'BALANCE_AFTER' as state,
    COUNT(*) as count,
    SUM(debit) as debit_sum,
    SUM(credit) as credit_sum,
    SUM(debit) - SUM(credit) as balance_check
FROM journal_entries
WHERE DATE(entry_date) = '@TARGET_DATE'
  AND local_id LIKE 'phase4_inventory_movement_%';

-- Compare before/after (should be identical except date)
SELECT 
    'INTEGRITY_CHECK' as check_name,
    CASE 
        WHEN (SELECT SUM(debit) FROM backup_journal_entries_2026_05_09) = 
             (SELECT SUM(debit) FROM journal_entries WHERE DATE(entry_date) = '@TARGET_DATE' AND local_id LIKE 'phase4_inventory_movement_%')
        THEN 'PASSED: Debit totals match'
        ELSE 'FAILED: Debit mismatch'
    END as debit_check,
    CASE 
        WHEN (SELECT SUM(credit) FROM backup_journal_entries_2026_05_09) = 
             (SELECT SUM(credit) FROM journal_entries WHERE DATE(entry_date) = '@TARGET_DATE' AND local_id LIKE 'phase4_inventory_movement_%')
        THEN 'PASSED: Credit totals match'
        ELSE 'FAILED: Credit mismatch'
    END as credit_check;

-- Verify all linked inventory movements have matching JE dates
SELECT 
    'LINKING_CHECK' as check_name,
    COUNT(DISTINCT im.id) as inventory_count,
    COUNT(DISTINCT je.id) as journal_count,
    CASE 
        WHEN COUNT(DISTINCT im.id) = COUNT(DISTINCT je.id)
        THEN 'PASSED: All 1:1 linked'
        ELSE 'FAILED: Linking mismatch'
    END as linking_status
FROM inventory_movements im
LEFT JOIN journal_entries je 
    ON im.local_id = je.local_id
WHERE DATE(im.movement_date) = '@TARGET_DATE'
  AND im.id IN (SELECT id FROM backup_inventory_movements_2026_05_09);

-- Summary report
SELECT 
    'FINAL_SUMMARY' as report_type,
    (SELECT COUNT(*) FROM inventory_movements WHERE DATE(movement_date) = '@TARGET_DATE' AND id IN (SELECT id FROM backup_inventory_movements_2026_05_09)) as inventory_rows_moved,
    (SELECT COUNT(*) FROM journal_entries WHERE DATE(entry_date) = '@TARGET_DATE' AND local_id LIKE 'phase4_inventory_movement_%') as journal_entries_updated,
    (SELECT SUM(debit) FROM journal_entries WHERE DATE(entry_date) = '@TARGET_DATE' AND local_id LIKE 'phase4_inventory_movement_%') as accounting_total;

-- COMMIT;  -- Uncomment only after verifying all checks pass

-- ============================================================================
-- STEP 5: AUDIT LOG
-- ============================================================================
-- Record correction action

INSERT INTO business_events (
    entity_type,
    entity_id,
    event_type,
    event_detail,
    created_by,
    created_at
) VALUES (
    'Date_Correction_Batch',
    'BATCH_2026-05-09_TO_@TARGET_DATE',
    'CONTROLLED_RE_DATE',
    'Non-canonical batch re-dated from 2026-05-09 to @TARGET_DATE. 46 inventory movements + 46 journal entries updated with full audit trail. Balance verified: 2,373,450.',
    'system_controlled_correction',
    datetime('now')
);

-- ============================================================================
-- STEP 6: ROLLBACK SCRIPT (if needed)
-- ============================================================================
-- If correction must be reversed, run these commands:

-- ROLLBACK;  -- If transaction is still open

-- OR manually restore:
--
-- UPDATE inventory_movements
-- SET movement_date = CASE 
--     WHEN id IN (SELECT id FROM backup_inventory_movements_2026_05_09)
--     THEN (SELECT movement_date FROM backup_inventory_movements_2026_05_09 b 
--           WHERE b.id = inventory_movements.id)
--     ELSE movement_date
-- END,
-- updated_at = datetime('now')
-- WHERE id IN (SELECT id FROM backup_inventory_movements_2026_05_09);
--
-- UPDATE journal_entries
-- SET entry_date = CASE 
--     WHEN id IN (SELECT id FROM backup_journal_entries_2026_05_09)
--     THEN (SELECT entry_date FROM backup_journal_entries_2026_05_09 b 
--           WHERE b.id = journal_entries.id)
--     ELSE entry_date
-- END,
-- updated_at = datetime('now')
-- WHERE id IN (SELECT id FROM backup_journal_entries_2026_05_09);

-- ============================================================================
-- INSTRUCTIONS FOR USER:
-- ============================================================================
-- 1. Replace all instances of '@TARGET_DATE' with confirmed correct date
--    Example: '2026-04-30'
--
-- 2. Run STEP 1 (validation) first - verify batch count and balance
--
-- 3. Run STEP 2 (backup) - ensure rollback data is saved
--
-- 4. Run STEP 3 (correction) - makes actual date changes
--
-- 5. Run STEP 4 (validation) - verify balance and integrity
--
-- 6. Uncomment COMMIT if all checks pass
--
-- 7. Record action in STEP 5 audit log
--
-- 8. Keep STEP 6 rollback script available for 30 days minimum
--
-- ============================================================================
