-- verify_posting_rules_remote.sql
-- Comprehensive verification of posting_rules coverage and key flows
-- Run against remote D1 database before migration 0050

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. POSTING_RULES COVERAGE SUMMARY
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT '=== POSTING RULES COVERAGE ===' as section;

SELECT 
  rule_type,
  COUNT(*) as total_rules,
  SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_rules,
  SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as inactive_rules
FROM posting_rules
WHERE company_id = 1
GROUP BY rule_type
ORDER BY rule_type;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. CONTROL ACCOUNTS (CRITICAL FOR ALL FLOWS)
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT '=== CONTROL ACCOUNTS ===' as section;

SELECT 
  mapping_key,
  account_code,
  priority,
  is_active,
  CASE 
    WHEN EXISTS (SELECT 1 FROM chart_of_accounts WHERE code = account_code AND company_id = 1)
    THEN '✓ Valid'
    ELSE '✗ MISSING'
  END as coa_status
FROM posting_rules
WHERE company_id = 1 
  AND rule_type = 'control'
  AND mapping_key IN (
    'revenue', 'cogs', 'accounts_payable', 'accounts_receivable',
    'inventory', 'cash', 'deferred_revenue', 'wages_expense', 
    'wages_payable', 'labor_expense', 'depreciation_expense',
    'accumulated_depreciation', 'wip_asset', 'wip_contra'
  )
ORDER BY mapping_key;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. INVENTORY POSTING RULES (BY PRODUCT POSTING GROUP)
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT '=== INVENTORY POSTING RULES ===' as section;

SELECT 
  prod_posting_group_code,
  inventory_account,
  cogs_account,
  expense_account,
  is_active,
  priority
FROM posting_rules
WHERE company_id = 1 
  AND rule_type = 'inventory'
  AND is_active = 1
ORDER BY prod_posting_group_code;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. GENERAL POSTING RULES (SALES/PURCHASE FLOWS)
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT '=== GENERAL POSTING RULES ===' as section;

SELECT 
  bus_posting_group_code,
  prod_posting_group_code,
  sales_account,
  purchases_account,
  cogs_account,
  is_active,
  priority
FROM posting_rules
WHERE company_id = 1 
  AND rule_type = 'general'
  AND is_active = 1
ORDER BY bus_posting_group_code, prod_posting_group_code;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. LEGACY TABLES CHECK (SHOULD STILL EXIST BEFORE MIGRATION 0050)
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT '=== LEGACY TABLES STATUS ===' as section;

SELECT 
  name as table_name,
  type,
  '⚠ Will be dropped in migration 0050' as status
FROM sqlite_master 
WHERE type = 'table' 
  AND name IN ('general_posting_setup', 'inventory_posting_setup', 'gl_account_mappings')
ORDER BY name;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. RECENT GL ENTRIES (SMOKE TEST - SHOULD USE posting_rules)
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT '=== RECENT GL ENTRIES (Last 10) ===' as section;

SELECT 
  je.id,
  je.entry_date,
  je.entry_number,
  je.ref_type,
  je.ref_id,
  jel.account_code,
  jel.debit,
  jel.credit,
  jel.description
FROM journal_entries je
JOIN journal_entry_lines jel ON je.id = jel.entry_id
WHERE je.company_id = 1
ORDER BY je.created_at DESC
LIMIT 10;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. ORPHANED RULES CHECK (Rules pointing to non-existent CoA accounts)
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT '=== ORPHANED RULES (Invalid CoA References) ===' as section;

SELECT 
  pr.id,
  pr.rule_type,
  pr.mapping_key,
  pr.account_code,
  pr.is_active,
  'Missing in CoA' as issue
FROM posting_rules pr
WHERE pr.company_id = 1
  AND pr.account_code IS NOT NULL
  AND pr.is_active = 1
  AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa 
    WHERE coa.code = pr.account_code 
      AND coa.company_id = 1
  )
ORDER BY pr.rule_type, pr.mapping_key;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. SUMMARY COUNTS
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT '=== SUMMARY COUNTS ===' as section;

SELECT 
  'Total posting_rules' as metric,
  COUNT(*) as count
FROM posting_rules
WHERE company_id = 1

UNION ALL

SELECT 
  'Active posting_rules',
  COUNT(*)
FROM posting_rules
WHERE company_id = 1 AND is_active = 1

UNION ALL

SELECT 
  'Chart of Accounts entries',
  COUNT(*)
FROM chart_of_accounts
WHERE company_id = 1

UNION ALL

SELECT 
  'Journal Entries (last 30 days)',
  COUNT(*)
FROM journal_entries
WHERE company_id = 1 
  AND created_at >= datetime('now', '-30 days')

UNION ALL

SELECT 
  'Legacy tables remaining',
  COUNT(*)
FROM sqlite_master
WHERE type = 'table' 
  AND name IN ('general_posting_setup', 'inventory_posting_setup', 'gl_account_mappings');
