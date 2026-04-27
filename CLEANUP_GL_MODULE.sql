-- =============================================================================
-- CLEANUP_GL_MODULE.sql
-- GL Module — Safe Cleanup Script
-- Date: 2026-04-27
-- Audited by: GitHub Copilot (based on live D1 queries)
-- =============================================================================
--
-- SAFETY RULES:
--   ❌ NO DROP TABLE statements
--   ❌ NO DELETE of real financial data (journal_entries / journal_entry_lines)
--   ❌ NO UPDATE of posted transactions
--   ✅ Only cleanup of structural issues, stale drafts, and ghost references
--   ✅ All statements are idempotent (safe to re-run)
--
-- HOW TO RUN:
--   npx wrangler d1 execute agri-nile-flow-data-lake --remote --file=CLEANUP_GL_MODULE.sql
--
-- CURRENT STATE (2026-04-27):
--   - 0 orphan journal_entry_lines ✅ (already clean)
--   - 0 unbalanced journal entries ✅ (already clean)
--   - 0 ghost account mappings ✅ (fixed by FIX_ghost_mappings.sql)
--   - 0 posting group rows (empty slate — correct for Phase 4)
--   - posting_engine feature flag = 0 (engine OFF — correct)
--
-- VERDICT: The GL module is STRUCTURALLY CLEAN as of audit date.
--          No destructive cleanup is required. This script contains
--          only OPTIONAL maintenance statements clearly labeled.
-- =============================================================================


-- =============================================================================
-- SECTION 1: VERIFY CURRENT INTEGRITY (read-only checks)
-- Run these SELECT statements first to confirm clean state before proceeding.
-- =============================================================================

-- 1a. Orphan journal_entry_lines (should be 0)
SELECT 'ORPHAN_LINES' as check_name,
       COUNT(*) as count,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL - action needed' END as status
FROM journal_entry_lines
WHERE entry_id NOT IN (SELECT id FROM journal_entries);

-- 1b. Unbalanced journal entries (should be 0)
SELECT 'UNBALANCED_ENTRIES' as check_name,
       COUNT(*) as count,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL - action needed' END as status
FROM (
  SELECT entry_id, SUM(debit) as td, SUM(credit) as tc
  FROM journal_entry_lines
  GROUP BY entry_id
  HAVING ABS(td - tc) > 0.01
);

-- 1c. Ghost account mappings (should be 0)
SELECT 'GHOST_MAPPINGS' as check_name,
       COUNT(*) as count,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL - run FIX_ghost_mappings.sql' END as status
FROM gl_account_mappings m
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts c
  WHERE c.company_id = m.company_id AND c.code = m.account_code
);

-- 1d. Entries with zero lines (should be 0)
SELECT 'ENTRIES_WITHOUT_LINES' as check_name,
       COUNT(*) as count,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL - investigate manually' END as status
FROM journal_entries j
WHERE NOT EXISTS (
  SELECT 1 FROM journal_entry_lines l WHERE l.entry_id = j.id
);

-- 1e. Posting groups setup completeness
SELECT 'POSTING_SETUP_READY' as check_name,
       (SELECT COUNT(*) FROM general_posting_setup WHERE company_id = 1
        AND bus_posting_group_code IS NULL AND prod_posting_group_code IS NULL) as general_catchall,
       (SELECT COUNT(*) FROM inventory_posting_setup WHERE company_id = 1
        AND inv_posting_group_code IS NULL AND prod_posting_group_code IS NULL) as inventory_catchall;


-- =============================================================================
-- SECTION 2: OPTIONAL — Remove stale draft cash transactions older than 90 days
-- UNCOMMENT ONLY IF: you have reviewed and confirmed these drafts are abandoned.
-- These are cash_transactions with status='draft' that were never posted.
-- =============================================================================

-- SAFETY CHECK first (always run this SELECT before the DELETE):
-- SELECT id, transaction_date, narration, amount
-- FROM cash_transactions
-- WHERE company_id = 1
--   AND status = 'draft'
--   AND transaction_date < date('now', '-90 days');

-- OPTIONAL CLEANUP (uncomment to execute):
-- DELETE FROM cash_transactions
-- WHERE company_id = 1
--   AND status = 'draft'
--   AND transaction_date < date('now', '-90 days');


-- =============================================================================
-- SECTION 3: OPTIONAL — Remove stale draft supplier_transactions (unposted)
-- Same 90-day rule. UNCOMMENT ONLY after manual review.
-- =============================================================================

-- SAFETY CHECK first:
-- SELECT id, transaction_date, notes, amount
-- FROM supplier_transactions
-- WHERE company_id = 1
--   AND status = 'draft'
--   AND transaction_date < date('now', '-90 days');

-- OPTIONAL CLEANUP (uncomment to execute):
-- DELETE FROM supplier_transactions
-- WHERE company_id = 1
--   AND status = 'draft'
--   AND transaction_date < date('now', '-90 days');


-- =============================================================================
-- SECTION 4: OPTIONAL — Remove system_error_logs older than 180 days
-- These are diagnostic logs only and do not affect financial data.
-- =============================================================================

-- SAFETY CHECK first:
-- SELECT COUNT(*) as old_logs
-- FROM system_error_logs
-- WHERE created_at < datetime('now', '-180 days');

-- OPTIONAL CLEANUP (uncomment to execute):
-- DELETE FROM system_error_logs
-- WHERE created_at < datetime('now', '-180 days');


-- =============================================================================
-- SECTION 5: MAINTENANCE — Deactivate old/unused gl_account_mappings
-- Only do this after verifying no active code paths use the mapping_key.
-- Currently ALL 19 mappings are valid and in use — NO action needed.
-- =============================================================================

-- Inventory of all mappings (verify before any changes):
SELECT mapping_key, account_code,
       CASE WHEN c.code IS NOT NULL THEN 'VALID' ELSE 'GHOST' END as coa_status
FROM gl_account_mappings m
LEFT JOIN chart_of_accounts c ON c.company_id = m.company_id AND c.code = m.account_code
WHERE m.company_id = 1
ORDER BY mapping_key;


-- =============================================================================
-- SECTION 6: SEED — Create minimal posting setup catch-all rows
-- RECOMMENDED ACTION: Run this after editing account codes to match your CoA.
-- This enables the posting_engine to function even before specific groups are created.
-- =============================================================================

-- Step 1: Create a generic catch-all Business Posting Group
-- INSERT OR IGNORE INTO business_posting_groups (code, company_id, name, is_active)
-- VALUES ('DEFAULT', 1, 'Default / General', 1);

-- Step 2: Create a generic catch-all Product Posting Group
-- INSERT OR IGNORE INTO product_posting_groups (code, company_id, name, is_active)
-- VALUES ('DEFAULT', 1, 'Default / General', 1);

-- Step 3: Create a generic catch-all Inventory Posting Group
-- INSERT OR IGNORE INTO inventory_posting_groups (code, company_id, name, is_active)
-- VALUES ('DEFAULT', 1, 'Default / General', 1);

-- Step 4: Create the NULL×NULL catch-all general_posting_setup row
-- EDIT these account codes to match your actual Chart of Accounts before running!
-- INSERT OR IGNORE INTO general_posting_setup
--   (company_id, bus_posting_group_code, prod_posting_group_code,
--    sales_account, purchases_account, cogs_account, expense_account, is_active)
-- VALUES
--   (1, NULL, NULL,
--    '4101XXXX',   -- EDIT: your sales/revenue account code
--    '1407XXXX',   -- EDIT: your purchases/inventory account code
--    '4501XXXX',   -- EDIT: your COGS account code
--    '5120XXXX',   -- EDIT: your general expense account code
--    1);

-- Step 5: Create the NULL×NULL catch-all inventory_posting_setup row
-- EDIT account code before running!
-- INSERT OR IGNORE INTO inventory_posting_setup
--   (company_id, inv_posting_group_code, prod_posting_group_code, inventory_account, is_active)
-- VALUES
--   (1, NULL, NULL, '1407XXXX', 1);  -- EDIT: your inventory balance account


-- =============================================================================
-- SECTION 7: ENABLE POSTING ENGINE (FINAL STEP — do this last)
-- Only run after: groups created, setup rows created, health check passes.
-- =============================================================================

-- Enable posting engine (uncomment when ready):
-- UPDATE gl_integration_settings
-- SET is_enabled = 1
-- WHERE company_id = 1 AND module_key = 'posting_engine';

-- Verify:
-- SELECT module_key, is_enabled FROM gl_integration_settings WHERE company_id = 1;


-- =============================================================================
-- END OF SCRIPT
-- Final status check after running any optional sections:
-- =============================================================================

SELECT
  (SELECT COUNT(*) FROM journal_entries WHERE company_id = 1) as total_entries,
  (SELECT COUNT(*) FROM journal_entry_lines WHERE company_id = 1) as total_lines,
  (SELECT COUNT(*) FROM general_posting_setup WHERE company_id = 1) as gps_rows,
  (SELECT COUNT(*) FROM inventory_posting_setup WHERE company_id = 1) as ips_rows,
  (SELECT COUNT(*) FROM business_posting_groups WHERE company_id = 1) as bpg_count,
  (SELECT COUNT(*) FROM product_posting_groups WHERE company_id = 1) as ppg_count,
  (SELECT COUNT(*) FROM inventory_posting_groups WHERE company_id = 1) as ipg_count,
  (SELECT is_enabled FROM gl_integration_settings WHERE company_id = 1 AND module_key = 'posting_engine') as engine_enabled;
