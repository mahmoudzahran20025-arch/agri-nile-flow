-- ============================================================================
-- CREATE POSTING SETUP TABLES (v2 - matching actual schema)
-- ============================================================================

-- ============================================================================
-- 1. CREATE GENERAL POSTING SETUP TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS general_posting_setup (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    bus_posting_group_code TEXT,
    prod_posting_group_code TEXT,
    sales_account TEXT,
    purchases_account TEXT,
    cogs_account TEXT,
    sales_returns_account TEXT,
    purch_returns_account TEXT,
    expense_account TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    UNIQUE(company_id, bus_posting_group_code, prod_posting_group_code)
);

-- ============================================================================
-- 2. CREATE INVENTORY POSTING SETUP TABLE  
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory_posting_setup (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    inv_posting_group_code TEXT NOT NULL,
    location_code TEXT,
    inventory_account TEXT,
    inventory_adj_account TEXT,
    wip_account TEXT,
    cogs_account TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    UNIQUE(company_id, inv_posting_group_code, location_code)
);

-- ============================================================================
-- 3. INSERT BUSINESS POSTING GROUPS (BPG)
-- ============================================================================
INSERT OR REPLACE INTO business_posting_groups (company_id, code, name, description, is_active) VALUES 
(1, 'DOMESTIC', 'عمليات محلية', 'المعاملات المحلية والعمليات الداخلية', 1),
(1, 'EXPORT', 'تصدير', 'مبيعات التصدير والعمليات الخارجية', 1),
(1, 'INTERNAL', 'عمليات داخلية', 'التحويلات والعمليات بين المراكز', 1),
(1, 'AGRI-OP', 'عمليات زراعية', 'عمليات الزراعة والحصاد والإنتاج الزراعي - البنجر', 1);

-- ============================================================================
-- 4. INSERT PRODUCT POSTING GROUPS (PPG)
-- ============================================================================
INSERT OR REPLACE INTO product_posting_groups (company_id, code, name, description, is_active) VALUES 
(1, 'BEET', 'بنجر', 'تقاوي وبذور البنجر - المحصول الرئيسي', 1),
(1, 'SEEDS', 'تقاوي وبذور', 'بذور وتقاوي أخرى', 1),
(1, 'FERT', 'أسمدة ومحسنات', 'الأسمدة والمخصبات الزراعية', 1),
(1, 'EQUIP', 'معدات زراعية', 'معدات وآلات زراعية', 1),
(1, 'FUEL', 'وقود وطاقة', 'الوقود والزيوت والطاقة', 1),
(1, 'SERV', 'خدمات', 'خدمات زراعية وصيانة', 1),
(1, 'MISC', 'متنوعات', 'أصناف متنوعة أخرى', 1);

-- ============================================================================
-- 5. INSERT INVENTORY POSTING GROUPS (IPG)
-- ============================================================================
INSERT OR REPLACE INTO inventory_posting_groups (company_id, code, name, description, is_active) VALUES 
(1, 'RAW-MAT', 'مواد خام', 'المواد الخام والبذور والتقاوي', 1),
(1, 'FINISHED', 'منتج تام', 'المحاصيل والمنتجات الزراعية النهائية', 1),
(1, 'SPARES', 'قطع غيار ومستلزمات', 'قطع الغيار والمستلزمات التشغيلية', 1),
(1, 'FUEL-INV', 'وقود', 'مخزون الوقود والزيوت', 1);

-- ============================================================================
-- 6. INSERT GENERAL POSTING SETUP (BPG × PPG Matrix)
-- ============================================================================
-- Clear first
DELETE FROM general_posting_setup WHERE company_id = 1;

-- AGRI-OP (Agricultural Operations) - Main focus for beet farming
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) VALUES
(1, 'AGRI-OP', 'BEET', '511101', '611101', '611101', '511102', '611102', '511103', 1),
(1, 'AGRI-OP', 'SEEDS', '511201', '611201', '611201', '511202', '611202', '511203', 1),
(1, 'AGRI-OP', 'FERT', '511301', '611301', '611301', '511302', '611302', '511303', 1),
(1, 'AGRI-OP', 'EQUIP', '511401', '11030001', '611401', '511402', '11030001', '511403', 1),
(1, 'AGRI-OP', 'FUEL', '511501', '14010101', '611501', '511502', '14010101', '511503', 1),
(1, 'AGRI-OP', 'SERV', '511601', '611601', '611601', '511602', '611602', '511603', 1),
(1, 'AGRI-OP', 'MISC', '511901', '611901', '611901', '511902', '611902', '511903', 1);

-- DOMESTIC Operations
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) VALUES
(1, 'DOMESTIC', 'BEET', '510101', '610101', '610101', '510102', '610102', '510103', 1),
(1, 'DOMESTIC', 'SEEDS', '510201', '610201', '610201', '510202', '610202', '510203', 1),
(1, 'DOMESTIC', 'FERT', '510301', '610301', '610301', '510302', '610302', '510303', 1),
(1, 'DOMESTIC', 'EQUIP', '510401', '11030001', '610401', '510402', '11030001', '510403', 1),
(1, 'DOMESTIC', 'FUEL', '510501', '14010101', '610501', '510502', '14010101', '510503', 1),
(1, 'DOMESTIC', 'SERV', '510601', '610601', '610601', '510602', '610602', '510603', 1),
(1, 'DOMESTIC', 'MISC', '510901', '610901', '610901', '510902', '610902', '510903', 1);

-- EXPORT Operations
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) VALUES
(1, 'EXPORT', 'BEET', '520101', '620101', '620101', '520102', '620102', '520103', 1),
(1, 'EXPORT', 'MISC', '520901', '620901', '620901', '520902', '620902', '520903', 1);

-- INTERNAL Operations
INSERT INTO general_posting_setup (company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active) VALUES
(1, 'INTERNAL', 'BEET', '530101', '630101', '630101', '530102', '630102', '530103', 1),
(1, 'INTERNAL', 'SEEDS', '530201', '630201', '630201', '530202', '630202', '530203', 1);

-- ============================================================================
-- 7. INSERT INVENTORY POSTING SETUP
-- ============================================================================
DELETE FROM inventory_posting_setup WHERE company_id = 1;

INSERT INTO inventory_posting_setup (company_id, inv_posting_group_code, location_code, inventory_account, inventory_adj_account, wip_account, cogs_account, is_active) VALUES
(1, 'RAW-MAT', '', '140201', '140202', '140203', '610101', 1),
(1, 'FINISHED', '', '140204', '140205', '140206', '610102', 1),
(1, 'SPARES', '', '140207', '140208', '140209', '610103', 1),
(1, 'FUEL-INV', '', '14010101', '140208', '140209', '610104', 1);

-- ============================================================================
-- 8. INSERT POSTING RULES (using actual schema with valid rule_type)
-- ============================================================================
-- Rule for Beet seeds using AGRI-OP + BEET combination
INSERT OR REPLACE INTO posting_rules (company_id, rule_type, bus_posting_group_code, prod_posting_group_code, inv_posting_group_code, mapping_key, account_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, inventory_account, priority, is_active, created_at) VALUES
(1, 'inventory', 'AGRI-OP', 'BEET', 'RAW-MAT', 'BEET-SEEDS', '140201', '511101', '611101', '611101', '511102', '611102', '511103', '140201', 100, 1, datetime('now'));

-- Rule for Fertilizers
INSERT OR REPLACE INTO posting_rules (company_id, rule_type, bus_posting_group_code, prod_posting_group_code, inv_posting_group_code, mapping_key, account_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, inventory_account, priority, is_active, created_at) VALUES
(1, 'inventory', 'AGRI-OP', 'FERT', 'RAW-MAT', 'FERTILIZERS', '140202', '511301', '611301', '611301', '511302', '611302', '511303', '140202', 90, 1, datetime('now'));

-- Rule for Fuel (control type for expense tracking)
INSERT OR REPLACE INTO posting_rules (company_id, rule_type, bus_posting_group_code, prod_posting_group_code, inv_posting_group_code, mapping_key, account_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, inventory_account, priority, is_active, created_at) VALUES
(1, 'control', 'AGRI-OP', 'FUEL', 'FUEL-INV', 'FUEL-AGRI', '14010101', '511501', '14010101', '611501', '511502', '14010101', '511503', '14010101', 80, 1, datetime('now'));

-- Rule for Equipment (general type)
INSERT OR REPLACE INTO posting_rules (company_id, rule_type, bus_posting_group_code, prod_posting_group_code, inv_posting_group_code, mapping_key, account_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, inventory_account, priority, is_active, created_at) VALUES
(1, 'general', 'AGRI-OP', 'EQUIP', 'SPARES', 'EQUIPMENT', '11030001', '511401', '11030001', '611401', '511402', '11030001', '511403', '140207', 70, 1, datetime('now'));

-- Rule for Services (control type)
INSERT OR REPLACE INTO posting_rules (company_id, rule_type, bus_posting_group_code, prod_posting_group_code, inv_posting_group_code, mapping_key, account_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, inventory_account, priority, is_active, created_at) VALUES
(1, 'control', 'AGRI-OP', 'SERV', NULL, 'SERVICES', '611601', '511601', '611601', '611601', '511602', '611602', '511603', NULL, 60, 1, datetime('now'));

-- ============================================================================
-- 9. VERIFICATION - Check each table separately (D1 compatibility)
-- ============================================================================
SELECT 'Business Posting Groups' as component, COUNT(*) as count FROM business_posting_groups WHERE company_id = 1;
