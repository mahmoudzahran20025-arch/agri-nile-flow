-- ═══════════════════════════════════════════════════════════════
--  Phase 3 — General Ledger (محاسبة المزدوج — دفتر الأستاذ العام)
-- ═══════════════════════════════════════════════════════════════

-- ── 1. شجرة الحسابات ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL,
  code           TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  account_type   TEXT    NOT NULL CHECK(account_type IN ('asset','liability','equity','revenue','expense')),
  normal_balance TEXT    NOT NULL CHECK(normal_balance IN ('debit','credit')),
  parent_code    TEXT,
  level          INTEGER NOT NULL DEFAULT 1,
  is_header      INTEGER NOT NULL DEFAULT 0,  -- 1 = رأس مجموعة / لا يُقيَّد عليه مباشرة
  is_active      INTEGER NOT NULL DEFAULT 1,
  notes          TEXT,
  UNIQUE(company_id, code),
  FOREIGN KEY(company_id) REFERENCES companies(id)
);

-- ── 2. الفترات المالية ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS financial_periods (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL,
  name        TEXT    NOT NULL,
  period_type TEXT    NOT NULL DEFAULT 'monthly'
              CHECK(period_type IN ('monthly','quarterly','annual')),
  start_date  TEXT    NOT NULL,
  end_date    TEXT    NOT NULL,
  is_closed   INTEGER NOT NULL DEFAULT 0,
  closed_at   TEXT,
  closed_by   INTEGER,
  FOREIGN KEY(company_id) REFERENCES companies(id)
);

-- ── 3. رؤوس قيود اليومية ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL,
  period_id    INTEGER,
  entry_number TEXT,
  entry_date   TEXT    NOT NULL,
  description  TEXT    NOT NULL,
  ref_type     TEXT,   -- cash_transaction | supplier_transaction | inventory_movement | manual
  ref_id       INTEGER,
  is_posted    INTEGER NOT NULL DEFAULT 1,
  created_by   INTEGER,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(period_id)  REFERENCES financial_periods(id)
);

-- ── 4. بنود القيود ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id     INTEGER NOT NULL,
  company_id   INTEGER NOT NULL,
  account_code TEXT    NOT NULL,
  debit        REAL    NOT NULL DEFAULT 0,
  credit       REAL    NOT NULL DEFAULT 0,
  description  TEXT,
  FOREIGN KEY(entry_id)   REFERENCES journal_entries(id) ON DELETE CASCADE,
  FOREIGN KEY(company_id) REFERENCES companies(id)
);

-- ── 5. ربط الحسابات الافتراضية ──────────────────────────────────
CREATE TABLE IF NOT EXISTS gl_account_mappings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL,
  mapping_key  TEXT    NOT NULL,  -- cash | accounts_payable | inventory | revenue_default | expense_default
  account_code TEXT    NOT NULL,
  UNIQUE(company_id, mapping_key),
  FOREIGN KEY(company_id) REFERENCES companies(id)
);

-- ══════════════════════════════════════════════════════════════════
--  SEED: شجرة الحسابات الافتراضية (لكل الشركات الموجودة)
-- ══════════════════════════════════════════════════════════════════

-- ─── الأصول ──────────────────────────────────────────────────────
INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'1000','الأصول','asset','debit',NULL,1,1 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'1100','الأصول المتداولة','asset','debit','1000',2,1 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'1110','الخزينة والبنوك','asset','debit','1100',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'1120','الذمم المدينة (عملاء)','asset','debit','1100',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'1130','المخزون والمستلزمات الزراعية','asset','debit','1100',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'1140','دفعات مقدمة للموردين','asset','debit','1100',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'1200','الأصول الثابتة','asset','debit','1000',2,1 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'1210','الأراضي الزراعية','asset','debit','1200',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'1220','المعدات والآلات الزراعية','asset','debit','1200',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'1230','مركبات','asset','debit','1200',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'1290','(مجمع اهتلاك الأصول الثابتة)','asset','credit','1200',3,0 FROM companies;

-- ─── الخصوم ──────────────────────────────────────────────────────
INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'2000','الخصوم','liability','credit',NULL,1,1 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'2100','الخصوم المتداولة','liability','credit','2000',2,1 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'2110','الذمم الدائنة — موردون','liability','credit','2100',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'2120','مصروفات مستحقة الدفع','liability','credit','2100',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'2130','دفعات مقدمة من العملاء','liability','credit','2100',3,0 FROM companies;

-- ─── حقوق الملكية ────────────────────────────────────────────────
INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'3000','حقوق الملكية','equity','credit',NULL,1,1 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'3110','رأس المال المدفوع','equity','credit','3000',2,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'3120','حقوق الشركاء','equity','credit','3000',2,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'3130','الأرباح المحتجزة','equity','credit','3000',2,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'3140','أرباح/خسائر السنة الحالية','equity','credit','3000',2,0 FROM companies;

-- ─── الإيرادات ───────────────────────────────────────────────────
INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'4000','الإيرادات','revenue','credit',NULL,1,1 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'4100','إيرادات بيع المحاصيل','revenue','credit','4000',2,1 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'4110','إيرادات القمح','revenue','credit','4100',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'4120','إيرادات الذرة','revenue','credit','4100',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'4130','إيرادات الأرز','revenue','credit','4100',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'4190','إيرادات محاصيل أخرى','revenue','credit','4100',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'4200','إيرادات أخرى','revenue','credit','4000',2,1 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'4210','إيرادات متنوعة','revenue','credit','4200',3,0 FROM companies;

-- ─── المصروفات ───────────────────────────────────────────────────
INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'5000','المصروفات','expense','debit',NULL,1,1 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'5100','تكاليف الإنتاج الزراعي','expense','debit','5000',2,1 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'5110','تكلفة الأسمدة والمبيدات','expense','debit','5100',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'5120','تكلفة البذور والمستلزمات','expense','debit','5100',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'5130','تكلفة الري','expense','debit','5100',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'5140','تكلفة الحصاد','expense','debit','5100',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'5200','مصروفات العمالة','expense','debit','5000',2,1 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'5210','أجور العمال اليومية','expense','debit','5200',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'5220','مرتبات الموظفين','expense','debit','5200',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'5300','مصروفات الإيجارات','expense','debit','5000',2,1 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'5310','إيجار الأراضي الزراعية','expense','debit','5300',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'5400','المصروفات الإدارية والعمومية','expense','debit','5000',2,1 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'5410','مصروفات إدارية وعمومية','expense','debit','5400',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'5420','اهتلاك الأصول الثابتة','expense','debit','5400',3,0 FROM companies;

INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,account_type,normal_balance,parent_code,level,is_header)
SELECT id,'5430','مصروفات متنوعة','expense','debit','5400',3,0 FROM companies;

-- ── SEED: الحسابات الافتراضية لكل شركة ───────────────────────────
INSERT OR IGNORE INTO gl_account_mappings (company_id, mapping_key, account_code)
SELECT id, 'cash',              '1110' FROM companies;

INSERT OR IGNORE INTO gl_account_mappings (company_id, mapping_key, account_code)
SELECT id, 'accounts_payable',  '2110' FROM companies;

INSERT OR IGNORE INTO gl_account_mappings (company_id, mapping_key, account_code)
SELECT id, 'inventory',         '1130' FROM companies;

INSERT OR IGNORE INTO gl_account_mappings (company_id, mapping_key, account_code)
SELECT id, 'revenue_default',   '4210' FROM companies;

INSERT OR IGNORE INTO gl_account_mappings (company_id, mapping_key, account_code)
SELECT id, 'expense_default',   '5410' FROM companies;

-- ── SEED: الفترة المالية 2025 لكل شركة ───────────────────────────
INSERT OR IGNORE INTO financial_periods (company_id, name, period_type, start_date, end_date)
SELECT id, 'السنة المالية 2025', 'annual', '2025-01-01', '2025-12-31' FROM companies;
