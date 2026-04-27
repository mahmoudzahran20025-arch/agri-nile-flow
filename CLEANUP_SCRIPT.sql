-- ============================================
-- SYSTEM CLEANUP SCRIPT
-- Date: 2026-04-27
-- Purpose: Remove unused tables and deprecated data
-- Status: READY TO REVIEW (DO NOT EXECUTE YET)
-- ============================================

BEGIN TRANSACTION;

-- ============================================
-- SECTION 0: SAFETY CHECKS
-- ============================================
-- 1) Run on staging first
-- 2) Ensure backups exist
-- 3) Verify table counts from DATABASE_AUDIT_REPORT.md

-- ============================================
-- SECTION 1: OPTIONAL BACKUP SNAPSHOTS
-- ============================================
-- CREATE TABLE backup_gl_account_mappings_20260427 AS SELECT * FROM gl_account_mappings;
-- CREATE TABLE backup_accounts_20260427 AS SELECT * FROM accounts;
-- CREATE TABLE backup_transaction_mapping_rules_20260427 AS SELECT * FROM transaction_mapping_rules;

-- ============================================
-- SECTION 2: DEPRECATE LEGACY TABLES (SAFE)
-- ============================================
-- NOTE: Cloudflare D1 does NOT support ALTER TABLE ADD COLUMN IF NOT EXISTS
-- Keep this statement once only.

ALTER TABLE gl_account_mappings ADD COLUMN deprecated INTEGER DEFAULT 1;
UPDATE gl_account_mappings SET deprecated = 1 WHERE deprecated IS NULL;

-- ============================================
-- SECTION 3: DROP CANDIDATES (COMMENTED FOR REVIEW)
-- ============================================
-- Un-comment only after functional verification and backup.

-- DROP TABLE IF EXISTS accounts;
-- DROP TABLE IF EXISTS transaction_mapping_rules;

-- Optional cleanup candidates if still zero rows after two release cycles:
-- DROP TABLE IF EXISTS approval_requests;
-- DROP TABLE IF EXISTS approval_actions;
-- DROP TABLE IF EXISTS inventory_adjustments;
-- DROP TABLE IF EXISTS inventory_adjustment_lines;

-- ============================================
-- SECTION 4: INDEX / PERF SAFETY (NO-OP IF EXISTS)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_gam_company_key ON gl_account_mappings(company_id, mapping_key);

-- ============================================
-- SECTION 5: VERIFY CLEANUP PLAN STATE
-- ============================================
SELECT 'Verification snapshot' AS status;

SELECT name
FROM sqlite_master
WHERE type='table'
  AND name IN (
    'accounts',
    'transaction_mapping_rules',
    'gl_account_mappings',
    'approval_requests',
    'approval_actions'
  )
ORDER BY name;

SELECT COUNT(*) AS gl_account_mappings_rows FROM gl_account_mappings;
SELECT COUNT(*) AS legacy_accounts_rows FROM accounts;
SELECT COUNT(*) AS tx_mapping_rules_rows FROM transaction_mapping_rules;

-- Expected after review-only run:
-- - tables still exist (drops are commented)
-- - gl_account_mappings has deprecated column populated

COMMIT;

-- ============================================
-- ROLLBACK INSTRUCTIONS
-- ============================================
-- If any statement fails:
-- 1) ROLLBACK;
-- 2) Review failing statement
-- 3) Fix script and re-run in staging
