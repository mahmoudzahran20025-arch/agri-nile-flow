-- Phase 1: Governance Completion
-- Source: نواة_المستقبل_2025-2026.json
-- Purpose: Load master data for dimensions, enums, equipment taxonomy, center ownership, warehouse governance
-- Execution: wrangler d1 execute agri-nile-flow-data-lake --remote --file "sql/governance/01_phase1_governance_completion.sql"
-- Date: 2026-05-09

-- ============================================================================
-- SECTION 1: Update Cost Centers (البيفوتات_أنظمة_الري - Pivot Systems)
-- ============================================================================

UPDATE cost_centers 
SET name_ar = 'بيفوت رقم 718 بوستر129', parent_code = '1006011', cost_center_type = 'OPERATIONAL'
WHERE code = '1006001' AND company_id = 1;

UPDATE cost_centers 
SET name_ar = 'بيفوت رقم 719 بوستر129', parent_code = '1006011', cost_center_type = 'OPERATIONAL'
WHERE code = '1006002' AND company_id = 1;

UPDATE cost_centers 
SET name_ar = 'بيفوت رقم 720 بوستر129', parent_code = '1006011', cost_center_type = 'OPERATIONAL'
WHERE code = '1006003' AND company_id = 1;

UPDATE cost_centers 
SET name_ar = 'بيفوت رقم 722 بوستر129', parent_code = '1006011', cost_center_type = 'OPERATIONAL'
WHERE code = '1006004' AND company_id = 1;

UPDATE cost_centers 
SET name_ar = 'بيفوت رقم 723 بوستر129', parent_code = '1006011', cost_center_type = 'OPERATIONAL'
WHERE code = '1006005' AND company_id = 1;

UPDATE cost_centers 
SET name_ar = 'بيفوت رقم 1044 بوستر128', parent_code = '1006011', cost_center_type = 'OPERATIONAL'
WHERE code = '1006006' AND company_id = 1;

UPDATE cost_centers 
SET name_ar = 'بيفوت رقم 1047 بوستر128', parent_code = '1006011', cost_center_type = 'OPERATIONAL'
WHERE code = '1006007' AND company_id = 1;

UPDATE cost_centers 
SET name_ar = 'بيفوت رقم 1048 بوستر128', parent_code = '1006011', cost_center_type = 'OPERATIONAL'
WHERE code = '1006008' AND company_id = 1;

UPDATE cost_centers 
SET name_ar = 'بيفوت رقم 1049 بوستر128', parent_code = '1006011', cost_center_type = 'OPERATIONAL'
WHERE code = '1006009' AND company_id = 1;

UPDATE cost_centers 
SET name_ar = 'بيفوت رقم 1050 بوستر128', parent_code = '1006011', cost_center_type = 'OPERATIONAL'
WHERE code = '1006010' AND company_id = 1;

UPDATE cost_centers 
SET name_ar = 'ادارية ارض الدلتا الجديدة', parent_code = NULL, cost_center_type = 'ADMINISTRATIVE'
WHERE code = '1006011' AND company_id = 1;

-- ============================================================================
-- SECTION 2: Dimension Requirements Configuration (استبدال الأنظمة)
-- ============================================================================

-- Clear existing dimension requirements to rebuild with correct rules
DELETE FROM dimension_requirements WHERE company_id = 1;

-- DIMENSION 1: COST_CENTER (mandatory for operational transactions)
INSERT INTO dimension_requirements (
  company_id, table_name, dimension_code, is_required, 
  applicable_transaction_types, enforcement_level, created_at
) VALUES (
  1, 'supplier_transactions', 'COST_CENTER', 1, 
  'IN,OUT,GRN,PAYMENT,RECEIPT', 'SOFT_ENFORCEMENT', 
  datetime('now')
);

-- DIMENSION 2: SUPPLIER_GL_MAPPING (required for supplier transactions)
INSERT INTO dimension_requirements (
  company_id, table_name, dimension_code, is_required, 
  applicable_transaction_types, enforcement_level, created_at
) VALUES (
  1, 'supplier_transactions', 'SUPPLIER_GL_MAPPING', 1, 
  'IN,PAYMENT', 'WARN', 
  datetime('now')
);

-- DIMENSION 3: EQUIPMENT_TYPE (for equipment supplier transactions)
INSERT INTO dimension_requirements (
  company_id, table_name, dimension_code, is_required, 
  applicable_transaction_types, enforcement_level, created_at
) VALUES (
  1, 'supplier_transactions', 'EQUIPMENT_TYPE', 0, 
  'IN,OUT', 'WARN', 
  datetime('now')
);

-- DIMENSION 4: INVENTORY_ITEM (required for inventory movements)
INSERT INTO dimension_requirements (
  company_id, table_name, dimension_code, is_required, 
  applicable_transaction_types, enforcement_level, created_at
) VALUES (
  1, 'inventory_movements', 'INVENTORY_ITEM', 1, 
  'IN,OUT,GRN', 'BLOCK', 
  datetime('now')
);

-- ============================================================================
-- SECTION 3: Equipment Taxonomy (from نواة_المستقبل_2025-2026.json)
-- ============================================================================

-- Clear and rebuild equipment_types from master data
DELETE FROM equipment_types WHERE company_id = 1;

INSERT INTO equipment_types (company_id, code, name, category, asset_nature, created_at) VALUES
  (1, 'TRACTOR', 'جرار', 'MACHINERY', 'capital', datetime('now')),
  (1, 'TILLER', 'بدارة', 'MACHINERY', 'capital', datetime('now')),
  (1, 'PLANTER', 'بلانتر', 'MACHINERY', 'capital', datetime('now')),
  (1, 'DISC', 'ديسك', 'MACHINERY', 'capital', datetime('now')),
  (1, 'HARROW', 'محراث', 'MACHINERY', 'capital', datetime('now')),
  (1, 'SPRAYER', 'رشاشة', 'MACHINERY', 'capital', datetime('now')),
  (1, 'LOADER', 'لودر', 'MACHINERY', 'capital', datetime('now')),
  (1, 'DRILL', 'بنشة', 'MACHINERY', 'capital', datetime('now')),
  (1, 'CONSOLIDATOR', 'تسوية', 'MACHINERY', 'capital', datetime('now')),
  (1, 'SOLAR', 'ساب سولر', 'EQUIPMENT', 'capital', datetime('now')),
  (1, 'IRRIGATION', 'شبكات ري', 'EQUIPMENT', 'capital', datetime('now'));

-- ============================================================================
-- SECTION 4: Service Categories & Equipment Supplier Classification
-- ============================================================================

-- Update suppliers with equipment supplier category for equipment-related transactions
UPDATE suppliers 
SET activity = 'موردين ألات ومعدات - بدارة', equipment_type_id = 'TILLER'
WHERE code IN (20300121, 20100033, 20300086) AND company_id = 1;

-- Create mapping table for service-to-center inference (for Phase 2 backfill)
-- This helps deterministically link cash narration to cost centers
CREATE TABLE IF NOT EXISTS service_center_mapping (
  company_id INTEGER,
  service_name TEXT,
  service_ar TEXT,
  inferred_center_code INTEGER,
  inference_confidence REAL,
  is_deterministic INTEGER DEFAULT 1,
  created_at TIMESTAMP,
  PRIMARY KEY (company_id, service_name)
);

-- Populate service-to-center mappings (cash narration patterns)
INSERT OR IGNORE INTO service_center_mapping VALUES
  (1, 'ايجار الات ومعدات', 'ايجار الات ومعدات', 1006001, 1.0, 1, datetime('now')),
  (1, 'مورد عمالة', 'مورد عمالة', 1006009, 0.88, 1, datetime('now')),
  (1, 'مصاريف ادارية', 'مصاريف ادارية', 1006011, 0.92, 1, datetime('now')),
  (1, 'مصاريف نقل', 'مصاريف نقل', 1006006, 0.75, 0, datetime('now'));

-- ============================================================================
-- SECTION 5: Warehouse-Field Governance (مستودعات -> حقول)
-- ============================================================================

-- Update warehouse descriptions and ownership mapping
UPDATE warehouses 
SET description = 'مستودع الأسمدة والمدخلات الزراعية'
WHERE code = 'اسمدة' AND company_id = 1;

UPDATE warehouses 
SET description = 'مستودع التقاوي والبذور'
WHERE code = 'تقاوي وبذور' AND company_id = 1;

UPDATE warehouses 
SET description = 'مستودع معدات شبكات الري'
WHERE code = 'شبكات ري' AND company_id = 1;

UPDATE warehouses 
SET description = 'مستودع المبيدات والمطهرات'
WHERE code = 'مبيدات' AND company_id = 1;

-- Create mapping table for warehouse-to-center assignment (for inventory location governance)
CREATE TABLE IF NOT EXISTS warehouse_center_mapping (
  company_id INTEGER,
  warehouse_code TEXT,
  center_code INTEGER,
  is_primary INTEGER DEFAULT 0,
  created_at TIMESTAMP,
  PRIMARY KEY (company_id, warehouse_code, center_code)
);

-- Primary warehouse-to-center mappings
INSERT OR IGNORE INTO warehouse_center_mapping VALUES
  (1, 'اسمدة', 1006011, 1, datetime('now')),
  (1, 'تقاوي وبذور', 1006011, 1, datetime('now')),
  (1, 'شبكات ري', 1006011, 1, datetime('now')),
  (1, 'مبيدات', 1006011, 1, datetime('now'));

-- ============================================================================
-- SECTION 6: Crop Account Mappings (المحاصيل -> الحسابات)
-- ============================================================================

-- Create crop master table for harvest/cost tracking
CREATE TABLE IF NOT EXISTS crop_master (
  company_id INTEGER,
  crop_code TEXT,
  crop_name_ar TEXT,
  crop_name_en TEXT,
  category TEXT,
  gl_account_code TEXT,
  cost_center_code INTEGER,
  created_at TIMESTAMP,
  PRIMARY KEY (company_id, crop_code)
);

-- Populate crop master from نواة_المستقبل_2025-2026.json
INSERT OR IGNORE INTO crop_master VALUES
  (1, 'BEET', 'بنجر السكر', 'Sugar Beet', 'FIELD_CROPS', '3025', 1006001, datetime('now')),
  (1, 'POTATO_WINTER', 'بطاطس شتوى', 'Winter Potato', 'FIELD_CROPS', '3030', 1006002, datetime('now')),
  (1, 'POTATO_SUMMER', 'بطاطس صيفى', 'Summer Potato', 'FIELD_CROPS', '3030', 1006003, datetime('now')),
  (1, 'ONION', 'البصل', 'Onion', 'FIELD_CROPS', '3035', 1006004, datetime('now')),
  (1, 'CORN_SILAGE', 'ذرة سيلاج', 'Corn Silage', 'FIELD_CROPS', '3040', 1006005, datetime('now')),
  (1, 'CORN_GRAIN', 'ذرة حب', 'Corn Grain', 'FIELD_CROPS', '3040', 1006006, datetime('now')),
  (1, 'WHEAT', 'قمح', 'Wheat', 'FIELD_CROPS', '3045', 1006007, datetime('now')),
  (1, 'CUCUMBER', 'خيار', 'Cucumber', 'FIELD_CROPS', '3050', 1006008, datetime('now')),
  (1, 'PEANUT', 'فول سوداني', 'Peanut', 'FIELD_CROPS', '3055', 1006009, datetime('now')),
  (1, 'BEANS', 'فاصوليا', 'Beans', 'FIELD_CROPS', '3060', 1006010, datetime('now')),
  (1, 'ADMINISTRATIVE', 'خدمات ادارية', 'Administrative Services', 'OVERHEAD', '5001', 1006011, datetime('now'));

-- ============================================================================
-- SECTION 7: Center Ownership Hierarchies
-- ============================================================================

-- Create center ownership table to track business unit assignments
CREATE TABLE IF NOT EXISTS center_ownership (
  company_id INTEGER,
  center_code INTEGER,
  parent_center_code INTEGER,
  business_unit_name TEXT,
  ownership_type TEXT,
  operational_status TEXT,
  created_at TIMESTAMP,
  PRIMARY KEY (company_id, center_code)
);

-- Populate center ownership hierarchy
-- Level 0: Administrative (parent)
INSERT OR IGNORE INTO center_ownership VALUES
  (1, 1006011, NULL, 'ادارية ارض الدلتا الجديدة', 'ADMINISTRATIVE', 'ACTIVE', datetime('now'));

-- Level 1: Field groups (operational)
INSERT OR IGNORE INTO center_ownership VALUES
  (1, 1006001, 1006011, 'حقول البوستر 129', 'OPERATIONAL', 'ACTIVE', datetime('now')),
  (1, 1006002, 1006011, 'حقول البوستر 129', 'OPERATIONAL', 'ACTIVE', datetime('now')),
  (1, 1006003, 1006011, 'حقول البوستر 129', 'OPERATIONAL', 'ACTIVE', datetime('now')),
  (1, 1006004, 1006011, 'حقول البوستر 129', 'OPERATIONAL', 'ACTIVE', datetime('now')),
  (1, 1006005, 1006011, 'حقول البوستر 129', 'OPERATIONAL', 'ACTIVE', datetime('now')),
  (1, 1006006, 1006011, 'حقول البوستر 128', 'OPERATIONAL', 'ACTIVE', datetime('now')),
  (1, 1006007, 1006011, 'حقول البوستر 128', 'OPERATIONAL', 'ACTIVE', datetime('now')),
  (1, 1006008, 1006011, 'حقول البوستر 128', 'OPERATIONAL', 'ACTIVE', datetime('now')),
  (1, 1006009, 1006011, 'حقول البوستر 128', 'OPERATIONAL', 'ACTIVE', datetime('now')),
  (1, 1006010, 1006011, 'حقول البوستر 128', 'OPERATIONAL', 'ACTIVE', datetime('now'));

-- ============================================================================
-- SECTION 8: Validation Queries (No-op - for verification only)
-- ============================================================================

-- Verify cost_centers updated
SELECT 'Cost Centers Updated' AS status, COUNT(*) AS count FROM cost_centers 
WHERE company_id = 1 AND business_unit IS NOT NULL;

-- Verify dimension_requirements loaded
SELECT 'Dimensions Configured' AS status, COUNT(*) AS count FROM dimension_requirements 
WHERE company_id = 1;

-- Verify equipment_types loaded
SELECT 'Equipment Types Loaded' AS status, COUNT(*) AS count FROM equipment_types 
WHERE company_id = 1;

-- Verify crop_master loaded
SELECT 'Crop Master Loaded' AS status, COUNT(*) AS count FROM crop_master 
WHERE company_id = 1;

-- Verify center_ownership loaded
SELECT 'Center Ownership Loaded' AS status, COUNT(*) AS count FROM center_ownership 
WHERE company_id = 1;
