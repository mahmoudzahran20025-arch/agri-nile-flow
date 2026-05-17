-- ============================================================================
-- POSTING SETUP CONFIGURATION - Agri-Nile Flow Project
-- ============================================================================
-- Based on actual project data: Beet farming, cost centers, agricultural ERP
-- Date: April 30, 2026
-- ============================================================================

-- ============================================================================
-- 1. BUSINESS POSTING GROUPS (BPG) - أنواع العمليات التجارية
-- ============================================================================

-- Domestic / Local Operations
INSERT OR REPLACE INTO business_posting_groups (company_id, code, name, description, is_active) 
VALUES (1, 'DOMESTIC', 'عمليات محلية', 'المعاملات المحلية والعمليات الداخلية', 1);

-- Export / External Sales
INSERT OR REPLACE INTO business_posting_groups (company_id, code, name, description, is_active) 
VALUES (1, 'EXPORT', 'تصدير', 'مبيعات التصدير والعمليات الخارجية', 1);

-- Internal / Inter-company
INSERT OR REPLACE INTO business_posting_groups (company_id, code, name, description, is_active) 
VALUES (1, 'INTERNAL', 'عمليات داخلية', 'التحويلات والعمليات بين المراكز', 1);

-- Agricultural Operations (main business)
INSERT OR REPLACE INTO business_posting_groups (company_id, code, name, description, is_active) 
VALUES (1, 'AGRI-OP', 'عمليات زراعية', 'عمليات الزراعة والحصاد والإنتاج الزراعي', 1);

-- ============================================================================
-- 2. PRODUCT POSTING GROUPS (PPG) - مجموعات المنتجات
-- ============================================================================

-- Beet / بنجر (main crop)
INSERT OR REPLACE INTO product_posting_groups (company_id, code, name, description, is_active) 
VALUES (1, 'BEET', 'بنجر', 'تقاوي وبذور البنجر - المحصول الرئيسي', 1);

-- Seeds & Agricultural Supplies
INSERT OR REPLACE INTO product_posting_groups (company_id, code, name, description, is_active) 
VALUES (1, 'SEEDS', 'تقاوي وبذور', 'بذور وتقاوي أخرى', 1);

-- Fertilizers / أسمدة
INSERT OR REPLACE INTO product_posting_groups (company_id, code, name, description, is_active) 
VALUES (1, 'FERT', 'أسمدة ومحسنات', 'الأسمدة والمخصبات الزراعية', 1);

-- Agricultural Equipment / معدات
INSERT OR REPLACE INTO product_posting_groups (company_id, code, name, description, is_active) 
VALUES (1, 'EQUIP', 'معدات زراعية', 'معدات وآلات زراعية', 1);

-- Fuel & Energy / طاقة
INSERT OR REPLACE INTO product_posting_groups (company_id, code, name, description, is_active) 
VALUES (1, 'FUEL', 'وقود وطاقة', 'الوقود والزيوت والطاقة', 1);

-- Services / خدمات
INSERT OR REPLACE INTO product_posting_groups (company_id, code, name, description, is_active) 
VALUES (1, 'SERV', 'خدمات', 'خدمات زراعية وصيانة', 1);

-- Miscellaneous / متنوعات
INSERT OR REPLACE INTO product_posting_groups (company_id, code, name, description, is_active) 
VALUES (1, 'MISC', 'متنوعات', 'أصناف متنوعة أخرى', 1);

-- ============================================================================
-- 3. INVENTORY POSTING GROUPS (IPG) - مجموعات المخزون
-- ============================================================================

-- Raw Materials / خامات
INSERT OR REPLACE INTO inventory_posting_groups (company_id, code, name, description, is_active) 
VALUES (1, 'RAW-MAT', 'مواد خام', 'المواد الخام والبذور والتقاوي', 1);

-- Finished Goods / منتج تام
INSERT OR REPLACE INTO inventory_posting_groups (company_id, code, name, description, is_active) 
VALUES (1, 'FINISHED', 'منتج تام', 'المحاصيل والمنتجات الزراعية النهائية', 1);

-- Supplies & Spare Parts / قطع غيار
INSERT OR REPLACE INTO inventory_posting_groups (company_id, code, name, description, is_active) 
VALUES (1, 'SPARES', 'قطع غيار ومستلزمات', 'قطع الغيار والمستلزمات التشغيلية', 1);

-- Fuel Inventory / وقود
INSERT OR REPLACE INTO inventory_posting_groups (company_id, code, name, description, is_active) 
VALUES (1, 'FUEL-INV', 'وقود', 'مخزون الوقود والزيوت', 1);

-- ============================================================================
-- 4. GENERAL POSTING SETUP - إعداد النشر العام (BPG × PPG Matrix)
-- ============================================================================

-- Clear existing setup
DELETE FROM general_posting_setup WHERE company_id = 1;

-- ============================================================================
-- DOMESTIC (Local) Operations
-- ============================================================================

-- Domestic × Beet
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) 
VALUES (1, 'DOMESTIC', 'BEET', '510101', '610101', '610101', '510102', '610102', '510103', 1);

-- Domestic × Seeds
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) 
VALUES (1, 'DOMESTIC', 'SEEDS', '510201', '610201', '610201', '510202', '610202', '510203', 1);

-- Domestic × Fertilizers
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) 
VALUES (1, 'DOMESTIC', 'FERT', '510301', '610301', '610301', '510302', '610302', '510303', 1);

-- Domestic × Equipment
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) 
VALUES (1, 'DOMESTIC', 'EQUIP', '510401', '11030001', '610401', '510402', '11030001', '510403', 1);

-- Domestic × Fuel
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) 
VALUES (1, 'DOMESTIC', 'FUEL', '510501', '14010101', '610501', '510502', '14010101', '510503', 1);

-- Domestic × Services
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) 
VALUES (1, 'DOMESTIC', 'SERV', '510601', '610601', '610601', '510602', '610602', '510603', 1);

-- Domestic × Miscellaneous (Default)
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) 
VALUES (1, 'DOMESTIC', 'MISC', '510901', '610901', '610901', '510902', '610902', '510903', 1);

-- ============================================================================
-- AGRI-OP (Agricultural Operations) - Main focus
-- ============================================================================

-- Agricultural × Beet (Main crop operations)
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) 
VALUES (1, 'AGRI-OP', 'BEET', '511101', '611101', '611101', '511102', '611102', '511103', 1);

-- Agricultural × Seeds
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) 
VALUES (1, 'AGRI-OP', 'SEEDS', '511201', '611201', '611201', '511202', '611202', '511203', 1);

-- Agricultural × Fertilizers
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) 
VALUES (1, 'AGRI-OP', 'FERT', '511301', '611301', '611301', '511302', '611302', '511303', 1);

-- Agricultural × Equipment
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) 
VALUES (1, 'AGRI-OP', 'EQUIP', '511401', '11030001', '611401', '511402', '11030001', '511403', 1);

-- Agricultural × Fuel
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) 
VALUES (1, 'AGRI-OP', 'FUEL', '511501', '14010101', '611501', '511502', '14010101', '511503', 1);

-- Agricultural × Services
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) 
VALUES (1, 'AGRI-OP', 'SERV', '511601', '611601', '611601', '511602', '611602', '511603', 1);

-- ============================================================================
-- EXPORT Operations
-- ============================================================================

-- Export × Beet
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) 
VALUES (1, 'EXPORT', 'BEET', '520101', '620101', '620101', '520102', '620102', '520103', 1);

-- Export × Finished Goods
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) 
VALUES (1, 'EXPORT', 'MISC', '520901', '620901', '620901', '520902', '620902', '520903', 1);

-- ============================================================================
-- 5. INVENTORY POSTING SETUP - إعداد نشر المخزون (IPG × Location)
-- ============================================================================

-- Clear existing
DELETE FROM inventory_posting_setup WHERE company_id = 1;

-- Raw Materials - Inventory accounts
INSERT INTO inventory_posting_setup (company_id, inv_posting_group_code, location_code, inventory_account, inventory_adj_account, wip_account, cogs_account, is_active)
VALUES (1, 'RAW-MAT', '', '140201', '140202', '140203', '610101', 1);

-- Finished Goods - Beet harvest
INSERT INTO inventory_posting_setup (company_id, inv_posting_group_code, location_code, inventory_account, inventory_adj_account, wip_account, cogs_account, is_active)
VALUES (1, 'FINISHED', '', '140204', '140205', '140206', '610102', 1);

-- Spare Parts
INSERT INTO inventory_posting_setup (company_id, inv_posting_group_code, location_code, inventory_account, inventory_adj_account, wip_account, cogs_account, is_active)
VALUES (1, 'SPARES', '', '140207', '140208', '140209', '610103', 1);

-- Fuel Inventory
INSERT INTO inventory_posting_setup (company_id, inv_posting_group_code, location_code, inventory_account, inventory_adj_account, wip_account, cogs_account, is_active)
VALUES (1, 'FUEL-INV', '', '14010101', '140208', '140209', '610104', 1);

-- ============================================================================
-- 6. POSTING RULES - القواعد المتخصصة
-- ============================================================================

-- Clear existing
DELETE FROM posting_rules WHERE company_id = 1;

-- Rule: Beet seed issuance to cost centers
INSERT INTO posting_rules (company_id, rule_code, description, source_type, condition_field, condition_operator, condition_value, priority, is_active, created_at)
VALUES (1, 'BEET-SEED-ISSUE', 'صرف تقاوي بنجر للمراكز', 'inventory_movement', 'item_code', 'LIKE', '1030%', 100, 1, datetime('now'));

-- Rule: Fuel consumption for agricultural operations
INSERT INTO posting_rules (company_id, rule_code, description, source_type, condition_field, condition_operator, condition_value, priority, is_active, created_at)
VALUES (1, 'FUEL-AGRI-CONS', 'استهلاك وقود للعمليات الزراعية', 'cash_transaction', 'description', 'CONTAINS', 'وقود', 90, 1, datetime('now'));

-- Rule: Supplier invoices for beet seeds
INSERT INTO posting_rules (company_id, rule_code, description, source_type, condition_field, condition_operator, condition_value, priority, is_active, created_at)
VALUES (1, 'SUPP-BEET-SEEDS', 'فواتير موردين لتقاوي البنجر', 'supplier_transaction', 'center_code', 'IN', '1006001,1006002,1006003', 80, 1, datetime('now'));

-- Rule: Equipment maintenance
INSERT INTO posting_rules (company_id, rule_code, description, source_type, condition_field, condition_operator, condition_value, priority, is_active, created_at)
VALUES (1, 'EQUIP-MAINT', 'صيانة المعدات الزراعية', 'supplier_transaction', 'description', 'CONTAINS', 'صيانة', 70, 1, datetime('now'));

-- Rule: Fertilizer application
INSERT INTO posting_rules (company_id, rule_code, description, source_type, condition_field, condition_operator, condition_value, priority, is_active, created_at)
VALUES (1, 'FERT-APPLY', 'تطبيق أسمدة على المحاصيل', 'inventory_movement', 'item_code', 'LIKE', '1020%', 60, 1, datetime('now'));

-- ============================================================================
-- 7. UPDATE CHART OF ACCOUNTS - Link to Posting Groups
-- ============================================================================

-- Update chart of accounts with posting group references
UPDATE chart_of_accounts SET 
  posting_group_id = (SELECT id FROM business_posting_groups WHERE code = 'AGRI-OP' AND company_id = 1)
WHERE code LIKE '51%' AND company_id = 1;

UPDATE chart_of_accounts SET 
  posting_group_id = (SELECT id FROM product_posting_groups WHERE code = 'BEET' AND company_id = 1)
WHERE code LIKE '1030%' AND company_id = 1;

UPDATE chart_of_accounts SET 
  posting_group_id = (SELECT id FROM product_posting_groups WHERE code = 'FERT' AND company_id = 1)
WHERE code LIKE '1020%' AND company_id = 1;

-- ============================================================================
-- 8. VERIFICATION QUERY
-- ============================================================================

SELECT 'Business Posting Groups' as category, COUNT(*) as count FROM business_posting_groups WHERE company_id = 1
UNION ALL
SELECT 'Product Posting Groups', COUNT(*) FROM product_posting_groups WHERE company_id = 1
UNION ALL
SELECT 'Inventory Posting Groups', COUNT(*) FROM inventory_posting_groups WHERE company_id = 1
UNION ALL
SELECT 'General Setup Rows', COUNT(*) FROM general_posting_setup WHERE company_id = 1
UNION ALL
SELECT 'Inventory Setup Rows', COUNT(*) FROM inventory_posting_setup WHERE company_id = 1
UNION ALL
SELECT 'Posting Rules', COUNT(*) FROM posting_rules WHERE company_id = 1;
