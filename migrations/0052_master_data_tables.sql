-- ============================================================================
-- 0052_MASTER_DATA_TABLES.sql
--
-- New reference tables for dimension expansion
-- No impact on existing data — all additive
-- ============================================================================

PRAGMA foreign_keys = OFF;

-- ============================================================================
-- MD_MATERIAL_GROUPS — Product categorization
-- ============================================================================
CREATE TABLE IF NOT EXISTS md_material_groups (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  UNIQUE(company_id, code),
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_md_mg_company_active 
  ON md_material_groups(company_id, is_active);

-- Seed material groups (نموذجي للزراعة)
INSERT OR IGNORE INTO md_material_groups (company_id, code, name, description) VALUES
  (1, 'SEEDS', 'التقاوي', 'بذور الزراعة الأساسية'),
  (1, 'FERTILIZERS', 'الأسمدة', 'أسمدة كيماوية وعضوية'),
  (1, 'PESTICIDES', 'المبيدات', 'مبيدات ومكافحات'),
  (1, 'FUEL', 'الوقود', 'الوقود والزيوت'),
  (1, 'EQUIPMENT', 'المعدات', 'معدات وآلات'),
  (1, 'SPARE_PARTS', 'قطع غيار', 'قطع غيار ومستهلكات'),
  (1, 'LABOR_SERVICES', 'خدمات عمالة', 'خدمات عمالة وتقاول');

-- ============================================================================
-- MD_COSTING_METHODS — Reference table for available costing methods
-- ============================================================================
CREATE TABLE IF NOT EXISTS md_costing_methods (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO md_costing_methods (code, name, description) VALUES
  ('ACTUAL', 'التكلفة الفعلية', 'Actual Cost — سعر الشراء الفعلي'),
  ('STANDARD', 'التكلفة المعيارية', 'Standard Cost — سعر معياري محدد مسبقاً'),
  ('FIFO', 'الداخل أولاً الخارج أولاً', 'First In First Out — FIFO'),
  ('LIFO', 'الخارج أولاً الداخل أولاً', 'Last In First Out — LIFO'),
  ('MOVING_AVERAGE', 'المتوسط المتحرك', 'Moving Average — weighted average');

-- ============================================================================
-- MD_BUSINESS_UNITS — Organizational divisions
-- ============================================================================
CREATE TABLE IF NOT EXISTS md_business_units (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  UNIQUE(company_id, code),
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_md_bu_company_active 
  ON md_business_units(company_id, is_active);

-- Seed business units (نموذجي للشركة الزراعية)
INSERT OR IGNORE INTO md_business_units (company_id, code, name, description) VALUES
  (1, 'FARM_OPS', 'عمليات المزرعة', 'المزارع والإنتاج الزراعي'),
  (1, 'HARVEST', 'التجهيز والحصاد', 'تجهيز وحصاد المحاصيل'),
  (1, 'TRADING', 'التجارة', 'شراء وبيع المنتجات'),
  (1, 'SERVICES', 'الخدمات', 'خدمات بيطرية وفنية'),
  (1, 'ADMIN', 'إداري', 'الإدارة والعمليات الداعمة');

-- ============================================================================
-- MD_ACCOUNT_ROLES — Account classification by function
-- (For Phase 3 transition — added here for reference)
-- ============================================================================
CREATE TABLE IF NOT EXISTS md_account_roles (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  category TEXT CHECK(category IN ('INVENTORY', 'P&L', 'BALANCE_SHEET', 'CONTROL'))
);

INSERT OR IGNORE INTO md_account_roles (code, name, description, category) VALUES
  ('INVENTORY', 'حساب المخزون', 'حساب المخزون الجاري', 'BALANCE_SHEET'),
  ('WIP', 'العمل قيد الإنجاز', 'Work in Progress', 'BALANCE_SHEET'),
  ('FINISHED_GOODS', 'البضاعة التامة', 'Finished Goods', 'BALANCE_SHEET'),
  ('COGS', 'تكلفة البضاعة المباعة', 'Cost of Goods Sold', 'P&L'),
  ('PURCHASES', 'المشتريات', 'Purchases Account', 'P&L'),
  ('SALES', 'المبيعات', 'Sales Revenue', 'P&L'),
  ('SALES_RETURNS', 'مرتجعات المبيعات', 'Sales Returns', 'P&L'),
  ('PURCH_RETURNS', 'مرتجعات المشتريات', 'Purchase Returns', 'P&L'),
  ('EXPENSE', 'مصروفات', 'Operating Expenses', 'P&L'),
  ('CASH', 'حساب الخزينة', 'Cash Account', 'BALANCE_SHEET'),
  ('BANK', 'حساب البنك', 'Bank Account', 'BALANCE_SHEET'),
  ('AP', 'حسابات الدفع', 'Accounts Payable', 'BALANCE_SHEET'),
  ('AR', 'حسابات الاستقبال', 'Accounts Receivable', 'BALANCE_SHEET'),
  ('GRNI', 'حساب GR/IR مؤقت', 'Goods Received Not Invoiced', 'BALANCE_SHEET'),
  ('ACCRUAL', 'مستحقات', 'Accruals and Deferrals', 'BALANCE_SHEET'),
  ('VARIANCE', 'فروقات', 'Inventory/Price Variances', 'P&L');

-- ============================================================================
-- GL_JOURNAL_AUDIT — Dedicated audit trail for GL changes
-- ============================================================================
CREATE TABLE IF NOT EXISTS gl_journal_audit (
  id INTEGER PRIMARY KEY,
  journal_entry_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'POST', 'REVERSE', 'CORRECT')),
  old_value_json TEXT,  -- Previous state as JSON
  new_value_json TEXT,  -- Current state as JSON
  changed_by INTEGER,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT,
  
  FOREIGN KEY(journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gl_ja_entry_id 
  ON gl_journal_audit(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_gl_ja_action_date 
  ON gl_journal_audit(action, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_gl_ja_changed_by 
  ON gl_journal_audit(changed_by);

-- ============================================================================
-- MD_CURRENCIES — Currency master data
-- ============================================================================
CREATE TABLE IF NOT EXISTS md_currencies (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT,
  decimal_places INTEGER DEFAULT 2,
  is_active INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO md_currencies (code, name, symbol, decimal_places) VALUES
  ('EGP', 'الجنيه المصري', '£', 2),
  ('USD', 'الدولار الأمريكي', '$', 2),
  ('EUR', 'اليورو', '€', 2),
  ('GBP', 'الجنيه الإسترليني', '£', 2),
  ('SAR', 'الريال السعودي', 'ر.س', 2),
  ('AED', 'الدرهم الإماراتي', 'د.إ', 2),
  ('QAR', 'الريال القطري', 'ر.ق', 2),
  ('KWD', 'الدينار الكويتي', 'د.ك', 3);

-- ============================================================================
-- Verification
-- ============================================================================
SELECT 'Phase 1 Master Data Tables Created' as status;
SELECT 'Material Groups' as entity, COUNT(*) as count FROM md_material_groups
UNION ALL
SELECT 'Business Units', COUNT(*) FROM md_business_units
UNION ALL
SELECT 'Account Roles', COUNT(*) FROM md_account_roles
UNION ALL
SELECT 'Currencies', COUNT(*) FROM md_currencies
UNION ALL
SELECT 'Costing Methods', COUNT(*) FROM md_costing_methods;

PRAGMA foreign_keys = ON;
