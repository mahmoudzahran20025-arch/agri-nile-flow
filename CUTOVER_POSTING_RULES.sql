-- ============================================================================
-- CUTOVER: POSTING RULES MIGRATION
-- 1. Disable old rules pointing to old COGS (611xxx) - NO DELETE
-- 2. Add new active rules for new PPGs with correct COGS accounts
-- ============================================================================

-- BEFORE: Show old COGS rules
SELECT 'BEFORE: Old COGS Rules (611xxx)' as status;
SELECT id, rule_type, prod_posting_group_code, cogs_account, is_active 
FROM posting_rules 
WHERE company_id = 1 
AND (cogs_account LIKE '611%' OR cogs_account LIKE '612%')
ORDER BY id;

-- ============================================================================
-- STEP 1: DISABLE OLD COGS RULES (Soft-disable, NO DELETE)
-- ============================================================================
UPDATE posting_rules 
SET is_active = 0, 
    updated_at = datetime('now')
WHERE company_id = 1 
AND cogs_account LIKE '611%';

SELECT 'STEP 1 COMPLETED: Old COGS rules disabled' as status, 
       (SELECT COUNT(*) FROM posting_rules WHERE company_id = 1 AND cogs_account LIKE '611%' AND is_active = 0) as disabled_count;

-- ============================================================================
-- STEP 2: INSERT NEW ACTIVE RULES FOR NEW PPGs
-- Using correct COGS accounts: 55010001-55010005
-- ============================================================================

-- HARVEST (Beet Crops) → COGS 55010001
INSERT INTO posting_rules (
  company_id, rule_type, bus_posting_group_code, prod_posting_group_code, 
  inv_posting_group_code, cogs_account, inventory_account, 
  sales_account, purchases_account, priority, is_active
) VALUES (
  1, 'inventory', 'AGRI-OP', 'HARVEST', 'WH-MAIN',
  '55010001', '14070401',
  '41010001', '51010001', 10, 1
);

-- SEED (Seeds) → COGS 55010002
INSERT INTO posting_rules (
  company_id, rule_type, bus_posting_group_code, prod_posting_group_code, 
  inv_posting_group_code, cogs_account, inventory_account, 
  sales_account, purchases_account, priority, is_active
) VALUES (
  1, 'inventory', 'AGRI-OP', 'SEED', 'WH-MAIN',
  '55010002', '14070103',
  '41010001', '51010001', 10, 1
);

-- CHEM (Chemicals/Fertilizers) → COGS 55010003
INSERT INTO posting_rules (
  company_id, rule_type, bus_posting_group_code, prod_posting_group_code, 
  inv_posting_group_code, cogs_account, inventory_account, 
  sales_account, purchases_account, priority, is_active
) VALUES (
  1, 'inventory', 'AGRI-OP', 'CHEM', 'WH-MAIN',
  '55010003', '14070201',
  '41010001', '51010001', 10, 1
);

-- EQUIP_CAP (Capital Equipment) → COGS 55010004 (Maintenance/Depreciation)
INSERT INTO posting_rules (
  company_id, rule_type, bus_posting_group_code, prod_posting_group_code, 
  inv_posting_group_code, cogs_account, inventory_account, 
  sales_account, purchases_account, priority, is_active
) VALUES (
  1, 'inventory', 'AGRI-OP', 'EQUIP_CAP', 'WH-MAIN',
  '55010004', '14070301',
  NULL, '51010001', 10, 1
);

-- EQUIP_CONS (Consumables) → COGS 55010005
INSERT INTO posting_rules (
  company_id, rule_type, bus_posting_group_code, prod_posting_group_code, 
  inv_posting_group_code, cogs_account, inventory_account, 
  sales_account, purchases_account, priority, is_active
) VALUES (
  1, 'inventory', 'AGRI-OP', 'EQUIP_CONS', 'WH-MAIN',
  '55010005', '14070302',
  NULL, '51010001', 10, 1
);

-- WIP Rule (Work in Progress)
INSERT INTO posting_rules (
  company_id, rule_type, bus_posting_group_code, prod_posting_group_code, 
  inv_posting_group_code, cogs_account, inventory_account, 
  sales_account, purchases_account, priority, is_active
) VALUES (
  1, 'inventory', 'AGRI-OP', NULL, 'WIP',
  NULL, '13500001',
  NULL, NULL, 5, 1
);

-- CONTROL RULE: VAT Input (Purchases)
INSERT INTO posting_rules (
  company_id, rule_type, mapping_key, account_code, priority, is_active
) VALUES (
  1, 'control', 'VAT_INPUT_PURCHASE', '14040711', 1, 1
);

-- CONTROL RULE: VAT Output (Sales)
INSERT INTO posting_rules (
  company_id, rule_type, mapping_key, account_code, priority, is_active
) VALUES (
  1, 'control', 'VAT_OUTPUT_SALES', '21060001', 1, 1
);

-- CONTROL RULE: WIP Account
INSERT INTO posting_rules (
  company_id, rule_type, mapping_key, account_code, priority, is_active
) VALUES (
  1, 'control', 'WIP_ACCOUNT', '13500001', 1, 1
);

-- CONTROL RULE: Finished Goods
INSERT INTO posting_rules (
  company_id, rule_type, mapping_key, account_code, priority, is_active
) VALUES (
  1, 'control', 'FINISHED_GOODS', '14070401', 1, 1
);

SELECT 'STEP 2 COMPLETED: New active rules inserted' as status;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
SELECT 'VERIFICATION' as status;

-- Active rules for new PPGs
SELECT 'Active Rules for New PPGs' as check_item;
SELECT id, prod_posting_group_code, cogs_account, inventory_account, is_active 
FROM posting_rules 
WHERE company_id = 1 
AND prod_posting_group_code IN ('HARVEST', 'SEED', 'CHEM', 'EQUIP_CAP', 'EQUIP_CONS')
ORDER BY prod_posting_group_code;

-- Disabled old rules
SELECT 'Disabled Old Rules (611xxx)' as check_item;
SELECT COUNT(*) as disabled_old_rules 
FROM posting_rules 
WHERE company_id = 1 AND cogs_account LIKE '611%' AND is_active = 0;

-- Control rules added
SELECT 'New Control Rules' as check_item;
SELECT id, rule_type, mapping_key, account_code, is_active 
FROM posting_rules 
WHERE company_id = 1 
AND mapping_key IN ('VAT_INPUT_PURCHASE', 'VAT_OUTPUT_SALES', 'WIP_ACCOUNT', 'FINISHED_GOODS')
ORDER BY id DESC LIMIT 5;

SELECT 'CUTOVER POSTING RULES COMPLETED' as final_status;
