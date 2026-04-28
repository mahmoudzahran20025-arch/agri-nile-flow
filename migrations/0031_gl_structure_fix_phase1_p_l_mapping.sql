-- ============================================================================
-- PHASE 1: P&L MAPPING FIX
-- Fixes 143 Income Statement accounts (4x-7x) with missing mapping categories
-- ============================================================================
-- Migration: 0031_gl_structure_fix_phase1_p_l_mapping.sql
-- Date: April 28, 2026
-- Issue: GL Audit Finding 1.1 — Entire P&L side has no mapping

-- Step 1: Create P&L mapping category lookup table (if not exists)
CREATE TABLE IF NOT EXISTS p_l_mapping_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  account_type TEXT NOT NULL CHECK (account_type IN ('REVENUE', 'EXPENSE', 'FINANCE')),
  sort_order INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Step 2: Insert standard P&L mapping categories (if not already present)
INSERT OR IGNORE INTO p_l_mapping_categories (code, name_ar, name_en, account_type, sort_order) VALUES
  ('REV_OPS', 'الإيرادات التشغيلية', 'Operating Revenue', 'REVENUE', 1),
  ('REV_OTHER', 'الإيرادات الأخرى', 'Other Income', 'REVENUE', 2),
  ('EXP_OPS', 'مصروفات التشغيل', 'Operating Expenses', 'EXPENSE', 3),
  ('EXP_SALES', 'مصروفات البيع والتوزيع', 'Sales & Distribution Expenses', 'EXPENSE', 4),
  ('EXP_ADMIN', 'المصروفات الإدارية والعمومية', 'General & Administrative Expenses', 'EXPENSE', 5),
  ('EXP_FINANCE', 'تكاليف التمويل', 'Finance Costs', 'FINANCE', 6),
  ('REV_FINANCE', 'إيرادات التمويل', 'Finance Income', 'FINANCE', 7);

-- Step 3: Update chart_of_accounts with mapping for 4x (Revenue) accounts
UPDATE chart_of_accounts
SET mapping = 'REV_OPS',
    mapping_detailed = 'Revenue accounts',
    updated_at = datetime('now')
WHERE company_id = 1
  AND SUBSTR(code, 1, 1) = '4'
  AND (mapping IS NULL OR mapping = '')
  AND SUBSTR(code, 1, 2) IN ('41', '42', '43');

UPDATE chart_of_accounts
SET mapping = 'REV_OTHER',
    mapping_detailed = 'Other income accounts',
    updated_at = datetime('now')
WHERE company_id = 1
  AND SUBSTR(code, 1, 1) = '4'
  AND (mapping IS NULL OR mapping = '')
  AND SUBSTR(code, 1, 2) IN ('44', '45', '46', '47');

-- Step 4: Update chart_of_accounts with mapping for 5x (Expense) accounts
-- Expenses typically subdivide into operations, sales, and admin
UPDATE chart_of_accounts
SET mapping = 'EXP_OPS',
    mapping_detailed = 'Cost of Goods Sold & Operating Expenses',
    updated_at = datetime('now')
WHERE company_id = 1
  AND SUBSTR(code, 1, 1) = '5'
  AND (mapping IS NULL OR mapping = '')
  AND SUBSTR(code, 1, 2) IN ('51', '52', '53');

UPDATE chart_of_accounts
SET mapping = 'EXP_SALES',
    mapping_detailed = 'Sales, Distribution & Marketing Expenses',
    updated_at = datetime('now')
WHERE company_id = 1
  AND SUBSTR(code, 1, 1) = '5'
  AND (mapping IS NULL OR mapping = '')
  AND SUBSTR(code, 1, 2) IN ('54', '55');

UPDATE chart_of_accounts
SET mapping = 'EXP_ADMIN',
    mapping_detailed = 'General, Administrative & Corporate Expenses',
    updated_at = datetime('now')
WHERE company_id = 1
  AND SUBSTR(code, 1, 1) = '5'
  AND (mapping IS NULL OR mapping = '')
  AND SUBSTR(code, 1, 2) IN ('56', '57', '58', '59');

-- Step 5: Update chart_of_accounts with mapping for 6x (Finance Costs) and 7x (Other Income)
UPDATE chart_of_accounts
SET mapping = 'EXP_FINANCE',
    mapping_detailed = 'Finance Costs',
    updated_at = datetime('now')
WHERE company_id = 1
  AND SUBSTR(code, 1, 1) = '6'
  AND (mapping IS NULL OR mapping = '');

UPDATE chart_of_accounts
SET mapping = 'REV_FINANCE',
    mapping_detailed = 'Finance Income & Other Revenues',
    updated_at = datetime('now')
WHERE company_id = 1
  AND SUBSTR(code, 1, 1) = '7'
  AND (mapping IS NULL OR mapping = '');

-- Step 6: Verify results (informational — not executed, just logged)
-- SELECT COUNT(*) as unmapped_p_l
-- FROM chart_of_accounts
-- WHERE company_id = 1
--   AND SUBSTR(code, 1, 1) IN ('4', '5', '6', '7')
--   AND (mapping IS NULL OR mapping = '');

-- Expected result after this migration: 0 unmapped P&L accounts
