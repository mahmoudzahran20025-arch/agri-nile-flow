-- Daily / deploy COA governance audit
-- Requires migration 0094_coa_governance_phase.sql

SELECT '=== COA GOVERNANCE METRICS ===' AS section;
SELECT metric, severity, issue_count
FROM vw_coa_audit_metrics
ORDER BY
  CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
  metric;

SELECT '=== PARENT MISSING (sample) ===' AS section;
SELECT a.company_id, a.code, a.name, a.parent_code
FROM chart_of_accounts a
LEFT JOIN chart_of_accounts p
  ON p.company_id = a.company_id
 AND p.code = a.parent_code
WHERE a.parent_code IS NOT NULL
  AND p.code IS NULL
ORDER BY a.company_id, a.code
LIMIT 50;

SELECT '=== LEAF WITH CHILDREN (sample) ===' AS section;
SELECT a.company_id, a.code, a.name, a.account_type
FROM chart_of_accounts a
WHERE a.is_header = 0
  AND EXISTS (
    SELECT 1 FROM chart_of_accounts c
    WHERE c.company_id = a.company_id
      AND c.parent_code = a.code
  )
ORDER BY a.company_id, a.code
LIMIT 50;

SELECT '=== ACTIVE RULES WITH INVALID ACCOUNTS (sample) ===' AS section;
SELECT pr.id, pr.company_id, pr.rule_type, pr.mapping_key,
       pr.account_code, pr.sales_account, pr.purchases_account,
       pr.cogs_account, pr.expense_account,
       pr.inventory_account, pr.wip_account, pr.finished_goods_account
FROM posting_rules pr
WHERE pr.is_active = 1
  AND (
    (pr.account_code IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM chart_of_accounts coa
      WHERE coa.company_id = pr.company_id
        AND coa.code = pr.account_code
        AND coa.is_active = 1
        AND coa.is_header = 0
    ))
    OR (pr.sales_account IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM chart_of_accounts coa
      WHERE coa.company_id = pr.company_id
        AND coa.code = pr.sales_account
        AND coa.is_active = 1
        AND coa.is_header = 0
    ))
    OR (pr.purchases_account IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM chart_of_accounts coa
      WHERE coa.company_id = pr.company_id
        AND coa.code = pr.purchases_account
        AND coa.is_active = 1
        AND coa.is_header = 0
    ))
    OR (pr.cogs_account IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM chart_of_accounts coa
      WHERE coa.company_id = pr.company_id
        AND coa.code = pr.cogs_account
        AND coa.is_active = 1
        AND coa.is_header = 0
    ))
    OR (pr.expense_account IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM chart_of_accounts coa
      WHERE coa.company_id = pr.company_id
        AND coa.code = pr.expense_account
        AND coa.is_active = 1
        AND coa.is_header = 0
    ))
    OR (pr.inventory_account IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM chart_of_accounts coa
      WHERE coa.company_id = pr.company_id
        AND coa.code = pr.inventory_account
        AND coa.is_active = 1
        AND coa.is_header = 0
    ))
    OR (pr.wip_account IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM chart_of_accounts coa
      WHERE coa.company_id = pr.company_id
        AND coa.code = pr.wip_account
        AND coa.is_active = 1
        AND coa.is_header = 0
    ))
    OR (pr.finished_goods_account IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM chart_of_accounts coa
      WHERE coa.company_id = pr.company_id
        AND coa.code = pr.finished_goods_account
        AND coa.is_active = 1
        AND coa.is_header = 0
    ))
  )
ORDER BY pr.company_id, pr.id
LIMIT 100;
