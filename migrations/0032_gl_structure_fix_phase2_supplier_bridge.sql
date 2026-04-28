-- ============================================================================
-- PHASE 2: SUPPLIER CODE BRIDGE FIX
-- Creates mapping between treasury codes (الاكواد sheet) and COA AP accounts
-- ============================================================================
-- Migration: 0032_gl_structure_fix_phase2_supplier_bridge.sql
-- Date: April 28, 2026
-- Issue: GL Audit Finding 1.3 — Supplier codes bifurcated (treasury ≠ COA)

-- Step 1: Create supplier_code_bridge table
CREATE TABLE IF NOT EXISTS supplier_code_bridge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  treasury_code TEXT NOT NULL,
  -- treasury_code: what appears in خزينة نواة المستقبل (e.g., 20900353)
  
  supplier_code TEXT NOT NULL,
  -- supplier_code: what exists in suppliers.code table (e.g., 20900353 or internal)
  
  coa_ap_account TEXT NOT NULL,
  -- coa_ap_account: COA posting account (e.g., 212000015 for شركة عرفة)
  
  product_category TEXT,
  -- product_category: optional — for suppliers with multiple categories (أسمدة/مبيدات/ميكنة)
  
  supplier_name TEXT NOT NULL,
  -- supplier_name: reference/display name
  
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, treasury_code, product_category)
);

-- Step 2: Create index for fast lookup
CREATE INDEX IF NOT EXISTS idx_supplier_code_bridge_treasury 
  ON supplier_code_bridge(company_id, treasury_code);

-- Step 3: Populate bridge with known mappings from audit report
-- (شركة عرفة للتصدير والتنمية الزراعية) — شركة عرفة
INSERT OR IGNORE INTO supplier_code_bridge 
  (company_id, treasury_code, supplier_code, coa_ap_account, product_category, supplier_name) 
VALUES 
  (1, '20900353', '20900353', '212000014', 'أسمدة', 'شركة عرفة للتصدير'),
  (1, '20900353', '20900353', '212000015', 'مبيدات', 'شركة عرفة للتصدير'),
  (1, '20900353', '20900353', '212000016', 'ميكنة', 'شركة عرفة للتصدير');

-- عمرو السمالوسي
INSERT OR IGNORE INTO supplier_code_bridge 
  (company_id, treasury_code, supplier_code, coa_ap_account, product_category, supplier_name) 
VALUES 
  (1, '20100033', '20100033', '212000019', NULL, 'عمرو السمالوسي');

-- عيد شعبان
INSERT OR IGNORE INTO supplier_code_bridge 
  (company_id, treasury_code, supplier_code, coa_ap_account, product_category, supplier_name) 
VALUES 
  (1, '20300086', '20300086', '212000020', NULL, 'عيد شعبان');

-- ميكنة احمد عبيد (no COA match found in audit — using placeholder)
INSERT OR IGNORE INTO supplier_code_bridge 
  (company_id, treasury_code, supplier_code, coa_ap_account, product_category, supplier_name, notes) 
VALUES 
  (1, '20300121', '20300121', '212000029', NULL, 'ميكنة احمد عبيد', 'MAPPING INCOMPLETE — COA account not found in original audit');

-- احمد دسوقي
INSERT OR IGNORE INTO supplier_code_bridge 
  (company_id, treasury_code, supplier_code, coa_ap_account, product_category, supplier_name) 
VALUES 
  (1, '21400002', '21400002', '212000018', NULL, 'احمد دسوقي');

-- ابراهيم رمضان الكيلاوي
INSERT OR IGNORE INTO supplier_code_bridge 
  (company_id, treasury_code, supplier_code, coa_ap_account, product_category, supplier_name) 
VALUES 
  (1, '21400108', '21400108', '212000017', NULL, 'ابراهيم رمضان الكيلاوي');

-- مورد نقدي (generic/cash vendor)
INSERT OR IGNORE INTO supplier_code_bridge 
  (company_id, treasury_code, supplier_code, coa_ap_account, product_category, supplier_name) 
VALUES 
  (1, '20800286', '20800286', '212000021', NULL, 'مورد نقدي');

-- Step 4: Add bridge lookup helper function (via stored procedure equivalent in Hono layer)
-- NOTE: D1 SQLite doesn't support stored procedures, so bridging logic will be in:
--       src/api/gl/bridge.ts → provides queries for auto-posting engine

-- Step 5: Verify bridge coverage
-- SELECT COUNT(*) as bridge_rows FROM supplier_code_bridge WHERE company_id = 1;
-- Expected: 9 rows (7 suppliers, 1 with 3 categories)

-- SELECT treasury_code, COUNT(*) as routes
-- FROM supplier_code_bridge
-- WHERE company_id = 1
-- GROUP BY treasury_code
-- ORDER BY treasury_code;
-- Expected: Each supplier code maps to 1-3 COA accounts
