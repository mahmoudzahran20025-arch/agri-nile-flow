-- ============================================================================
-- STATUS VERIFICATION: Backend Data for Frontend
-- ============================================================================

-- 1. NEW ACCOUNTS STATUS
SELECT code, name, account_type, is_active FROM chart_of_accounts WHERE code IN ('13500001', '14040711', '14070401', '21060001', '55010001', '55010002', '55010003', '55010004', '55010005') ORDER BY code;

-- 2. POSTING GROUPS (Product) - Should show new PPGs
SELECT code, name, is_active FROM product_posting_groups ORDER BY code;

-- 3. ITEMS WITH NEW PPGs
SELECT posting_group_code, COUNT(*) as cnt FROM items WHERE company_id = 1 GROUP BY posting_group_code ORDER BY posting_group_code;

-- 4. ACTIVE POSTING RULES
SELECT id, prod_posting_group_code, cogs_account, is_active FROM posting_rules WHERE is_active = 1 AND prod_posting_group_code IN ('HARVEST', 'SEED', 'CHEM', 'EQUIP_CAP', 'EQUIP_CONS') ORDER BY prod_posting_group_code;

-- 5. DISABLED OLD RULES
SELECT COUNT(*) as disabled_old_rules FROM posting_rules WHERE cogs_account LIKE '611%' AND is_active = 0;

-- 6. GENERAL POSTING SETUP
SELECT bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account FROM general_posting_setup WHERE is_active = 1 ORDER BY prod_posting_group_code;

-- 7. INVENTORY POSTING SETUP
SELECT inv_posting_group_code, prod_posting_group_code, inventory_account FROM inventory_posting_setup WHERE is_active = 1 ORDER BY prod_posting_group_code;

-- 8. ENTRIES IN APRIL 2026
SELECT COUNT(*) as april_entries FROM journal_entries WHERE period_id = 5;
