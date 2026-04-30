-- ============================================================================
-- CORRECTED POSTING SETUP - Production Ready
-- Based on actual findings and proper accounting structure
-- Date: April 30, 2026
-- ============================================================================

-- ============================================================================
-- 1. ADD MISSING CHART OF ACCOUNTS (Required for correct posting)
-- ============================================================================

-- COGS Accounts (55xxxx)
INSERT OR REPLACE INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, created_at) VALUES
(1, '55010001', 'تكلفة مبيعات بنجر', 'expense', '55000000', 1, datetime('now')),
(1, '55010002', 'تكلفة مبيعات تقاوي', 'expense', '55000000', 1, datetime('now')),
(1, '55010003', 'تكلفة مبيعات أسمدة ومحسنات', 'expense', '55000000', 1, datetime('now')),
(1, '55010004', 'تكلفة مبيعات خدمات زراعية', 'expense', '55000000', 1, datetime('now')),
(1, '55010005', 'تكلفة مبيعات وقود تشغيل', 'expense', '55000000', 1, datetime('now'));

-- Operating Expenses (62xxxx)
INSERT OR REPLACE INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, created_at) VALUES
(1, '62010001', 'مصروفات تشغيل معدات', 'expense', '62000000', 1, datetime('now')),
(1, '62010002', 'مصروفات قطع غيار مستهلكة', 'expense', '62000000', 1, datetime('now')),
(1, '62010003', 'مصروفات إدارية وعمومية تشغيلية', 'expense', '62000000', 1, datetime('now'));

-- Inventory Accounts (1407xxxx)
INSERT OR REPLACE INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, created_at) VALUES
(1, '13500001', 'مخزون تحت التشغيل WIP محاصيل', 'asset', '13000000', 1, datetime('now')),
(1, '14070107', 'مخزون وقود زراعي', 'asset', '14000000', 1, datetime('now')),
(1, '14070401', 'مخزون محاصيل تامة', 'asset', '14000000', 1, datetime('now'));

-- VAT Accounts
INSERT OR REPLACE INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, created_at) VALUES
(1, '14040711', 'ضريبة قيمة مضافة مدخلات', 'asset', '14000000', 1, datetime('now')),
(1, '21060001', 'ضريبة قيمة مضافة مخرجات', 'liability', '21000000', 1, datetime('now'));

-- AR/AP Trade Accounts
INSERT OR REPLACE INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, created_at) VALUES
(1, '14030001', 'ذمم مدينة تجارية', 'asset', '14000000', 1, datetime('now')),
(1, '21100001', 'ذمم دائنة تجارية', 'liability', '21000000', 1, datetime('now'));

-- Depreciation Account
INSERT OR REPLACE INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, created_at) VALUES
(1, '15900001', 'مجمع إهلاك معدات', 'asset', '15000000', 1, datetime('now'));

-- Revenue Accounts (4101xxxx)
INSERT OR REPLACE INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, created_at) VALUES
(1, '41010001', 'إيرادات زراعية', 'revenue', '41000000', 1, datetime('now'));

-- ============================================================================
-- 2. SPLIT EQUIP INTO TWO PRODUCT POSTING GROUPS
-- ============================================================================

-- EQUIP_CAP: Capital Equipment (Capex)
INSERT OR REPLACE INTO product_posting_groups (company_id, code, name, description, is_active)
VALUES (1, 'EQUIP_CAP', 'معدات رأسمالية', 'معدات رأسمالية وأصول ثابتة', 1);

-- EQUIP_CONS: Consumables/Spares (OpEx)
INSERT OR REPLACE INTO product_posting_groups (company_id, code, name, description, is_active)
VALUES (1, 'EQUIP_CONS', 'مستهلكات معدات', 'قطع غيار ومستهلكات تشغيلية', 1);

-- ============================================================================
-- 3. CORRECTED GENERAL POSTING SETUP MATRIX
-- Clear and rebuild with correct accounts
-- ============================================================================

DELETE FROM general_posting_setup WHERE company_id = 1;

-- AGRI-OP × BEET (Main crop operations)
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active)
VALUES (1, 'AGRI-OP', 'BEET', '41010001', '14070101', '55010001', '41010001', '14070101', '62010003', 1);

-- AGRI-OP × SEEDS
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active)
VALUES (1, 'AGRI-OP', 'SEEDS', '41010001', '14070103', '55010002', '41010001', '14070103', '62010003', 1);

-- AGRI-OP × FERT (Fertilizers)
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active)
VALUES (1, 'AGRI-OP', 'FERT', '41010001', '14070101', '55010003', '41010001', '14070101', '62010003', 1);

-- AGRI-OP × FUEL
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active)
VALUES (1, 'AGRI-OP', 'FUEL', '41010001', '14070107', '55010005', '41010001', '14070107', '62010003', 1);

-- AGRI-OP × SERV (Services)
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active)
VALUES (1, 'AGRI-OP', 'SERV', '41010001', '62010003', '55010004', '41010001', '62010003', '62010003', 1);

-- AGRI-OP × EQUIP_CAP (Capital Equipment - purchases go to FA, no COGS)
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active)
VALUES (1, 'AGRI-OP', 'EQUIP_CAP', '41010001', '11030001', NULL, '41010001', '11030001', '62010001', 1);

-- AGRI-OP × EQUIP_CONS (Consumables - go to inventory/spares)
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active)
VALUES (1, 'AGRI-OP', 'EQUIP_CONS', '41010001', '14070105', '55010004', '41010001', '14070105', '62010002', 1);

-- DOMESTIC × All (Mirror of AGRI-OP for domestic operations)
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active)
VALUES (1, 'DOMESTIC', 'BEET', '41010001', '14070101', '55010001', '41010001', '14070101', '62010003', 1);

INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active)
VALUES (1, 'DOMESTIC', 'SEEDS', '41010001', '14070103', '55010002', '41010001', '14070103', '62010003', 1);

INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active)
VALUES (1, 'DOMESTIC', 'FERT', '41010001', '14070101', '55010003', '41010001', '14070101', '62010003', 1);

INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active)
VALUES (1, 'DOMESTIC', 'FUEL', '41010001', '14070107', '55010005', '41010001', '14070107', '62010003', 1);

INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active)
VALUES (1, 'DOMESTIC', 'SERV', '41010001', '62010003', '55010004', '41010001', '62010003', '62010003', 1);

-- EXPORT × BEET
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active)
VALUES (1, 'EXPORT', 'BEET', '41010001', '14070101', '55010001', '41010001', '14070101', '62010003', 1);

-- INTERNAL × BEET (can use separate internal revenue account later)
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active)
VALUES (1, 'INTERNAL', 'BEET', '41010001', '14070101', '55010001', '41010001', '14070101', '62010003', 1);

-- ============================================================================
-- 4. CORRECTED INVENTORY POSTING SETUP
-- ============================================================================

DELETE FROM inventory_posting_setup WHERE company_id = 1;

-- RAW-MAT: Raw materials (seeds, fertilizers)
INSERT INTO inventory_posting_setup (company_id, inv_posting_group_code, location_code, inventory_account, inventory_adj_account, wip_account, cogs_account, is_active)
VALUES (1, 'RAW-MAT', '', '14070101', '14070102', '13500001', '55010001', 1);

-- FINISHED: Finished crops (beet harvest)
INSERT INTO inventory_posting_setup (company_id, inv_posting_group_code, location_code, inventory_account, inventory_adj_account, wip_account, cogs_account, is_active)
VALUES (1, 'FINISHED', '', '14070401', '14070402', '13500001', '55010001', 1);

-- SPARES: Consumables and spare parts
INSERT INTO inventory_posting_setup (company_id, inv_posting_group_code, location_code, inventory_account, inventory_adj_account, wip_account, cogs_account, is_active)
VALUES (1, 'SPARES', '', '14070105', '14070106', NULL, '55010004', 1);

-- FUEL-INV: Fuel inventory
INSERT INTO inventory_posting_setup (company_id, inv_posting_group_code, location_code, inventory_account, inventory_adj_account, wip_account, cogs_account, is_active)
VALUES (1, 'FUEL-INV', '', '14070107', '14070108', NULL, '55010005', 1);

-- ============================================================================
-- 5. SAMPLE CORRECTED POSTING RULES (VAT-Aware)
-- ============================================================================

-- Rule for Beet Seeds Purchase with VAT
INSERT OR REPLACE INTO posting_rules (company_id, rule_type, bus_posting_group_code, prod_posting_group_code, inv_posting_group_code, mapping_key, account_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, inventory_account, priority, is_active, created_at)
VALUES (1, 'inventory', 'AGRI-OP', 'BEET', 'RAW-MAT', 'BEET-PURCHASE-VAT', '14070101', '41010001', '14070101', '55010001', '41010001', '14070101', '62010003', '14070101', 100, 1, datetime('now'));

-- Rule for Beet WIP (Work in Progress)
INSERT OR REPLACE INTO posting_rules (company_id, rule_type, bus_posting_group_code, prod_posting_group_code, inv_posting_group_code, mapping_key, account_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, inventory_account, priority, is_active, created_at)
VALUES (1, 'inventory', 'AGRI-OP', 'BEET', 'FINISHED', 'BEET-WIP', '13500001', '41010001', '13500001', '55010001', '41010001', '13500001', '62010003', '13500001', 90, 1, datetime('now'));

-- ============================================================================
-- 6. VERIFICATION
-- ============================================================================
SELECT 'CORRECTED SETUP COMPLETED' as status;

SELECT 'Missing accounts added' as info;
SELECT 'COGS accounts (55xxxx)' as category, COUNT(*) as count FROM chart_of_accounts WHERE code LIKE '55%' AND company_id = 1;
SELECT 'WIP accounts (135xxxx)' as category, COUNT(*) as count FROM chart_of_accounts WHERE code LIKE '135%' AND company_id = 1;
SELECT 'VAT accounts' as category, COUNT(*) as count FROM chart_of_accounts WHERE code IN ('14040711', '21060001') AND company_id = 1;
