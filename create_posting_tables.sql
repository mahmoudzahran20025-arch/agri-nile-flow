-- ============================================================================
-- CREATE POSTING SETUP TABLES (if not exist)
-- ============================================================================

-- ============================================================================
-- 1. GENERAL POSTING SETUP TABLE
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
-- 2. INVENTORY POSTING SETUP TABLE  
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
-- 3. ADD POSTING_GROUP_ID TO CHART OF ACCOUNTS (if not exist)
-- ============================================================================
-- Note: This will fail if column exists, which is fine
-- ALTER TABLE chart_of_accounts ADD COLUMN posting_group_id INTEGER;

-- ============================================================================
-- 4. INSERT BUSINESS POSTING GROUPS (BPG)
-- ============================================================================
INSERT OR REPLACE INTO business_posting_groups (company_id, code, name, description, is_active) VALUES 
(1, 'DOMESTIC', 'عمليات محلية', 'المعاملات المحلية والعمليات الداخلية', 1),
(1, 'EXPORT', 'تصدير', 'مبيعات التصدير والعمليات الخارجية', 1),
(1, 'INTERNAL', 'عمليات داخلية', 'التحويلات والعمليات بين المراكز', 1),
(1, 'AGRI-OP', 'عمليات زراعية', 'عمليات الزراعة والحصاد والإنتاج الزراعي', 1);

-- ============================================================================
-- 5. INSERT PRODUCT POSTING GROUPS (PPG)
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
-- 6. INSERT INVENTORY POSTING GROUPS (IPG)
-- ============================================================================
INSERT OR REPLACE INTO inventory_posting_groups (company_id, code, name, description, is_active) VALUES 
(1, 'RAW-MAT', 'مواد خام', 'المواد الخام والبذور والتقاوي', 1),
(1, 'FINISHED', 'منتج تام', 'المحاصيل والمنتجات الزراعية النهائية', 1),
(1, 'SPARES', 'قطع غيار ومستلزمات', 'قطع الغيار والمستلزمات التشغيلية', 1),
(1, 'FUEL-INV', 'وقود', 'مخزون الوقود والزيوت', 1);

-- ============================================================================
-- 7. INSERT GENERAL POSTING SETUP (BPG × PPG Matrix)
-- ============================================================================
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

-- ============================================================================
-- 8. INSERT INVENTORY POSTING SETUP
-- ============================================================================
INSERT INTO inventory_posting_setup (company_id, inv_posting_group_code, location_code, inventory_account, inventory_adj_account, wip_account, cogs_account, is_active) VALUES
(1, 'RAW-MAT', '', '140201', '140202', '140203', '610101', 1),
(1, 'FINISHED', '', '140204', '140205', '140206', '610102', 1),
(1, 'SPARES', '', '140207', '140208', '140209', '610103', 1),
(1, 'FUEL-INV', '', '14010101', '140208', '140209', '610104', 1);

-- ============================================================================
-- 9. INSERT POSTING RULES (Specialized rules for agricultural operations)
-- ============================================================================
INSERT OR REPLACE INTO posting_rules (company_id, rule_code, description, source_type, condition_field, condition_operator, condition_value, priority, is_active, created_at) VALUES
(1, 'BEET-SEED-ISSUE', 'صرف تقاوي بنجر للمراكز', 'inventory_movement', 'item_code', 'LIKE', '1030%', 100, 1, datetime('now')),
(1, 'FUEL-AGRI-CONS', 'استهلاك وقود للعمليات الزراعية', 'cash_transaction', 'description', 'CONTAINS', 'وقود', 90, 1, datetime('now')),
(1, 'SUPP-BEET-SEEDS', 'فواتير موردين لتقاوي البنجر', 'supplier_transaction', 'center_code', 'IN', '1006001,1006002,1006003', 80, 1, datetime('now')),
(1, 'EQUIP-MAINT', 'صيانة المعدات الزراعية', 'supplier_transaction', 'description', 'CONTAINS', 'صيانة', 70, 1, datetime('now')),
(1, 'FERT-APPLY', 'تطبيق أسمدة على المحاصيل', 'inventory_movement', 'item_code', 'LIKE', '1020%', 60, 1, datetime('now'));

-- ============================================================================
-- 10. VERIFICATION
-- ============================================================================
SELECT '=== POSTING SETUP CONFIGURATION ===' as section;

SELECT 'Business Posting Groups' as component, COUNT(*) as count FROM business_posting_groups WHERE company_id = 1
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
