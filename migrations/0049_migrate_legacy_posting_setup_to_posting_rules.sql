-- 0049_migrate_legacy_posting_setup_to_posting_rules.sql
-- Backfill legacy posting setup and control mappings into canonical posting_rules.

-- 1) general_posting_setup -> posting_rules(rule_type='general')
INSERT OR IGNORE INTO posting_rules (
  company_id,
  rule_type,
  bus_posting_group_code,
  prod_posting_group_code,
  sales_account,
  purchases_account,
  cogs_account,
  sales_returns_account,
  purch_returns_account,
  expense_account,
  priority,
  is_active,
  created_at,
  updated_at
)
SELECT
  company_id,
  'general',
  bus_posting_group_code,
  prod_posting_group_code,
  sales_account,
  purchases_account,
  cogs_account,
  sales_returns_account,
  purch_returns_account,
  expense_account,
  100,
  CASE WHEN COALESCE(is_active, 1) = 1 THEN 1 ELSE 0 END,
  COALESCE(created_at, datetime('now')),
  datetime('now')
FROM general_posting_setup;

-- 2) inventory_posting_setup -> posting_rules(rule_type='inventory')
INSERT OR IGNORE INTO posting_rules (
  company_id,
  rule_type,
  inv_posting_group_code,
  prod_posting_group_code,
  inventory_account,
  priority,
  is_active,
  created_at,
  updated_at
)
SELECT
  company_id,
  'inventory',
  inv_posting_group_code,
  prod_posting_group_code,
  inventory_account,
  100,
  CASE WHEN COALESCE(is_active, 1) = 1 THEN 1 ELSE 0 END,
  COALESCE(created_at, datetime('now')),
  datetime('now')
FROM inventory_posting_setup;

-- 3) gl_account_mappings -> posting_rules(rule_type='control')
INSERT OR IGNORE INTO posting_rules (
  company_id,
  rule_type,
  mapping_key,
  account_code,
  priority,
  is_active,
  created_at,
  updated_at
)
SELECT
  company_id,
  'control',
  mapping_key,
  account_code,
  100,
  CASE WHEN COALESCE(deprecated, 0) = 0 THEN 1 ELSE 0 END,
  datetime('now'),
  datetime('now')
FROM gl_account_mappings;
