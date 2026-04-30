-- ============================================================================
-- PHASE 2: COMPLETE POSTING SETUP (FIXED)
-- Includes SEED, CHEM, HARVEST + uses existing accounts only
-- Date: April 30, 2026
-- ============================================================================

-- ============================================================================
-- 1. ADD MISSING PRODUCT POSTING GROUPS
-- ============================================================================
INSERT OR REPLACE INTO product_posting_groups (company_id, code, name, description, is_active) VALUES
(1, 'SEED', 'بذور أساسية', 'البذور الأساسية للزراعة', 1),
(1, 'CHEM', 'مبيدات وكيماويات', 'المبيدات والكيماويات الزراعية', 1),
(1, 'HARVEST', 'محاصيل', 'المحاصيل الزراعية النهائية', 1);

-- ============================================================================
-- 2. SPLIT EQUIP INTO CAPITAL VS CONSUMABLES
-- ============================================================================
-- Rename existing EQUIP and add new one
-- Note: We keep EQUIP for backward compatibility but clarify usage
INSERT OR REPLACE INTO product_posting_groups (company_id, code, name, description, is_active) VALUES
(1, 'EQUIP_CAP', 'معدات رأسمالية', 'معدات رأسمالية وأصول ثابتة (Capex)', 1),
(1, 'EQUIP_CONS', 'مستهلكات معدات', 'قطع غيار ومستهلكات تشغيلية (OpEx)', 1);

-- ============================================================================
-- 3. COMPLETE GENERAL POSTING SETUP MATRIX
-- Uses ONLY existing accounts from chart_of_accounts
-- ============================================================================

-- Clear and rebuild (safer than update)
DELETE FROM general_posting_setup WHERE company_id = 1;

-- AGRI-OP (Agricultural Operations) - Core Business
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) VALUES
-- BEET (البنجر) - Main crop
(1, 'AGRI-OP', 'BEET', '41010001', '14070101', '55010001', '41010001', '14070101', '62010003', 1),
-- SEEDS (التقاوي) 
(1, 'AGRI-OP', 'SEEDS', '41010001', '14070103', '55010002', '41010001', '14070103', '62010003', 1),
-- SEED (البذور الأساسية)
(1, 'AGRI-OP', 'SEED', '41010001', '14070103', '55010002', '41010001', '14070103', '62010003', 1),
-- FERT (الأسمدة)
(1, 'AGRI-OP', 'FERT', '41010001', '14070101', '55010003', '41010001', '14070101', '62010003', 1),
-- CHEM (المبيدات) - mapped to similar inventory
(1, 'AGRI-OP', 'CHEM', '41010001', '14070102', '55010003', '41010001', '14070102', '62010003', 1),
-- FUEL (الوقود)
(1, 'AGRI-OP', 'FUEL', '41010001', '14070107', '55010005', '41010001', '14070107', '62010003', 1),
-- HARVEST (المحاصيل النهائية)
(1, 'AGRI-OP', 'HARVEST', '41010001', '14070401', '55010001', '41010001', '14070401', '62010003', 1),
-- SERV (الخدمات)
(1, 'AGRI-OP', 'SERV', '41010001', '62010003', '55010004', '41010001', '62010003', '62010003', 1),
-- EQUIP (الموجود - للتوافق) - CapEx
(1, 'AGRI-OP', 'EQUIP', '41010001', '11030001', NULL, '41010001', '11030001', '62010001', 1),
-- EQUIP_CAP (معدات رأسمالية)
(1, 'AGRI-OP', 'EQUIP_CAP', '41010001', '11030001', NULL, '41010001', '11030001', '62010001', 1),
-- EQUIP_CONS (مستهلكات)
(1, 'AGRI-OP', 'EQUIP_CONS', '41010001', '14070105', '55010004', '41010001', '14070105', '62010002', 1),
-- MISC (متنوعات)
(1, 'AGRI-OP', 'MISC', '41010001', '14070106', '55010004', '41010001', '14070106', '62010003', 1);

-- DOMESTIC (Local Operations) - Mirror AGRI-OP for now
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) VALUES
(1, 'DOMESTIC', 'BEET', '41010001', '14070101', '55010001', '41010001', '14070101', '62010003', 1),
(1, 'DOMESTIC', 'SEEDS', '41010001', '14070103', '55010002', '41010001', '14070103', '62010003', 1),
(1, 'DOMESTIC', 'SEED', '41010001', '14070103', '55010002', '41010001', '14070103', '62010003', 1),
(1, 'DOMESTIC', 'FERT', '41010001', '14070101', '55010003', '41010001', '14070101', '62010003', 1),
(1, 'DOMESTIC', 'CHEM', '41010001', '14070102', '55010003', '41010001', '14070102', '62010003', 1),
(1, 'DOMESTIC', 'FUEL', '41010001', '14070107', '55010005', '41010001', '14070107', '62010003', 1),
(1, 'DOMESTIC', 'HARVEST', '41010001', '14070401', '55010001', '41010001', '14070401', '62010003', 1),
(1, 'DOMESTIC', 'SERV', '41010001', '62010003', '55010004', '41010001', '62010003', '62010003', 1),
(1, 'DOMESTIC', 'EQUIP', '41010001', '11030001', NULL, '41010001', '11030001', '62010001', 1),
(1, 'DOMESTIC', 'EQUIP_CAP', '41010001', '11030001', NULL, '41010001', '11030001', '62010001', 1),
(1, 'DOMESTIC', 'EQUIP_CONS', '41010001', '14070105', '55010004', '41010001', '14070105', '62010002', 1),
(1, 'DOMESTIC', 'MISC', '41010001', '14070106', '55010004', '41010001', '14070106', '62010003', 1);

-- EXPORT (Export Sales)
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) VALUES
(1, 'EXPORT', 'BEET', '41010001', '14070101', '55010001', '41010001', '14070101', '62010003', 1),
(1, 'EXPORT', 'HARVEST', '41010001', '14070401', '55010001', '41010001', '14070401', '62010003', 1),
(1, 'EXPORT', 'SEEDS', '41010001', '14070103', '55010002', '41010001', '14070103', '62010003', 1);

-- INTERNAL (Inter-company)
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) VALUES
(1, 'INTERNAL', 'BEET', '41010001', '14070101', '55010001', '41010001', '14070101', '62010003', 1),
(1, 'INTERNAL', 'HARVEST', '41010001', '14070401', '55010001', '41010001', '14070401', '62010003', 1);

-- LOCAL (Local Suppliers)
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) VALUES
(1, 'LOCAL', 'SEED', '41010001', '14070103', '55010002', '41010001', '14070103', '62010003', 1),
(1, 'LOCAL', 'CHEM', '41010001', '14070102', '55010003', '41010001', '14070102', '62010003', 1),
(1, 'LOCAL', 'FERT', '41010001', '14070101', '55010003', '41010001', '14070101', '62010003', 1),
(1, 'LOCAL', 'EQUIP', '41010001', '11030001', NULL, '41010001', '11030001', '62010001', 1),
(1, 'LOCAL', 'HARVEST', '41010001', '14070401', '55010001', '41010001', '14070401', '62010003', 1);

-- IMPORT (Import Suppliers)
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) VALUES
(1, 'IMPORT', 'SEED', '41010001', '14070103', '55010002', '41010001', '14070103', '62010003', 1),
(1, 'IMPORT', 'CHEM', '41010001', '14070102', '55010003', '41010001', '14070102', '62010003', 1),
(1, 'IMPORT', 'FERT', '41010001', '14070101', '55010003', '41010001', '14070101', '62010003', 1),
(1, 'IMPORT', 'EQUIP', '41010001', '11030001', NULL, '41010001', '11030001', '62010001', 1),
(1, 'IMPORT', 'HARVEST', '41010001', '14070401', '55010001', '41010001', '14070401', '62010003', 1);

-- LABOR (Labor & Contractors)
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) VALUES
(1, 'LABOR', 'SEED', '41010001', '14070103', '55010002', '41010001', '14070103', '62010003', 1),
(1, 'LABOR', 'CHEM', '41010001', '14070102', '55010003', '41010001', '14070102', '62010003', 1),
(1, 'LABOR', 'FERT', '41010001', '14070101', '55010003', '41010001', '14070101', '62010003', 1),
(1, 'LABOR', 'EQUIP', '41010001', '11030001', NULL, '41010001', '11030001', '62010001', 1),
(1, 'LABOR', 'HARVEST', '41010001', '14070401', '55010001', '41010001', '14070401', '62010003', 1),
(1, 'LABOR', NULL, '41010001', '62010003', '55010004', '41010001', '62010003', '62010003', 1);

-- CUSTOMER (Customer Sales)
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) VALUES
(1, 'CUSTOMER', 'HARVEST', '41010001', '14070401', '55010001', '41010001', '14070401', '62010003', 1);

-- GOVT (Government)
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) VALUES
(1, 'GOVT', 'HARVEST', '41010001', '14070401', '55010001', '41010001', '14070401', '62010003', 1);

-- ============================================================================
-- 4. COMPLETE INVENTORY POSTING SETUP
-- ============================================================================
DELETE FROM inventory_posting_setup WHERE company_id = 1;

INSERT INTO inventory_posting_setup (company_id, inv_posting_group_code, location_code, inventory_account, inventory_adj_account, wip_account, cogs_account, is_active) VALUES
-- RAW-MAT: Raw materials (fertilizers, basic seeds)
(1, 'RAW-MAT', '', '14070101', '14070102', '13500001', '55010001', 1),
-- FINISHED: Finished crops (beet, harvest)
(1, 'FINISHED', '', '14070401', '14070401', '13500001', '55010001', 1),
-- SPARES: Spare parts and consumables
(1, 'SPARES', '', '14070105', '14070106', NULL, '55010004', 1),
-- FUEL-INV: Fuel inventory
(1, 'FUEL-INV', '', '14070107', '14070108', NULL, '55010005', 1);

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================
SELECT 'PHASE 2 COMPLETED: Complete Posting Setup' as status;
SELECT 'Total General Setup Rows' as metric, COUNT(*) as count FROM general_posting_setup WHERE company_id = 1;
SELECT 'BPGs Covered' as metric, COUNT(DISTINCT bus_posting_group_code) as count FROM general_posting_setup WHERE company_id = 1;
SELECT 'PPGs Covered' as metric, COUNT(DISTINCT prod_posting_group_code) as count FROM general_posting_setup WHERE company_id = 1;
