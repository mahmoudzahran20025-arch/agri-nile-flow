-- Phase 2: Service Taxonomy & Supplier-Service Mapping
-- Date: 2026-05-11
-- Purpose: Establish canonical service types and supplier authorization matrix
-- Scope: company_id = 1 (nawa al-mustaqbal)

BEGIN TRANSACTION;

-- ====================================================================
-- TABLE 1: service_types (Core Service Taxonomy)
-- ====================================================================
-- This table defines all canonical service types used in the ERP.
-- Every operational transaction must reference one of these services.
-- Each service maps to a specific GL account pair (debit/credit).

CREATE TABLE IF NOT EXISTS service_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  code TEXT NOT NULL,                    -- e.g., SRV_MECH, SRV_LABOR, SRV_SUPPLY
  name_ar TEXT NOT NULL,                 -- Arabic name (e.g., "ميكنة")
  name_en TEXT,                          -- English name (e.g., "Mechanization")
  service_group TEXT NOT NULL,           -- MECHANIZATION|LABOR|SUPPLY|LOGISTICS|SUPERVISION|OTHER
  description_ar TEXT,                   -- Business description in Arabic
  description_en TEXT,                   -- Business description in English
  default_expense_account_code TEXT,     -- GL account for debit (e.g., "5101" for equipment)
  default_ap_account_code TEXT,          -- GL account for credit to AP (e.g., "2120.1" for commodity AP)
  uom_primary TEXT,                      -- Primary unit of measure (ساعة, عامل, كجم, مبلغ, etc.)
  requires_supplier INTEGER DEFAULT 0,   -- 1 if supplier_code is mandatory
  requires_document INTEGER DEFAULT 0,   -- 1 if document_number is mandatory
  requires_center INTEGER DEFAULT 0,     -- 1 if center_code is mandatory
  requires_season INTEGER DEFAULT 0,     -- 1 if season_id is mandatory
  is_active INTEGER DEFAULT 1,           -- Soft delete / deactivation
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_service_types_company_active
  ON service_types(company_id, is_active);

-- ====================================================================
-- TABLE 2: supplier_service_map (Supplier Authorization Matrix)
-- ====================================================================
-- This table defines which suppliers are authorized to provide which services.
-- Prevents a single supplier master from incorrectly handling multiple service types.
-- Enables GL account routing based on (supplier_code, service_type_code) pair.

CREATE TABLE IF NOT EXISTS supplier_service_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  supplier_code INTEGER NOT NULL,        -- References suppliers.code
  service_type_code TEXT NOT NULL,       -- References service_types.code
  is_primary INTEGER DEFAULT 1,          -- 1 if this is the supplier's main service
  gl_credit_account_code TEXT,           -- Override GL credit account for this mapping (optional)
  ap_subaccount_code TEXT,               -- AP sub-account for this service (e.g., "2120.1", "2120.2")
  authorization_date DATE,               -- When the supplier was authorized for this service
  notes TEXT,                            -- Reason for mapping (e.g., "Split from 20900353.materials")
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id, service_type_code) 
    REFERENCES service_types(company_id, code),
  UNIQUE(company_id, supplier_code, service_type_code)
);

CREATE INDEX IF NOT EXISTS idx_supplier_service_map_supplier
  ON supplier_service_map(company_id, supplier_code, is_active);

CREATE INDEX IF NOT EXISTS idx_supplier_service_map_service
  ON supplier_service_map(company_id, service_type_code, is_active);

-- ====================================================================
-- TABLE 3: movement_governance_flags (Data Quality Audit Trail)
-- ====================================================================
-- Replaces inline technical tags (NEEDS_DIMENSION, NEEDS_POSTING_LINK, etc.)
-- in note fields with formal, queryable governance flag records.
-- Enables systematic gap analysis and compliance reporting.

CREATE TABLE IF NOT EXISTS movement_governance_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  source_module TEXT NOT NULL,          -- 'treasury' | 'suppliers' | 'inventory' | 'operations'
  source_table TEXT NOT NULL,           -- e.g., 'cash_transactions', 'supplier_transactions', 'inventory_movements'
  source_id INTEGER NOT NULL,
  flag_code TEXT NOT NULL,              -- MISSING_SERVICE_TYPE | MISSING_STATEMENT_TEXT | MISSING_CENTER | etc.
  severity TEXT DEFAULT 'warning',      -- 'warning' | 'error' | 'critical'
  flag_status TEXT DEFAULT 'open',      -- 'open' | 'resolved' | 'waived'
  flag_details TEXT,                    -- Human-readable explanation of the issue
  created_by INTEGER,
  resolved_by INTEGER,
  waived_by_role TEXT,                  -- Role that waived the flag (if applicable)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  UNIQUE(company_id, source_table, source_id, flag_code)
);

CREATE INDEX IF NOT EXISTS idx_governance_flags_status
  ON movement_governance_flags(company_id, flag_status, severity);

CREATE INDEX IF NOT EXISTS idx_governance_flags_source
  ON movement_governance_flags(company_id, source_table, source_id);

-- ====================================================================
-- SCHEMA EXTENSIONS: Add canonical columns to operational tables
-- ====================================================================
-- These columns are safe, nullable additions that support new governance model.
-- Existing rows will have NULL values; NEW rows must populate them.

-- supplier_transactions extensions
ALTER TABLE supplier_transactions ADD COLUMN statement_text TEXT;
ALTER TABLE supplier_transactions ADD COLUMN service_type_code TEXT;
ALTER TABLE supplier_transactions ADD COLUMN notes_internal TEXT;

-- cash_transactions extensions
ALTER TABLE cash_transactions ADD COLUMN statement_text TEXT;
ALTER TABLE cash_transactions ADD COLUMN service_type_code TEXT;
ALTER TABLE cash_transactions ADD COLUMN notes_internal TEXT;

-- inventory_movements extensions
ALTER TABLE inventory_movements ADD COLUMN statement_text TEXT;
ALTER TABLE inventory_movements ADD COLUMN service_type_code TEXT;
ALTER TABLE inventory_movements ADD COLUMN notes_internal TEXT;
ALTER TABLE inventory_movements ADD COLUMN document_date TEXT;

-- Create indexes for governance quality scans
CREATE INDEX IF NOT EXISTS idx_supplier_tx_service_type
  ON supplier_transactions(company_id, service_type_code, status);

CREATE INDEX IF NOT EXISTS idx_cash_tx_service_type
  ON cash_transactions(company_id, service_type_code, status);

CREATE INDEX IF NOT EXISTS idx_inventory_mov_service_type
  ON inventory_movements(company_id, service_type_code, movement_type);

CREATE INDEX IF NOT EXISTS idx_inventory_mov_grn
  ON inventory_movements(company_id, movement_type, supplier_code, document_number)
  WHERE movement_type = 'GRN';

CREATE INDEX IF NOT EXISTS idx_inventory_mov_issue
  ON inventory_movements(company_id, movement_type, center_code, service_type_code)
  WHERE movement_type = 'ISSUE';

-- ====================================================================
-- SEED DATA: Core Service Taxonomy (7 Essential Services)
-- ====================================================================
-- These are the canonical service types for Nawa al-Mustaqbal operations.
-- All new transactions MUST reference one of these services.

INSERT OR IGNORE INTO service_types
(company_id, code, name_ar, name_en, service_group, 
 description_ar, description_en,
 default_expense_account_code, default_ap_account_code, 
 uom_primary, requires_supplier, requires_document, requires_center, requires_season, is_active)
VALUES

-- 1. MECHANIZATION (Equipment Rental)
(1, 'SRV_MECH', 'ميكنة', 'Mechanization', 'MECHANIZATION',
 'خدمات إيجار الآليات والمعدات الثقيلة (محركات، لودرات، حفارات)', 
 'Equipment rental services (engines, loaders, excavators)',
 '5101', '2120.1', 'ساعة', 1, 1, 1, 0, 1),

-- 2. LABOR (Labor Supply)
(1, 'SRV_LABOR', 'عمالة', 'Labor', 'LABOR',
 'خدمات العمالة الموسمية والدائمة للأعمال الزراعية والتشغيلية',
 'Seasonal and permanent labor services for agricultural operations',
 '5101', '2120.1', 'عامل', 0, 0, 1, 0, 1),

-- 3. SUPPLY (Material & Chemical Purchase)
(1, 'SRV_SUPPLY', 'توريد', 'Supply', 'SUPPLY',
 'شراء المواد الخام والأسمدة والمبيدات والبذور والمدخلات الزراعية',
 'Purchase of raw materials, fertilizers, pesticides, seeds, and agricultural inputs',
 '1407', '2120.1', 'كجم', 1, 1, 0, 1, 1),

-- 4. LOGISTICS (Transportation & Distribution)
(1, 'SRV_LOGISTICS', 'نقل', 'Logistics', 'LOGISTICS',
 'خدمات النقل والتوزيع والتخزين المؤقت للمنتجات والمدخلات',
 'Transportation, distribution, and temporary storage services',
 '5101', '2120.2', 'طن', 1, 1, 1, 0, 1),

-- 5. SUPERVISION (Agricultural Supervision)
(1, 'SRV_SUPERVISION', 'اشراف زراعي', 'Supervision', 'SUPERVISION',
 'خدمات الإشراف الفني والاستشارات الزراعية والتدريب',
 'Technical supervision, agricultural consulting, and training services',
 '33067', '2120.2', 'مبلغ', 1, 1, 0, 1, 1),

-- 6. SPARE_PARTS (Equipment Spare Parts)
(1, 'SRV_SPARE_PARTS', 'قطع الغيار', 'Spare Parts', 'SUPPLY',
 'شراء قطع الغيار والملحقات والأدوات الاستبدالية للمعدات',
 'Purchase of replacement parts and accessories for equipment',
 '1407', '2120.1', 'عدد', 1, 1, 0, 0, 1),

-- 7. ADMIN_OVERHEAD (Administrative Overhead)
(1, 'SRV_ADMIN', 'مصاريف إدارية', 'Admin Overhead', 'OTHER',
 'المصاريف الإدارية والتشغيلية المتنوعة (اتصالات، نقل، إعلانات، إلخ)',
 'Miscellaneous administrative expenses (communications, transport, advertising, etc.)',
 '33xxx', '2120.3', 'مبلغ', 0, 0, 0, 0, 1);

-- ====================================================================
-- SEED DATA: Supplier-Service Mappings (Known Suppliers)
-- ====================================================================
-- This matrix defines which suppliers are authorized for which services.
-- Based on historical analysis in DATA-EXECUTION_PLAN.md

INSERT OR IGNORE INTO supplier_service_map
(company_id, supplier_code, service_type_code, is_primary, ap_subaccount_code, authorization_date, notes, is_active)
VALUES

-- Equipment Rental Suppliers
(1, 20100033, 'SRV_MECH', 1, '2120.1', '2025-11-01', 'عمرو السمالوسي - لودر', 1),
(1, 20300086, 'SRV_MECH', 1, '2120.1', '2025-11-01', 'عيد شعبان - لودر', 1),
(1, 20300121, 'SRV_MECH', 1, '2120.1', '2025-11-01', 'ميكنة احمد عبيد', 1),

-- Labor Suppliers
(1, 21400002, 'SRV_LABOR', 1, '2120.1', '2025-12-01', 'احمد دسوقي - عمالة', 1),
(1, 21400108, 'SRV_LABOR', 1, '2120.1', '2025-12-15', 'ابراهيم رمضان الكيلاوي', 1),

-- Multi-Service Suppliers (CRITICAL: Split into logical service streams)
-- شركة عرفة: Materials and Supervision MUST be separate
(1, 20900353, 'SRV_SUPPLY', 1, '2120.1', '2025-11-15', 'شركة عرفة - Arm 1: Fertilizers, Seeds, Chemicals', 1),
(1, 20900353, 'SRV_SUPERVISION', 0, '2120.2', '2025-11-15', 'شركة عرفة - Arm 2: Agricultural Supervision (separate payment flow)', 1),

-- Misc Cash Suppliers
(1, 20800286, 'SRV_SPARE_PARTS', 1, '2120.1', '2025-11-20', 'مورد نقدي - Small equipment and supplies', 1),

-- Equity Investor (Special Role - NOT a operational supplier)
-- Note: جهاز مستقبل مصر (20900151) is primarily an equity partner, not an operational supplier.
-- Any transactions with this code should be reviewed for classification.
(1, 20900151, 'SRV_ADMIN', 0, '2120.3', '2025-11-01', 'جهاز مستقبل مصر (Investor) - Rare operational transactions', 0);

-- ====================================================================
-- BACKFILL: Populate statement_text from Legacy Fields
-- ====================================================================
-- Best-effort: copy from notes/narration where statement_text is NULL

UPDATE supplier_transactions
SET statement_text = COALESCE(statement_text, notes)
WHERE company_id = 1 AND statement_text IS NULL AND notes IS NOT NULL;

UPDATE cash_transactions
SET statement_text = COALESCE(statement_text, narration)
WHERE company_id = 1 AND statement_text IS NULL AND narration IS NOT NULL;

UPDATE inventory_movements
SET statement_text = COALESCE(statement_text, notes)
WHERE company_id = 1 AND statement_text IS NULL AND notes IS NOT NULL;

-- ====================================================================
-- BACKFILL: Map Historical Transactions to Service Types
-- ====================================================================
-- Deterministic mapping based on expense_category and supplier_code

-- Equipment Rental → SRV_MECH
UPDATE supplier_transactions
SET service_type_code = 'SRV_MECH'
WHERE company_id = 1 AND service_type_code IS NULL 
  AND TRIM(COALESCE(expense_category, '')) = 'ميكنة';

-- Labor Supply → SRV_LABOR
UPDATE supplier_transactions
SET service_type_code = 'SRV_LABOR'
WHERE company_id = 1 AND service_type_code IS NULL 
  AND TRIM(COALESCE(expense_category, '')) = 'عمالة';

-- Supplier-based mapping (for suppliers without explicit expense_category)
UPDATE supplier_transactions
SET service_type_code = 'SRV_MECH'
WHERE company_id = 1 AND service_type_code IS NULL 
  AND supplier_code IN (20100033, 20300086, 20300121);

UPDATE supplier_transactions
SET service_type_code = 'SRV_LABOR'
WHERE company_id = 1 AND service_type_code IS NULL 
  AND supplier_code IN (21400002, 21400108);

UPDATE supplier_transactions
SET service_type_code = 'SRV_SUPPLY'
WHERE company_id = 1 AND service_type_code IS NULL 
  AND supplier_code = 20900353 AND TRIM(COALESCE(expense_category, '')) NOT IN ('اشراف زراعي', 'إشراف');

UPDATE supplier_transactions
SET service_type_code = 'SRV_SUPERVISION'
WHERE company_id = 1 AND service_type_code IS NULL 
  AND supplier_code = 20900353 AND TRIM(COALESCE(expense_category, '')) IN ('اشراف زراعي', 'إشراف');

-- ====================================================================
-- POST-BACKFILL: Identify Gaps with Governance Flags
-- ====================================================================
-- Mark any transactions that still lack service_type_code for review

INSERT OR IGNORE INTO movement_governance_flags
(company_id, source_module, source_table, source_id, flag_code, severity, flag_status, flag_details)
SELECT 
  1, 'suppliers', 'supplier_transactions', id, 
  'MISSING_SERVICE_TYPE', 'error', 'open',
  'Posted supplier transaction lacks service_type_code; GL routing ambiguous'
FROM supplier_transactions
WHERE company_id = 1 AND status = 'posted' AND service_type_code IS NULL;

INSERT OR IGNORE INTO movement_governance_flags
(company_id, source_module, source_table, source_id, flag_code, severity, flag_status, flag_details)
SELECT 
  1, 'inventory', 'inventory_movements', id, 
  'MISSING_SERVICE_TYPE', 'error', 'open',
  'Posted ISSUE movement lacks service_type_code; GL posting cannot proceed'
FROM inventory_movements
WHERE company_id = 1 AND movement_type = 'ISSUE' AND service_type_code IS NULL;

INSERT OR IGNORE INTO movement_governance_flags
(company_id, source_module, source_table, source_id, flag_code, severity, flag_status, flag_details)
SELECT 
  1, 'inventory', 'inventory_movements', id, 
  'MISSING_STATEMENT_TEXT', 'warning', 'open',
  'Inventory movement lacks meaningful statement_text for audit trail'
FROM inventory_movements
WHERE company_id = 1 AND (statement_text IS NULL OR LENGTH(TRIM(statement_text)) < 3);

-- ====================================================================
-- VERIFICATION QUERIES (Run Post-Deployment)
-- ====================================================================
-- Uncomment below to verify the schema was applied correctly

-- SELECT COUNT(*) AS service_type_count FROM service_types WHERE company_id = 1 AND is_active = 1;
-- SELECT code, name_ar, service_group FROM service_types WHERE company_id = 1 ORDER BY code;
-- SELECT COUNT(*) AS mapping_count FROM supplier_service_map WHERE company_id = 1 AND is_active = 1;
-- SELECT supplier_code, COUNT(*) AS service_count FROM supplier_service_map WHERE company_id = 1 AND is_active = 1 GROUP BY supplier_code;
-- SELECT COUNT(*) AS posted_null_service FROM supplier_transactions WHERE company_id = 1 AND status = 'posted' AND service_type_code IS NULL;
-- SELECT COUNT(*) AS issue_null_service FROM inventory_movements WHERE company_id = 1 AND movement_type = 'ISSUE' AND service_type_code IS NULL;
-- SELECT flag_code, COUNT(*) AS flag_count FROM movement_governance_flags WHERE company_id = 1 AND flag_status = 'open' GROUP BY flag_code;

COMMIT;
