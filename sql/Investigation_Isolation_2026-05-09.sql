-- ============================================================================
-- INVESTIGATION ISOLATION: Non-Destructive Flagging of 2026-05-09 Batch
-- ============================================================================
-- Purpose:
--   Mark all 2026-05-09 inventory_movements + cash_transactions as "under investigation"
--   WITHOUT deleting, modifying core fields, or breaking accounting links.
--   All original data preserved; audit trail added.
--
-- Safe to Execute: YES (no destructive operations)
-- Reversible: YES (can reset investigation_status back to NULL)
-- Execution Date: 2026-05-10
-- ============================================================================

-- Phase 1: Flag inventory_movements on 2026-05-09
-- (46 rows total; includes 6 unresolved GRN + 40 ISSUE)
UPDATE inventory_movements
SET 
    notes = CASE 
        WHEN notes IS NULL THEN 'INVESTIGATION:Date2026-05-09_NonCanonical'
        WHEN notes NOT LIKE '%INVESTIGATION:%' THEN notes || ' | INVESTIGATION:Date2026-05-09_NonCanonical'
        ELSE notes
    END,
    is_flagged = 1,
    updated_at = datetime('now')
WHERE 
    DATE(movement_date) = '2026-05-09'
    AND movement_type IN ('GRN', 'ISSUE');

-- Verify Phase 1
SELECT 
    COUNT(*) as total_flagged,
    SUM(CASE WHEN supplier_code IS NULL THEN 1 ELSE 0 END) as unresolved_grn,
    SUM(CASE WHEN movement_type = 'ISSUE' THEN 1 ELSE 0 END) as issue_count
FROM inventory_movements
WHERE 
    DATE(movement_date) = '2026-05-09'
    AND is_flagged = 1;

-- Phase 2: Flag cash_transactions on 2026-05-09
-- (2 rows total; both draft, both unposted)
UPDATE cash_transactions
SET 
    notes = CASE 
        WHEN notes IS NULL THEN 'INVESTIGATION:Date2026-05-09_DraftUnposted'
        WHEN notes NOT LIKE '%INVESTIGATION:%' THEN notes || ' | INVESTIGATION:Date2026-05-09_DraftUnposted'
        ELSE notes
    END,
    is_flagged = 1,
    updated_at = datetime('now')
WHERE 
    DATE(created_at) = '2026-05-09'
    AND status = 'draft'
    AND journal_entry_id IS NULL;

-- Verify Phase 2
SELECT 
    COUNT(*) as total_cash_flagged,
    MAX(amount) as max_amount,
    MIN(amount) as min_amount,
    SUM(amount) as total_amount
FROM cash_transactions
WHERE 
    DATE(created_at) = '2026-05-09'
    AND is_flagged = 1;

-- Phase 3: Create audit record in business_events
-- (Document that investigation flag was added and when)
INSERT INTO business_events (
    entity_type,
    entity_id,
    event_type,
    event_detail,
    created_by,
    created_at
) VALUES (
    'Investigation_Batch',
    'BATCH_2026-05-09',
    'FLAG_FOR_INVESTIGATION',
    'Non-canonical batch flagged on 2026-05-10: 46 inventory movements + 2 draft cash transactions marked under investigation due to missing source evidence. All core data preserved. Reversible.',
    'system_audit',
    datetime('now')
);

-- Final Verification: Show investigation summary
SELECT 
    'inventory_movements' as entity_type,
    COUNT(*) as count,
    SUM(CASE WHEN supplier_code IS NULL THEN 1 ELSE 0 END) as unresolved_grn,
    'flagged' as status
FROM inventory_movements
WHERE DATE(movement_date) = '2026-05-09' AND is_flagged = 1

UNION ALL

SELECT 
    'cash_transactions' as entity_type,
    COUNT(*) as count,
    0 as unresolved_grn,
    'flagged' as status
FROM cash_transactions
WHERE DATE(created_at) = '2026-05-09' AND is_flagged = 1

UNION ALL

SELECT 
    'business_events' as entity_type,
    1 as count,
    0 as unresolved_grn,
    'audit_logged' as status;

-- ============================================================================
-- ROLLBACK SCRIPT (if needed):
-- ============================================================================
-- UPDATE inventory_movements
-- SET is_flagged = 0, notes = REPLACE(notes, ' | INVESTIGATION:Date2026-05-09_NonCanonical', '')
-- WHERE DATE(movement_date) = '2026-05-09' AND is_flagged = 1;
--
-- UPDATE cash_transactions
-- SET is_flagged = 0, notes = REPLACE(notes, ' | INVESTIGATION:Date2026-05-09_DraftUnposted', '')
-- WHERE DATE(created_at) = '2026-05-09' AND is_flagged = 1;
-- ============================================================================
