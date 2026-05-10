-- Phase 1: Governance Completion (Version 2 - Fixed for actual schema)
-- Source: نواة_المستقبل_2025-2026.json
-- Purpose: Load master data for dimensions, enums, equipment taxonomy, center ownership
-- Execution: wrangler d1 execute agri-nile-flow-data-lake --remote --file "sql/governance/01_phase1_governance_completion_v2.sql"
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
-- SECTION 2: Dimension Requirements Configuration
-- ============================================================================

-- Clear existing dimension requirements
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
-- SECTION 3: Equipment Taxonomy
-- ============================================================================

-- Clear and rebuild equipment_types from master data
DELETE FROM equipment_types WHERE company_id = 1;

INSERT INTO equipment_types (company_id, code, name, category, asset_nature, created_at) VALUES
  (1, 'TRACTOR', 'جرار', 'machinery', 'capital', datetime('now')),
  (1, 'TILLER', 'بدارة', 'machinery', 'capital', datetime('now')),
  (1, 'PLANTER', 'بلانتر', 'machinery', 'capital', datetime('now')),
  (1, 'DISC', 'ديسك', 'machinery', 'capital', datetime('now')),
  (1, 'HARROW', 'محراث', 'machinery', 'capital', datetime('now')),
  (1, 'SPRAYER', 'رشاشة', 'machinery', 'capital', datetime('now')),
  (1, 'LOADER', 'لودر', 'machinery', 'capital', datetime('now')),
  (1, 'DRILL', 'بنشة', 'machinery', 'capital', datetime('now')),
  (1, 'CONSOLIDATOR', 'تسوية', 'machinery', 'capital', datetime('now')),
  (1, 'SOLAR', 'ساب سولر', 'irrigation', 'capital', datetime('now')),
  (1, 'IRRIGATION', 'شبكات ري', 'irrigation', 'capital', datetime('now'));

-- ============================================================================
-- SECTION 4: Update Suppliers with Equipment Classification
-- ============================================================================

-- Equipment suppliers (من نواة_المستقبل_2025-2026.json)
UPDATE suppliers 
SET activity = 'موردين ألات ومعدات'
WHERE code IN (20300121, 20100033, 20300086) AND company_id = 1;

UPDATE suppliers 
SET activity = 'موردين عمالة'
WHERE code IN (21400002, 21400108) AND company_id = 1;

UPDATE suppliers 
SET activity = 'موردين منتجات زراعية'
WHERE code IN (20900151, 20900353) AND company_id = 1;

-- ============================================================================
-- SECTION 5: Validation Queries
-- ============================================================================

SELECT 'Cost Centers Updated' AS status, COUNT(*) AS count FROM cost_centers 
WHERE company_id = 1 AND parent_code IS NOT NULL;

SELECT 'Dimensions Configured' AS status, COUNT(*) AS count FROM dimension_requirements 
WHERE company_id = 1;

SELECT 'Equipment Types Loaded' AS status, COUNT(*) AS count FROM equipment_types 
WHERE company_id = 1;

SELECT 'Suppliers Activity Updated' AS status, COUNT(DISTINCT code) AS count FROM suppliers 
WHERE company_id = 1 AND activity IS NOT NULL;
