# خطة تحديث البوستينج انجين: النسخة المرجعية المتقدمة
**التاريخ:** 1 مايو 2026  
**الحالة:** مشروع متعدد الأطوار  
**المدة الإجمالية:** 8-10 أسابيع (مع Phase 3)

---

## الملخص التنفيذي

نقل النظام من هيكل معاملة مسطح (`posting_rules` بأعمدة ثابتة) إلى نموذج قيادي مرن يدعم:
- ✅ تعددية العملات (Multi-Currency)
- ✅ أدوار حسابية مرنة (Account Roles)
- ✅ صلاحية القواعد بالتاريخ (Valid From/To)
- ✅ أبعاد إضافية (Material Group, Warehouse, Business Unit)
- ✅ تصنيف موحد للأحداث (MD_EVENT_TYPE)

**الخطر من الكسر:** منخفض جداً (بيانات تطوير فقط)  
**الفائدة:** نظام قابل للتوسع لمدة 5+ سنوات

---

## Phase 0: التقييم والإعداد (أسبوع 1)

### المهام

#### 0.1 تدقيق البيانات الموجودة
```sql
-- عدد الصفوف في الجداول الحساسة
SELECT 
  'posting_rules' as table_name, COUNT(*) as row_count FROM posting_rules
UNION ALL
SELECT 'journal_entries', COUNT(*) FROM journal_entries
UNION ALL
SELECT 'journal_entry_lines', COUNT(*) FROM journal_entry_lines
UNION ALL
SELECT 'business_events', COUNT(*) FROM business_events;
```

**النتيجة المتوقعة:**
- `posting_rules`: 50-100 صف (قابل للحذف والإعادة)
- `journal_entries`: 100-500 صف (يمكن archive)
- `business_events`: نفس العدد تقريباً

**الإجراء:** إذا كان العدد أكبر من 5000، انتظر Cutover بدل الـ Dev Phase

---

#### 0.2 Backup كامل
```powershell
# في البداية والنهاية
wrangler d1 execute agri-nile-flow-data-lake --remote --file=backup.sql > backup_$(Get-Date -Format yyyyMMdd_HHmmss).sql
```

#### 0.3 إنشاء Branch للتطوير
```bash
git checkout -b feature/posting-engine-modernization
git push origin feature/posting-engine-modernization
```

**Deliverable:**
- [ ] Backup SQL موجود
- [ ] Git branch جاهز
- [ ] توثيق عدد الصفوف الموجودة
- [ ] قائمة Posting Rules الحالية (للمقارنة بعدين)

---

## Phase 1: أساسيات الـ Schema الجديد (أسابيع 2-3)

### المهام

#### 1.1 إضافة أعمدة آمنة (Backward Compatible)

**ملف Migration:** `0051_posting_engine_phase1_basics.sql`

```sql
-- 1. Valid From/To على posting_rules
ALTER TABLE posting_rules ADD COLUMN valid_from TEXT DEFAULT NULL;
ALTER TABLE posting_rules ADD COLUMN valid_to TEXT DEFAULT NULL;
-- NULL = دايما صالح (الحالة الحالية)

-- 2. نموذج التكلفة على companies
ALTER TABLE companies ADD COLUMN costing_method TEXT DEFAULT 'ACTUAL'
  CHECK(costing_method IN ('ACTUAL', 'STANDARD', 'FIFO', 'MOVING_AVERAGE'));

-- 3. تحديد العملة الافتراضية على companies
ALTER TABLE companies ADD COLUMN base_currency_code TEXT DEFAULT 'EGP';

-- 4. Multi-Currency على journal_entry_lines
ALTER TABLE journal_entry_lines ADD COLUMN currency_code TEXT DEFAULT 'EGP';
ALTER TABLE journal_entry_lines ADD COLUMN amount_in_base_currency REAL;
-- amount_in_base_currency = debit + credit converted to base

-- 5. Business Unit على journal_entry_lines
ALTER TABLE journal_entry_lines ADD COLUMN business_unit_id INTEGER;
CREATE INDEX idx_jel_bu ON journal_entry_lines(business_unit_id);

-- 6. Account Role على journal_entry_lines (للـ Phase 3، لكن نضيفها بدري)
ALTER TABLE journal_entry_lines ADD COLUMN account_role_id INTEGER;
-- REFERENCES md_account_roles.id (جدول جديد في Phase 3)

-- 7. WH dimension في posting_rules (اختياري لـ warehouse-specific rules)
ALTER TABLE posting_rules ADD COLUMN wh_id INTEGER;
-- NULL = ينطبق على كل المستودعات

-- 8. Order + Cascade للـ dimensions في posting_rules
ALTER TABLE posting_rules ADD COLUMN priority_index INTEGER DEFAULT 100;
-- مثال: BPG+PPG+WH = priority 1، BPG+PPG = 2، BPG = 3، NULL = 4

-- 9. تتبع من غيّر القاعدة
ALTER TABLE posting_rules ADD COLUMN last_modified_by INTEGER;
ALTER TABLE posting_rules ADD COLUMN last_modified_at TEXT;
```

**Scripts التحقق:**
```sql
-- بعد Migration: تأكد إن البيانات الموجودة بخير
SELECT COUNT(*) as total_rules FROM posting_rules;
SELECT 
  COALESCE(valid_from, 'NULL') as validity,
  COUNT(*) as count 
FROM posting_rules 
GROUP BY valid_from;

-- كل الجداول الأخرى يجب تحتفظ بـ NULL للأعمدة الجديدة
SELECT COUNT(DISTINCT company_id) as companies FROM companies;
```

---

#### 1.2 جداول ماستر جديدة (لا تؤثر على البيانات القديمة)

**ملف Migration:** `0052_master_data_tables.sql`

```sql
-- MD_MATERIAL_GROUP
CREATE TABLE IF NOT EXISTS md_material_groups (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(company_id, code),
  FOREIGN KEY(company_id) REFERENCES companies(id)
);
CREATE INDEX idx_md_mg_active ON md_material_groups(company_id, is_active);

-- MD_COSTING_METHOD (reference only — مش فاعل حتى Phase 2)
CREATE TABLE IF NOT EXISTS md_costing_methods (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT,
  description TEXT
);
INSERT INTO md_costing_methods (code, name, description) VALUES
  ('ACTUAL', 'التكلفة الفعلية', 'بالسعر الفعلي للشراء'),
  ('STANDARD', 'تكلفة معيارية', 'بسعر معياري مقرر'),
  ('FIFO', 'الداخل أولاً الخارج أولاً', 'First In First Out'),
  ('MOVING_AVERAGE', 'المتوسط المتحرك', 'Moving Average');

-- MD_BUSINESS_UNIT
CREATE TABLE IF NOT EXISTS md_business_units (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(company_id, code),
  FOREIGN KEY(company_id) REFERENCES companies(id)
);
CREATE INDEX idx_md_bu_active ON md_business_units(company_id, is_active);

-- MD_ACCOUNT_ROLES (للـ Phase 3، لكن ننشئها دلوقتي للتوثيق)
CREATE TABLE IF NOT EXISTS md_account_roles (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  -- للزراعة، هذي الأدوار كافية:
  -- INVENTORY, WIP, FINISHED_GOODS, COGS, PURCHASES, SALES, 
  -- SALES_RETURNS, PURCH_RETURNS, EXPENSE, CASH, AP, AR
  is_active INTEGER DEFAULT 1
);
INSERT OR IGNORE INTO md_account_roles (code, name, description) VALUES
  ('INVENTORY', 'حساب المخزون', 'حساب المخزون الجاري'),
  ('WIP', 'العمل قيد الإنجاز', 'Work in Progress'),
  ('FINISHED_GOODS', 'البضاعة التامة', 'Finished Goods'),
  ('COGS', 'تكلفة البضاعة المباعة', 'Cost of Goods Sold'),
  ('PURCHASES', 'المشتريات', 'Purchases'),
  ('SALES', 'المبيعات', 'Sales Revenue'),
  ('SALES_RETURNS', 'مرتجعات المبيعات', 'Sales Returns'),
  ('PURCH_RETURNS', 'مرتجعات المشتريات', 'Purchase Returns'),
  ('EXPENSE', 'مصروفات', 'Operating Expenses'),
  ('CASH', 'حساب الخزينة', 'Cash Account'),
  ('AP', 'حسابات الدفع', 'Accounts Payable'),
  ('AR', 'حسابات الاستقبال', 'Accounts Receivable'),
  ('GRNI', 'حساب GR/IR مؤقت', 'Goods Received Not Invoiced');

-- GL_JOURNAL_AUDIT (dedicated audit trail)
CREATE TABLE IF NOT EXISTS gl_journal_audit (
  id INTEGER PRIMARY KEY,
  journal_entry_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'POST', 'REVERSE')),
  old_value_json TEXT,   -- JSON من الحالة القديمة
  new_value_json TEXT,   -- JSON من الحالة الجديدة
  changed_by INTEGER,
  changed_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(journal_entry_id) REFERENCES journal_entries(id)
);
CREATE INDEX idx_gl_ja_entry ON gl_journal_audit(journal_entry_id);
CREATE INDEX idx_gl_ja_action ON gl_journal_audit(action, changed_at);
```

---

#### 1.3 تحديث الـ TypeScript Types

**ملف:** `src/types/posting.ts` (جديد)

```typescript
export interface PostingRuleV2 {
  id: number
  company_id: number
  rule_type: 'general' | 'inventory' | 'control'
  
  // Dimensions
  bus_posting_group_code?: string | null
  prod_posting_group_code?: string | null
  inv_posting_group_code?: string | null
  wh_id?: number | null  // NEW
  
  // Accounts (still flat for Phase 1-2)
  sales_account?: string | null
  purchases_account?: string | null
  cogs_account?: string | null
  // ...
  
  // Validity (NEW)
  valid_from?: string | null  // YYYY-MM-DD
  valid_to?: string | null
  
  // Priority for cascade
  priority_index: number  // 1=exact, 2=wildcard, 3=default
  
  is_active: number
  last_modified_by?: number
  last_modified_at?: string
}

export interface JournalLineV2 {
  id: number
  entry_id: number
  account_code: string
  debit: number
  credit: number
  
  // NEW: Multi-Currency
  currency_code: string  // 'EGP' by default
  amount_in_base_currency?: number
  
  // NEW: Dimensions
  business_unit_id?: number | null
  center_code?: number | null
  season_id?: number | null
  field_id?: number | null
  
  // For Phase 3
  account_role_id?: number | null
  
  description?: string
  created_at: string
}

export interface BusinessEventV2 {
  id: number
  company_id: number
  event_type: string  // Will reference MD_EVENT_TYPE.code
  event_date: string
  source_module: string  // Will reference MD_TRANSACTION_TYPE.code
  source_id: number
  payload: Record<string, any>
  status: 'pending' | 'posted' | 'error' | 'reversed'
  journal_entry_id?: number
  created_at: string
}

export interface MaterialGroup {
  id: number
  company_id: number
  code: string
  name: string
  description?: string
  is_active: number
}

export interface BusinessUnit {
  id: number
  company_id: number
  code: string
  name: string
  description?: string
  is_active: number
}

export interface AccountRole {
  id: number
  code: string
  name: string
  description?: string
  is_active: number
}
```

---

#### 1.4 تحديث الـ API Types

**ملف:** `web/src/api/gl.ts`

```typescript
export interface GeneralSetupRowV2 extends GeneralSetupRow {
  valid_from?: string | null
  valid_to?: string | null
  wh_id?: number | null
  priority_index: number
}

// Backend endpoints تصبح:
export const glApi = {
  // ... existing ...
  
  // NEW: Material Groups
  materialGroups: () => get<MaterialGroup[]>('/gl/material-groups'),
  createMaterialGroup: (data: { code: string; name: string; description?: string }) =>
    post('/gl/material-groups', data),
  
  // NEW: Business Units
  businessUnits: () => get<BusinessUnit[]>('/gl/business-units'),
  createBusinessUnit: (data: { code: string; name: string; description?: string }) =>
    post('/gl/business-units', data),
  
  // UPDATED: Posting Rules مع validity
  updatePostingRuleWithValidity: (id: number, data: {
    valid_from?: string
    valid_to?: string
    priority_index?: number
    [key: string]: any
  }) => patch(`/gl/posting-setup/general/${id}`, data),
}
```

---

### Deliverable من Phase 1

- [ ] Migration 0051 تطبقت بنجاح
- [ ] Migration 0052 تطبقت بنجاح
- [ ] البيانات القديمة محفوظة (كل الأعمدة الجديدة = NULL)
- [ ] Types جديدة في TypeScript
- [ ] API مُحدّثة (endpoints جديدة)
- [ ] Tests تمر (أو skip الأعمدة الجديدة)
- [ ] الـ Posting Engine لسه يشتغل بدون تغيير

**وقت الاختبار:** تأكد إن الـ engine الحالي لسه يطبع journal entries صح رغم الأعمدة الجديدة.

---

## Phase 2: المحركات الأساسية (أسابيع 4-6)

### المهام

#### 2.1 Multi-Currency Support

**ملف Migration:** `0053_multi_currency_support.sql`

```sql
-- 1. إنشاء جدول العملات (reference)
CREATE TABLE IF NOT EXISTS md_currencies (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT,
  decimal_places INTEGER DEFAULT 2,
  is_active INTEGER DEFAULT 1
);
INSERT OR IGNORE INTO md_currencies (code, name, symbol, decimal_places) VALUES
  ('EGP', 'Egyptian Pound', '£', 2),
  ('USD', 'US Dollar', '$', 2),
  ('EUR', 'Euro', '€', 2),
  ('SAR', 'Saudi Riyal', 'ر.س', 2);

-- 2. أسعار الصرف (يومية)
CREATE TABLE IF NOT EXISTS exchange_rates (
  id INTEGER PRIMARY KEY,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate REAL NOT NULL,
  effective_date TEXT NOT NULL,
  source TEXT,  -- 'MANUAL', 'API', 'CBE'
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(from_currency, to_currency, effective_date),
  FOREIGN KEY(from_currency) REFERENCES md_currencies(code),
  FOREIGN KEY(to_currency) REFERENCES md_currencies(code)
);
CREATE INDEX idx_er_active ON exchange_rates(effective_date, is_active);

-- 3. تحديث existing journal_entry_lines
-- الأمر الموجودة = debit/credit بـ base currency
UPDATE journal_entry_lines 
SET amount_in_base_currency = (CASE WHEN debit > 0 THEN debit ELSE credit END)
WHERE amount_in_base_currency IS NULL;

-- 4. تتبع الفروقات (Revaluation)
CREATE TABLE IF NOT EXISTS currency_revaluation_entries (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  revaluation_date TEXT NOT NULL,
  source_currency TEXT NOT NULL,
  gain_loss_journal_entry_id INTEGER,
  amount_gain REAL,
  amount_loss REAL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(gain_loss_journal_entry_id) REFERENCES journal_entries(id)
);
```

**Backend Function:** `src/lib/posting_engine_v2.ts`

```typescript
export async function convertCurrency(
  db: D1Database,
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rateDate: string,
): Promise<number> {
  if (fromCurrency === toCurrency) return amount
  
  const rate = await db
    .prepare(`
      SELECT rate FROM exchange_rates
      WHERE from_currency = ? AND to_currency = ?
      AND effective_date <= ? AND is_active = 1
      ORDER BY effective_date DESC LIMIT 1
    `)
    .bind(fromCurrency, toCurrency, rateDate)
    .first<{ rate: number }>()
  
  if (!rate) {
    throw new Error(
      `No exchange rate found: ${fromCurrency} → ${toCurrency} on ${rateDate}`
    )
  }
  
  return amount * rate.rate
}

export async function recordCurrencyRevaluation(
  db: D1Database,
  company_id: number,
  reval_date: string,
): Promise<{ gains: number; losses: number }> {
  // Find all AR/AP accounts in foreign currencies
  // Calculate unrealized gain/loss
  // Create journal entry if needed
  // ...implementation...
}
```

---

#### 2.2 Event Type Standardization

**ملف Migration:** `0054_event_type_standardization.sql`

```sql
-- MD_EVENT_TYPE (مركزي)
CREATE TABLE IF NOT EXISTS md_event_types (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  
  -- Flags: أي حسابات يتأثر بهذا الحدث
  affects_inventory INTEGER DEFAULT 0,
  affects_wip INTEGER DEFAULT 0,
  affects_cogs INTEGER DEFAULT 0,
  affects_revenue INTEGER DEFAULT 0,
  affects_expense INTEGER DEFAULT 0,
  
  is_active INTEGER DEFAULT 1
);

-- Seed with existing events from our system
INSERT OR IGNORE INTO md_event_types (
  code, name, description,
  affects_inventory, affects_cogs, affects_revenue, affects_expense
) VALUES
  ('PURCHASE_RECEIPT', 'استقبال مشتريات', 'Goods received from supplier', 1, 0, 0, 0),
  ('INVENTORY_ISSUE', 'صرف مخزون', 'Goods issued to operation', 1, 1, 0, 0),
  ('INVENTORY_TRANSFER', 'تحويل مخزون', 'Transfer between warehouses', 1, 0, 0, 0),
  ('INVENTORY_ADJUSTMENT', 'تسوية مخزون', 'Physical count adjustment', 1, 1, 0, 0),
  ('HARVEST_RECEIPT', 'استقبال محصول', 'Harvest received', 1, 0, 1, 0),
  ('SALE_INVOICE', 'فاتورة مبيعات', 'Sales revenue recognition', 0, 1, 1, 0),
  ('SALE_RETURN', 'مرتجع مبيعات', 'Sales return', 0, 1, 1, 0),
  ('SUPPLIER_INVOICE', 'فاتورة موردين', 'Supplier invoice received', 0, 0, 0, 0),
  ('SUPPLIER_PAYMENT', 'دفعة موردين', 'Supplier payment', 0, 0, 0, 0),
  ('CASH_EXPENSE', 'مصروفة نقدية', 'Cash expense', 0, 0, 0, 1),
  ('PAYROLL_RUN', 'تشغيل الرواتب', 'Payroll processing', 0, 0, 0, 1),
  ('PAYROLL_PAYMENT', 'دفعة رواتب', 'Payroll payment', 0, 0, 0, 0),
  ('DEPRECIATION', 'استهلاك', 'Fixed asset depreciation', 0, 0, 0, 1),
  ('WIP_MOVEMENT', 'حركة WIP', 'Work in progress movement', 0, 1, 0, 0),
  ('HARVEST_COGS', 'تكلفة محصول', 'COGS for harvest', 0, 1, 0, 0);

-- MD_TRANSACTION_TYPE
CREATE TABLE IF NOT EXISTS md_transaction_types (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  module_name TEXT NOT NULL,  -- 'inventory', 'procurement', 'sales', 'hr', etc.
  is_active INTEGER DEFAULT 1
);

INSERT OR IGNORE INTO md_transaction_types (code, name, module_name) VALUES
  ('INVENTORY_MOVEMENT', 'حركة مخزون', 'inventory'),
  ('PURCHASE_ORDER', 'طلب شراء', 'procurement'),
  ('SUPPLIER_INVOICE', 'فاتورة موردين', 'procurement'),
  ('SALES_ORDER', 'طلب مبيعات', 'sales'),
  ('SALES_INVOICE', 'فاتورة مبيعات', 'sales'),
  ('CASH_TRANSACTION', 'معاملة نقدية', 'treasury'),
  ('PAYROLL_RUN', 'تشغيل الرواتب', 'hr'),
  ('WORK_ORDER', 'أمر عمل', 'operations'),
  ('HARVEST_RECORD', 'تسجيل محصول', 'harvest'),
  ('JOURNAL_ENTRY', 'قيد يدوي', 'gl');

-- Update business_events table (add FK)
-- بما إن الـ business_events موجودة بالفعل، نتحقق فقط لو الـ migration يشتغل safe
-- لا نحتاج ALTER لأن event_type في business_events text ممكن تظل text
-- لكن نضيف comment لتوثيق الـ mapping
```

**Backend Update:** `src/api/posting-setup.ts`

```typescript
// Endpoint جديد: list event types
postingSetup.get('/event-types', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, code, name, description,
            affects_inventory, affects_wip, affects_cogs, affects_revenue, affects_expense
     FROM md_event_types WHERE is_active = 1 ORDER BY code`
  ).all()
  return c.json({ success: true, data: results })
})

// Endpoint: list transaction types
postingSetup.get('/transaction-types', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, code, name, module_name FROM md_transaction_types WHERE is_active = 1 ORDER BY code`
  ).all()
  return c.json({ success: true, data: results })
})
```

---

#### 2.3 تحديث الـ Posting Engine (Version 2)

**ملف:** `src/lib/posting_engine_v2.ts` (جديد — احتفظ بـ v1)

```typescript
/**
 * Posting Engine V2 — Multi-Dimensional Cascade with Validity
 * 
 * Improvements over V1:
 * - Valid From/To support
 * - Warehouse dimension
 * - Priority-based cascade instead of step-based
 * - Currency conversion built-in
 * - Event type validation
 */

import type { D1Database } from '@cloudflare/workers-types'
import { PostingRuleV2, JournalLineV2, AccountRole } from '../types/posting'

// ... extensive implementation ...
// (مفصلة في الملف الفعلي)

export async function resolveGeneralSetupV2(
  db: D1Database,
  company_id: number,
  bpg_code: string | null,
  ppg_code: string | null,
  wh_id?: number | null,
  effective_date?: string,  // NEW: for valid_from/to check
): Promise<{ rule: PostingRuleV2; step: number } | null> {
  const effDate = effective_date || new Date().toISOString().split('T')[0]
  
  // Cascade with priority:
  // 1. BPG + PPG + WH (priority_index = 1)
  // 2. BPG + PPG + NULL (priority_index = 2)
  // 3. BPG + NULL + NULL (priority_index = 3)
  // 4. NULL + NULL + NULL (priority_index = 4)
  
  for (let priority = 1; priority <= 4; priority++) {
    let query = `
      SELECT * FROM posting_rules
      WHERE company_id = ?
      AND rule_type = 'general'
      AND priority_index = ?
      AND is_active = 1
    `
    const binds: unknown[] = [company_id, priority]
    
    // Add date validity check
    query += ` AND (valid_from IS NULL OR valid_from <= ?)
              AND (valid_to IS NULL OR valid_to >= ?)`
    binds.push(effDate, effDate)
    
    // Match dimensions based on priority
    if (priority === 1) {
      query += ` AND bus_posting_group_code = ? AND prod_posting_group_code = ? AND wh_id = ?`
      binds.push(bpg_code, ppg_code, wh_id)
    } else if (priority === 2) {
      query += ` AND bus_posting_group_code = ? AND prod_posting_group_code = ? AND wh_id IS NULL`
      binds.push(bpg_code, ppg_code)
    } else if (priority === 3) {
      query += ` AND bus_posting_group_code = ? AND prod_posting_group_code IS NULL AND wh_id IS NULL`
      binds.push(bpg_code)
    } else {
      query += ` AND bus_posting_group_code IS NULL AND prod_posting_group_code IS NULL AND wh_id IS NULL`
    }
    
    query += ` ORDER BY id ASC LIMIT 1`
    
    const rule = await db.prepare(query).bind(...binds).first<PostingRuleV2>()
    if (rule) return { rule, step: priority }
  }
  
  return null
}
```

---

#### 2.4 تحديث الـ Frontend: UI للمادات والوحدات

**ملف:** `web/src/pages/gl/MasterDataPage.tsx` (جديد)

```typescript
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import Modal from '../../components/ui/Modal'
import { glApi } from '../../api/client'

export default function MasterDataPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'material-groups' | 'business-units'>('material-groups')
  
  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Tab Navigation */}
      <div className="flex border-b bg-white">
        {['material-groups', 'business-units'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t as any)}
            className={`px-6 py-3 font-semibold text-[13px] ${
              tab === t
                ? 'border-b-2 border-[#0F2D5C] text-[#0F2D5C]'
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            {t === 'material-groups' ? 'مجموعات المواد' : 'وحدات الأعمال'}
          </button>
        ))}
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {tab === 'material-groups' && <MaterialGroupsTab />}
        {tab === 'business-units' && <BusinessUnitsTab />}
      </div>
    </div>
  )
}

function MaterialGroupsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['material-groups'],
    queryFn: () => glApi.materialGroups(),
  })
  
  return (
    <div>
      {/* List implementation */}
    </div>
  )
}

function BusinessUnitsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['business-units'],
    queryFn: () => glApi.businessUnits(),
  })
  
  return (
    <div>
      {/* List implementation */}
    </div>
  )
}
```

---

### Deliverable من Phase 2

- [ ] Migration 0053 و 0054 تطبقت
- [ ] Exchange rates جدول مملوء (ولو مؤقتاً بـ 1:1)
- [ ] posting_engine_v2.ts مكتوب وmigrated من v1
- [ ] API endpoints جديدة: /event-types, /transaction-types, /material-groups, /business-units
- [ ] Tests تمر على السيناريوهات الأساسية
- [ ] UI جديدة للماستر داتا

**وقت الاختبار:** 
```
1. Create a material group
2. Create a business unit
3. Post a journal entry with business_unit_id
4. Simulate multi-currency transaction
```

---

## Phase 3: Account Roles (أسابيع 7-8) — اختياري

⚠️ **هذي Phase يحتاج قرار استراتيجي:**
- إذا احتاجت المشاركة flexibility في ربط الحسابات بالأدوار: اعملها
- إذا كان النظام الحالي بـ columns ثابتة كافي: اتركها للـ Phase Future

### المهام (إذا قررت تفعيلها)

#### 3.1 Refactor posting_rules → Account Role Mapping

**ملف Migration:** `0055_account_role_mapping.sql`

```sql
-- جدول جديد: تعريض الحسابات للأدوار
CREATE TABLE IF NOT EXISTS posting_rule_account_mappings (
  id INTEGER PRIMARY KEY,
  posting_rule_id INTEGER NOT NULL,
  account_role_id INTEGER NOT NULL,
  account_code TEXT NOT NULL,
  is_mandatory INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  
  UNIQUE(posting_rule_id, account_role_id),
  FOREIGN KEY(posting_rule_id) REFERENCES posting_rules(id),
  FOREIGN KEY(account_role_id) REFERENCES md_account_roles(id),
  FOREIGN KEY(account_code) REFERENCES chart_of_accounts(code)
);
CREATE INDEX idx_pram_rule ON posting_rule_account_mappings(posting_rule_id);
CREATE INDEX idx_pram_role ON posting_rule_account_mappings(account_role_id);

-- Backfill من الأعمدة القديمة
INSERT INTO posting_rule_account_mappings (
  posting_rule_id, account_role_id, account_code, is_mandatory
)
SELECT 
  pr.id,
  (SELECT id FROM md_account_roles WHERE code = 'SALES'),
  pr.sales_account,
  1
FROM posting_rules pr WHERE rule_type = 'general' AND pr.sales_account IS NOT NULL;

-- (كرر لكل account role...)

-- Drop الأعمدة القديمة (بعد verification)
-- ALTER TABLE posting_rules DROP COLUMN sales_account;
-- ALTER TABLE posting_rules DROP COLUMN purchases_account;
-- ... (بحذر!)
```

#### 3.2 تحديث الـ Engine للـ Role-based Resolution

```typescript
export async function resolveAccountByRole(
  db: D1Database,
  posting_rule_id: number,
  account_role_id: number,
): Promise<string | null> {
  const mapping = await db
    .prepare(`
      SELECT account_code FROM posting_rule_account_mappings
      WHERE posting_rule_id = ? AND account_role_id = ?
      LIMIT 1
    `)
    .bind(posting_rule_id, account_role_id)
    .first<{ account_code: string }>()
  
  return mapping?.account_code ?? null
}
```

---

### ملاحظة على Phase 3

هذي Phase **تكسر التوافقية كليّاً** مع V1. تحتاج:
- ✅ إعادة كتابة 50% من الـ Engine
- ✅ Migration اللجميع البيانات الموجودة
- ✅ 1-2 أسابيع اختبار شاملة
- ✅ قرار: هل تستحق المرونة الإضافية؟

**توصيتي:** للمشاريع الزراعية، Columns ثابتة (Phase 1-2) كافية. Phase 3 أكثر للمصانع والشركات الضخمة.

---

## Phase 4: اختبار شامل (أسبوع 9)

### Test Cases

```
# 1. Backward Compatibility
- تطبيق V2 Engine مع البيانات القديمة (NULL validity dates)
- النتيجة: نفس الحسابات كـ V1

# 2. Multi-Currency
- Create journal entry: 1000 USD → 16000 EGP (rate = 16)
- Verify amount_in_base_currency = 16000
- Verify currency_code = 'USD'

# 3. Business Unit Tracking
- Create journal entry مع business_unit_id = 2 (Farm Operations)
- Query P&L by business unit
- تحقق: الأرقام صح لكل وحدة

# 4. Validity Dates
- Add posting rule valid_from = 2026-06-01
- Try posting transaction dated 2026-05-15
- تحقق: engine رفع القاعدة، استخدم default rule

# 5. Event Type Validation
- Create harvest event مع event_type = 'HARVEST_RECEIPT'
- Verify metadata يسجل affected flags (inventory, revenue)

# 6. Material Group Assignment
- Assign SEED items to material_group = 'SEEDS'
- Post supplier invoice لـ SEED
- تحقق: انتخب الحساب الصح بناء على مجموعة المادة

# 7. Warehouse Dimension
- Create posting rule: BPG=AGRI-OP, PPG=BEET, WH=WH-MAIN
- Post inventory movement
- تحقق: استخدم القاعدة الـ warehouse-specific

# 8. Currency Revaluation
- Hold foreign currency AR
- Run monthly revaluation
- تحقق: created journal entry لـ unrealized gain/loss
```

### Test Output Report

**ملف:** `POSTING_ENGINE_TEST_RESULTS.md`

```markdown
# نتائج الاختبارات: بوستينج انجين V2

| Test Case | Status | Notes |
|-----------|--------|-------|
| BC: V1 Rules with NULL validity | ✅ PASS | Same output as V1 |
| MC: USD→EGP conversion | ✅ PASS | 1000 USD = 16000 EGP |
| BU: Tracking by business unit | ✅ PASS | P&L segregated |
| ...
```

---

## Phase 5: القطع (Cutover) — إنتاج فقط

### قبل القطع (بـ 1 أسبوع)

- [ ] Dry-run كامل على بيانات إنتاج (في بيئة staging)
- [ ] Verify كل قيد مولد في الإنتاج الحالي يطلع نفس النتيجة في V2
- [ ] Backup كامل
- [ ] Rollback plan جاهز (حفظ نسخة من القديم)

### يوم القطع

```bash
# 1. Backup
wrangler d1 execute agri-nile-flow --remote --file=backup_pre_cutover.sql

# 2. Apply all migrations in order
wrangler d1 execute agri-nile-flow --remote --file=migrations/0051_*.sql
wrangler d1 execute agri-nile-flow --remote --file=migrations/0052_*.sql
wrangler d1 execute agri-nile-flow --remote --file=migrations/0053_*.sql
wrangler d1 execute agri-nile-flow --remote --file=migrations/0054_*.sql

# 3. Deploy new backend (posting_engine_v2)
npm run backend:deploy:prod

# 4. Verify
npm run test:posting-engine

# 5. Monitor logs
wrangler tail
```

### بعد القطع (24 ساعة)

- [ ] Monitor كل معاملة جديدة
- [ ] تحقق من الأرقام على FS (Revenue, COGS, AP, AR)
- [ ] تفتيش عشوائي على 10-20 قيد

---

## ملخص المراحل

| Phase | الهدف | المدة | الخطر | الـ Deliverables |
|-------|------|------|------|--|
| **0** | Prep & Assessment | 1 week | صفر | Backup, Branch, Data Count |
| **1** | Schema Basics | 2 weeks | منخفض جداً | Migrations 0051-0052, Types, API v1 |
| **2** | Multi-Currency & Events | 3 weeks | منخفض | Migrations 0053-0054, Engine V2, UI Master Data |
| **3** | Account Roles | 2 weeks | متوسط | Migration 0055, Role-based Engine | 
| **4** | Testing | 1 week | عالي | Test Suite, QA Report |
| **5** | Cutover | 1 day | عالي | Go-Live, Monitoring |

**الإجمالي:** 8-10 أسابيع (مع Phase 3)  
**بدون Phase 3:** 5-6 أسابيع

---

## Risk Mitigation

### السيناريوهات الخطرة

| سيناريو | الاحتمال | التأثير | الحل |
|--------|---------|--------|-----|
| Migration syntax error في D1 | منخفض | عالي | Pre-test على backup DB |
| Foreign key violations | متوسط | عالي | Backfill بحذر مع checks |
| Type mismatch في TS | منخفض | متوسط | Compile before deploy |
| Performance degradation | منخفض | متوسط | Add indexes في Phase 1 |

### Rollback Plan

إذا حصلت مشكلة قاتلة:

```bash
# Restore من backup (الحفظة الأولى)
wrangler d1 execute agri-nile-flow --remote --file=backup_pre_cutover.sql

# Deploy الـ old backend
git checkout main -- src/
npm run backend:deploy:prod
```

---

## Success Criteria

✅ الـ Engine جديد يطبع نفس الحسابات كـ القديم (Parity)  
✅ Multi-currency support فعّال  
✅ Business Units يظهر بشكل منفصل في الـ Reports  
✅ أداء: < 100ms لكل transaction  
✅ Audit trail جاهز (GL_JOURNAL_AUDIT)  
✅ Zero production incidents بعد 24 ساعة

---

## التوثيق المطلوبة

- [ ] Schema Diagram (old vs new)
- [ ] API Documentation (v2 endpoints)
- [ ] Migration Runbook
- [ ] Testing Evidence
- [ ] Rollback Procedures
- [ ] Training Material (للـ Finance Team)

---

**آخر تحديث:** 1 مايو 2026  
**المالك:** Agri-Nile Flow Development Team
