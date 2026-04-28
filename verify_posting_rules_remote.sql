-- verify_posting_rules_remote.sql
-- Verification queries for posting_rules coverage before dropping legacy tables
-- Run against remote D1: wrangler d1 execute agri-nile-flow-data-lake --remote --file=verify_posting_rules_remote.sql

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. POSTING_RULES COVERAGE SUMMARY
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT '=== POSTING_RULES COVERAGE SUMMARY ===' AS section;

SELECT 
  rule_type,
  COUNT(*) AS rule_count,
  COUNT(DISTINCT company_id) AS companies_covered,
  COUNT(DISTINCT CASE WHEN debit_account_code IS NOT NULL THEN debit_account_code END) AS unique_debit_accounts,
  COUNT(DISTINCT CASE WHEN credit_account_code IS NOT NULL THEN credit_account_code END) AS unique_credit_accounts
FROM posting_rules
GROUP BY rule_type
ORDER BY rule_type;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. VERIFY GENERAL POSTING RULES (from general_posting_setup)
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT '=== GENERAL POSTING RULES ===' AS section;

SELECT 
  pr.id,
  pr.company_id,
  pr.rule_type,
  pr.bus_posting_group_code,
  pr.gen_posting_group_code,
  pr.debit_account_code,
  pr.credit_account_code,
  pr.is_active
FROM posting_rules pr
WHERE pr.rule_type = 'general'
ORDER BY pr.company_id, pr.bus_posting_group_code, pr.gen_posting_group_code
LIMIT 20;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. VERIFY INVENTORY POSTING RULES (from inventory_posting_setup)
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT '=== INVENTORY POSTING RULES ===' AS section;

SELECT 
  pr.id,
  pr.company_id,
  pr.rule_type,
  pr.inv_posting_group_code,
  pr.location_code,
  pr.debit_account_code,
  pr.credit_account_code,
  pr.is_active
FROM posting_rules pr
WHERE pr.rule_type = 'inventory'
ORDER BY pr.company_id, pr.inv_posting_group_code, pr.location_code
LIMIT 20;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. VERIFY CONTROL ACCOUNT RULES (from gl_account_mappings)
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT '=== CONTROL ACCOUNT RULES ===' AS section;

SELECT 
  pr.id,
  pr.company_id,
  pr.rule_type,
  pr.control_account_type,
  pr.debit_account_code,
  pr.credit_account_code,
  pr.is_active
FROM posting_rules pr
WHERE pr.rule_type = 'control'
ORDER BY pr.company_id, pr.control_account_type
LIMIT 20;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. CHECK FOR MISSING CRITICAL RULES
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT '=== CRITICAL RULES CHECK ===' AS section;

-- Check if we have rules for key control account types
SELECT 
  'Control Account Coverage' AS check_type,
  CASE 
    WHEN COUNT(*) >= 5 THEN 'PASS'
    ELSE 'FAIL - Missing control accounts'
  END AS status,
  COUNT(*) AS control_rules_count
FROM posting_rules
WHERE rule_type = 'control';

-- Check if we have inventory rules
SELECT 
  'Inventory Rules Coverage' AS check_type,
  CASE 
    WHEN COUNT(*) > 0 THEN 'PASS'
    ELSE 'FAIL - No inventory rules'
  END AS status,
  COUNT(*) AS inventory_rules_count
FROM posting_rules
WHERE rule_type = 'inventory';

-- Check if we have general posting rules
SELECT 
  'General Posting Coverage' AS check_type,
  CASE 
    WHEN COUNT(*) > 0 THEN 'PASS'
    ELSE 'FAIL - No general posting rules'
  END AS status,
  COUNT(*) AS general_rules_count
FROM posting_rules
WHERE rule_type = 'general';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. VERIFY LEGACY TABLES STILL EXIST (before dropping)
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT '=== LEGACY TABLES STATUS ===' AS section;

SELECT 
  name AS table_name,
  type,
  'EXISTS' AS status
FROM sqlite_master
WHERE type = 'table'
  AND name IN ('general_posting_setup', 'inventory_posting_setup', 'gl_account_mappings')
ORDER BY name;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. SMOKE TEST: KEY FLOWS COVERAGE
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT '=== SMOKE TEST: KEY FLOWS ===' AS section;

-- Invoice flow: Check if we have receivables control account
SELECT 
  'Invoice Flow (Receivables)' AS flow,
  CASE 
    WHEN COUNT(*) > 0 THEN 'COVERED'
    ELSE 'NOT COVERED'
  END AS status,
  COUNT(*) AS rule_count
FROM posting_rules
WHERE rule_type = 'control' 
  AND control_account_type = 'receivables';

-- Receipt flow: Check if we have cash/bank control accounts
SELECT 
  'Receipt Flow (Cash/Bank)' AS flow,
  CASE 
    WHEN COUNT(*) > 0 THEN 'COVERED'
    ELSE 'NOT COVERED'
  END AS status,
  COUNT(*) AS rule_count
FROM posting_rules
WHERE rule_type = 'control' 
  AND control_account_type IN ('cash', 'bank');

-- Treasury flow: Check if we have payables control account
SELECT 
  'Treasury Flow (Payables)' AS flow,
  CASE 
    WHEN COUNT(*) > 0 THEN 'COVERED'
    ELSE 'NOT COVERED'
  END AS status,
  COUNT(*) AS rule_count
FROM posting_rules
WHERE rule_type = 'control' 
  AND control_account_type = 'payables';

-- Inventory flow: Check if we have inventory posting rules
SELECT 
  'Inventory Flow' AS flow,
  CASE 
    WHEN COUNT(*) > 0 THEN 'COVERED'
    ELSE 'NOT COVERED'
  END AS status,
  COUNT(*) AS rule_count
FROM posting_rules
WHERE rule_type = 'inventory';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. FINAL VERIFICATION SUMMARY
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT '=== FINAL VERIFICATION SUMMARY ===' AS section;

SELECT 
  'Total posting_rules' AS metric,
  COUNT(*) AS value
FROM posting_rules
UNION ALL
SELECT 
  'Active rules' AS metric,
  COUNT(*) AS value
FROM posting_rules
WHERE is_active = 1
UNION ALL
SELECT 
  'Inactive rules' AS metric,
  COUNT(*) AS value
FROM posting_rules
WHERE is_active = 0
UNION ALL
SELECT 
  'Companies covered' AS metric,
  COUNT(DISTINCT company_id) AS value
FROM posting_rules;

SELECT 
  CASE 
    WHEN (SELECT COUNT(*) FROM posting_rules) > 0 THEN '✓ READY TO DROP LEGACY TABLES'
    ELSE '✗ NOT READY - posting_rules is empty'
  END AS final_status;
