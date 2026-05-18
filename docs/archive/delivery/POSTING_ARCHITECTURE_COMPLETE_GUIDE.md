# البوستينج والحركات المخزنية — دليل العمارة الكامل

**تاريخ التحديث:** May 11, 2026  
**الحالة:** جاهز للإنتاج  
**المسؤول:** Financial Module + Inventory Integration  

---

## 📊 مسار تحويل الحركات المخزنية إلى قيود محاسبية

```
┌─────────────────────────────────────────────────────────────────┐
│                     OPERATIONAL LAYER                           │
│  (حيث تبدأ البيانات من المستخدم النهائي)                       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  1. inventory_movements (حركات المخزن)                          │
│  ───────────────────────                                        │
│  عند إضافة حركة مخزنية:                                        │
│  - movement_date: تاريخ الحركة                                 │
│  - warehouse: المخزن                                           │
│  - item_code: كود الصنف                                        │
│  - quantity: الكمية                                            │
│  - movement_type: "اضافة" أو "صرف"                            │
│  - service_type_code: نوع الخدمة (اختياري في القديم)          │
│  - statement_text: وصف الحركة                                 │
│  - status: 'draft' أو 'posted'                                │
└─────────────────────────────────────────────────────────────────┘
                            ↓
                    API Validation
                    (src/api/inventory.ts)
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  2. business_events (أحداث الأعمال)                             │
│  ─────────────────                                              │
│  عند نجاح الحركة، ننشئ حدث:                                   │
│  - event_type: نوع الحدث (INVENTORY_MOVEMENT)                 │
│  - source_module: 'inventory'                                  │
│  - source_id: ID من inventory_movements                        │
│  - status: 'pending' → 'posted'                                │
│  - journal_entry_id: يربط للقيد المحاسبي                       │
└─────────────────────────────────────────────────────────────────┘
                            ↓
              Posting Engine (execute_posting_job.js)
            ينفذ القواعد المحاسبية (posting_rules)
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  3. journal_entries + journal_entry_lines (القيود المحاسبية)  │
│  ────────────────────────────────────────────────────────────   │
│  journal_entries:                                              │
│  - id: معرف القيد                                             │
│  - entry_date: تاريخ القيد                                    │
│  - description: وصف (من statement_text)                       │
│  - ref_type: نوع المرجع (INVENTORY)                           │
│  - ref_id: معرف الحركة                                       │
│  - is_posted: 0 = draft, 1 = posted                           │
│                                                                │
│  journal_entry_lines (خطوط القيد):                             │
│  - account_code: الحساب المحاسبي                             │
│  - debit/credit: جهة المبلغ                                   │
│  - center_code: مركز التكلفة                                 │
│  - source_ledger: 'inventory'                                │
│  - source_record_id: معرف الحركة المخزنية                    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  4. GL Accounts (الميزانية والدخل)                             │
│  ──────────────────────────                                     │
│  النتيجة النهائية: أرصدة الحسابات تعكس الحركات                │
│  - Inventory Account: 1407                                     │
│  - Accounts Payable: 2120                                      │
│  - Expense Account: 5101                                       │
│  - COGS Account: 4201                                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🗂️ الجداول الرئيسية والأعمدة

### 1. **inventory_movements** (حركات المخزن)
**المسار:** `migrations/0085_phase4_transaction_headers.sql`

```sql
CREATE TABLE inventory_movements (
  -- معرفات أساسية
  id                    INTEGER PRIMARY KEY,
  company_id            INTEGER NOT NULL,
  transaction_id        INTEGER REFERENCES inventory_transactions(id),
  
  -- البيانات الأساسية
  movement_date         TEXT NOT NULL,        -- تاريخ الحركة
  warehouse             TEXT NOT NULL,        -- المخزن (اسمدة، مبيدات، إلخ)
  movement_type         TEXT NOT NULL,        -- "اضافة" أو "صرف"
  
  -- الربط مع البيانات الرئيسية
  item_code             INTEGER NOT NULL,     -- FK → items
  supplier_code         INTEGER,              -- FK → suppliers (اختياري)
  center_code           INTEGER,              -- FK → cost_centers
  field_id              INTEGER,              -- FK → fields
  season_id             INTEGER,              -- FK → seasons
  work_order_id         INTEGER,              -- FK → work_orders
  
  -- الكميات والأسعار
  quantity              REAL NOT NULL,        -- الكمية
  unit_price            REAL,                 -- السعر للوحدة
  qty_in                REAL NOT NULL,        -- كمية المدخل
  qty_out               REAL NOT NULL,        -- كمية المخرج
  balance_qty           REAL,                 -- الرصيد (محسوب)
  
  -- القيم
  value_in              REAL NOT NULL,        -- قيمة المدخل
  value_out             REAL NOT NULL,        -- قيمة المخرج
  balance_value         REAL,                 -- الرصيد (محسوب)
  
  -- البيانات الحديثة (Phase 2/3)
  service_type_code     TEXT,                 -- SRV_MECH, SRV_LABOR, SRV_SUPPLY, إلخ
  statement_text        TEXT,                 -- وصف محاسبي (للقيد)
  
  -- التتبع
  document_number       INTEGER,              -- رقم الوثيقة
  notes                 TEXT,                 -- ملاحظات
  year                  INTEGER,              -- السنة
  month                 INTEGER,              -- الشهر
  
  -- الحالة
  status                TEXT,                 -- 'draft' أو 'posted'
  gl_posting_status     TEXT,                 -- 'pending', 'posted', 'error'
  gl_posted_at          TEXT,                 -- متى تم البوستينج
  gl_posting_error      TEXT,                 -- رسالة الخطأ إن وجدت
  
  -- المصدر
  created_by_user_id    INTEGER,
  created_at            TEXT,
  
  UNIQUE(company_id, id)
);

-- الفهارس الرئيسية
CREATE INDEX idx_inv_mov_company_date 
  ON inventory_movements(company_id, movement_date DESC);
CREATE INDEX idx_inv_mov_warehouse 
  ON inventory_movements(company_id, warehouse);
CREATE INDEX idx_inv_mov_status 
  ON inventory_movements(company_id, status);
CREATE INDEX idx_inv_mov_item 
  ON inventory_movements(company_id, item_code);
```

**الأعمدة الحيوية:**
- ✅ `warehouse`: يحدد حساب المخزون (اسمدة → 1407.01، مبيدات → 1407.02)
- ✅ `service_type_code`: يحدد حساب المصروف عند الصرف
- ✅ `statement_text`: وصف القيد المحاسبي
- ✅ `center_code`: مركز التكلفة (المحاسبة الإدارية)

---

### 2. **business_events** (أحداث الأعمال)
**المسار:** `migrations/0048_unified_posting_rules_and_business_events.sql`

```sql
CREATE TABLE business_events (
  id                  INTEGER PRIMARY KEY,
  company_id          INTEGER NOT NULL,
  
  -- تعريف الحدث
  event_type          TEXT NOT NULL,        -- INVENTORY_MOVEMENT, SUPPLIER_INVOICE, إلخ
  event_date          TEXT NOT NULL,        -- تاريخ الحدث
  
  -- الربط مع مصدر الحدث
  source_module       TEXT NOT NULL,        -- 'inventory', 'supplier', 'cash'
  source_id           INTEGER NOT NULL,     -- معرف الحركة الأصلية
  
  -- البيانات المرسلة
  payload             TEXT NOT NULL,        -- JSON بكل بيانات الحدث
  
  -- الحالة
  status              TEXT NOT NULL,        -- 'pending', 'posted', 'error', 'reversed'
  error_message       TEXT,                 -- رسالة الخطأ
  
  -- الربط مع القيد
  journal_entry_id    INTEGER REFERENCES journal_entries(id),
  
  -- التتبع
  posted_by           INTEGER,
  posted_at           TEXT,
  created_at          TEXT,
  
  UNIQUE(company_id, source_module, source_id, event_type)
);

-- الفهارس
CREATE INDEX idx_business_events_status 
  ON business_events(company_id, status, event_date);
CREATE INDEX idx_business_events_source 
  ON business_events(company_id, source_module, source_id);
```

**الدور:**
- جسر بين العمليات والمحاسبة
- تحديد ما إذا كانت الحركة تحتاج قيد محاسبي
- ربط الحركة الأصلية بالقيد النهائي

---

### 3. **journal_entries + journal_entry_lines** (القيود)
**المسار:** `migrations/007_sprint3_gl_links.sql`

```sql
CREATE TABLE journal_entries (
  id              INTEGER PRIMARY KEY,
  company_id      INTEGER NOT NULL,
  
  entry_date      TEXT NOT NULL,           -- تاريخ القيد
  description     TEXT,                    -- الوصف
  
  -- الربط مع المصادر
  ref_type        TEXT,                    -- 'INVENTORY', 'SUPPLIER', 'CASH'
  ref_id          INTEGER,                 -- معرف الحركة الأصلية
  
  -- الحالة
  is_posted       INTEGER DEFAULT 0,       -- 0=draft, 1=posted
  posted_at       TEXT,
  
  created_by_user_id INTEGER,
  created_at      TEXT
);

CREATE TABLE journal_entry_lines (
  id              INTEGER PRIMARY KEY,
  entry_id        INTEGER REFERENCES journal_entries(id),
  company_id      INTEGER NOT NULL,
  
  account_code    TEXT NOT NULL,           -- الحساب المحاسبي
  debit           REAL DEFAULT 0,          -- جهة المدين
  credit          REAL DEFAULT 0,          -- جهة الدائن
  
  -- البيانات التحليلية (Dimensions)
  center_code     INTEGER,                 -- مركز التكلفة
  season_id       INTEGER,                 -- الموسم
  field_id        INTEGER,                 -- الحقل
  
  -- البيانات الجديدة (Phase 1 Traceability)
  source_ledger   TEXT,                    -- 'inventory', 'supplier', 'cash', إلخ
  source_record_id INTEGER,                -- معرف الحركة الأصلية
  
  description     TEXT,
  created_at      TEXT
);

-- الفهارس
CREATE INDEX idx_jel_account 
  ON journal_entry_lines(company_id, account_code);
CREATE INDEX idx_jel_center 
  ON journal_entry_lines(company_id, center_code);
CREATE INDEX idx_jel_source 
  ON journal_entry_lines(company_id, source_ledger, source_record_id);
```

---

### 4. **posting_rules** (قواعس البوستينج)
**المسار:** `migrations/0048_unified_posting_rules_and_business_events.sql`

```sql
CREATE TABLE posting_rules (
  id                    INTEGER PRIMARY KEY,
  company_id            INTEGER NOT NULL,
  rule_type             TEXT NOT NULL,      -- 'general', 'inventory', 'control'
  
  -- أبعاد التوجيه (Dimensions)
  bus_posting_group     TEXT,               -- Business Posting Group (supplier type)
  prod_posting_group    TEXT,               -- Product Posting Group
  inv_posting_group     TEXT,               -- Inventory Posting Group
  
  -- أحادية الربط (للتحويلات التلقائية)
  mapping_key           TEXT,               -- 'cash', 'inventory', 'ap', إلخ
  account_code          TEXT,               -- الحساب المستهدف
  
  -- الفتحات المحاسبية
  inventory_account     TEXT,               -- حساب المخزون
  sales_account         TEXT,               -- حساب المبيعات
  cogs_account          TEXT,               -- حساب تكلفة المبيعات
  expense_account       TEXT,               -- حساب المصروف
  
  priority              INTEGER DEFAULT 100,
  is_active             INTEGER DEFAULT 1,
  created_at            TEXT,
  updated_at            TEXT
);

-- مثال على قاعدة:
-- warehouse='اسمدة' → inventory_account='14070101'
-- warehouse='مبيدات' → inventory_account='14070102'
-- service_type='SRV_MECH' → expense_account='51010301'
```

---

## 🔀 مسار تحويل الحركات إلى قيود (Step-by-Step)

### مثال عملي: إضافة 100 كيلو أسمدة يوريا

#### الخطوة 1: الحركة الأولية
```javascript
// من واجهة المستخدم: POST /api/inventory/movements
{
  movement_date: "2026-05-11",
  warehouse: "اسمدة",              // يحدد الحساب المحاسبي
  movement_type: "اضافة",
  item_code: 1001,
  quantity: 100,
  unit_price: 500,                 // 500 EGP للكيلو
  supplier_code: 20900151,
  service_type_code: "SRV_SUPPLY", // ← **يجب أن يكون موجود في Phase 2**
  statement_text: "شراء أسمدة يوريا من عرفة"
}
```

**النتيجة في DB:**
```sql
INSERT INTO inventory_movements (
  company_id, warehouse, movement_type, item_code, quantity, unit_price,
  qty_in, value_in, warehouse, service_type_code, statement_text, status
) VALUES (
  1, "اسمدة", "اضافة", 1001, 100, 500,
  100, 50000, "اسمدة", "SRV_SUPPLY", 
  "شراء أسمدة يوريا من عرفة",
  "draft"
);
-- Result: id = 5432
```

#### الخطوة 2: إنشاء حدث الأعمال
```sql
INSERT INTO business_events (
  company_id, event_type, event_date, source_module, source_id,
  status, payload, created_at
) VALUES (
  1, 'INVENTORY_MOVEMENT', '2026-05-11', 'inventory', 5432,
  'pending',
  '{"qty":100, "price":500, "value":50000, "warehouse":"اسمدة", ...}',
  datetime('now')
);
-- Result: business_events.id = 1245, status = 'pending'
```

#### الخطوة 3: تنفيذ البوستينج (execute_posting_job.js)
البرنامج يقرأ:
```sql
SELECT * FROM inventory_movements WHERE status='draft' AND company_id=1;
```

يحسب:
```javascript
// وارد من المخزن (إضافة)
const warehouse = "اسمدة";
const invAccount = warehouseInventoryAccount(warehouse); 
// → '14070101' (حساب الأسمدة)

const apAccount = '212010200';  // حساب دائنو عرفة (من supplier_service_map)
const value = 50000;

// ينشئ قيد:
// 14070101 (DR) 50000  | Inventory - Fertilizers
// 212010200 (CR) 50000 | AP - Arafa (Fertilizers supply)
```

#### الخطوة 4: إنشاء القيد المحاسبي
```sql
INSERT INTO journal_entries (
  company_id, entry_date, description, ref_type, ref_id, is_posted
) VALUES (
  1, '2026-05-11', 'شراء أسمدة يوريا من عرفة', 'INVENTORY', 5432, 1
);
-- Result: journal_entries.id = 8901

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, source_ledger, source_record_id) VALUES
  (8901, 1, '14070101', 50000, 0, 'inventory', 5432),  -- Inventory DR
  (8901, 1, '212010200', 0, 50000, 'inventory', 5432); -- AP CR
```

#### الخطوة 5: تحديث حالات
```sql
UPDATE inventory_movements SET status='posted', gl_posting_status='posted' WHERE id=5432;
UPDATE business_events SET status='posted', journal_entry_id=8901 WHERE id=1245;
```

#### النتيجة النهائية
- ✅ المخزن يظهر رصيد +100 كيلو يوريا
- ✅ حساب الأسمدة (1407.01) يظهر رصيد +50,000 EGP
- ✅ حساب الدائنين (2120.102) يظهر رصيد +50,000 EGP
- ✅ القيد توازن تماماً (50,000 = 50,000)
- ✅ التتبع: يمكن الرجوع من القيد → الحدث → الحركة الأصلية

---

## 📂 مسارات الملفات المهمة

### SQL Migrations
| الملف | الغرض |
|------|-------|
| [migrations/0048_unified_posting_rules_and_business_events.sql](migrations/0048_unified_posting_rules_and_business_events.sql) | قواعس البوستينج + أحداث الأعمال |
| [migrations/0085_phase4_transaction_headers.sql](migrations/0085_phase4_transaction_headers.sql) | جداول الحركات المخزنية + الرؤوس |
| [migrations/007_sprint3_gl_links.sql](migrations/007_sprint3_gl_links.sql) | ربط القيود مع المصادر |
| [migrations/0053_gl_source_tracking_schema.sql](migrations/0053_gl_source_tracking_schema.sql) | تتبع مصادر القيود |
| [migrations/0072_posting_rules_structural_fixes.sql](migrations/0072_posting_rules_structural_fixes.sql) | إصلاحات قواعس البوستينج |

### API و Backend
| المسار | الغرض |
|--------|-------|
| `src/api/inventory.ts` | API للحركات المخزنية + validation |
| `src/lib/gl.ts` | دوال البوستينج (glInventoryMovement, postEntry) |
| `scripts/execute_posting_job.js` | محرك البوستينج الرئيسي |
| `src/api/finance.ts` | APIs المالية الشاملة |

### التوثيق
| الملف | الغرض |
|------|-------|
| [README_POSTING_ENGINE_V2.md](README_POSTING_ENGINE_V2.md) | دليل محرك البوستينج V2 |
| [README_TRACEABILITY.md](README_TRACEABILITY.md) | دليل التتبع والتتبع الكامل |
| [GL_FIX_README.md](GL_FIX_README.md) | دليل إصلاح البنية المحاسبية |
| [README_PHASE_2_3_QUICK_START.md](README_PHASE_2_3_QUICK_START.md) | دليل البدء السريع للمراحل 2-3 |

---

## 🔗 العلاقات بين الجداول

```
┌──────────────────┐
│ inventory_       │
│ movements        │
│                  │
│ (الحركات الأولية)│
└────────┬─────────┘
         │ source_id
         ▼
┌──────────────────┐
│ business_events  │
│                  │
│ (جسر للقيود)     │
└────────┬─────────┘
         │ journal_entry_id
         ▼
┌──────────────────┐
│ journal_entries  │
│                  │
│ (رؤوس القيود)   │
└────────┬─────────┘
         │ entry_id
         ▼
┌──────────────────────────────┐
│ journal_entry_lines          │
│                              │
│ (خطوط القيود مع الأحساب)    │
│ - account_code               │
│ - debit/credit               │
│ - source_ledger → inventory  │
│ - source_record_id → mov.id  │
└──────────────────────────────┘
         │ account_code
         ▼
┌──────────────────────────────┐
│ chart_of_accounts            │
│                              │
│ (الحسابات المحاسبية)        │
│ - 1407 (المخزون)             │
│ - 2120 (الدائنون)            │
│ - 5101 (المصروفات)           │
└──────────────────────────────┘

┌──────────────────────────────┐
│ posting_rules                │
│                              │
│ (قواعس التوجيه الآلي)        │
│ - warehouse → inv_account    │
│ - service_type → exp_account │
└──────────────────────────────┘
```

---

## ⚙️ كيفية عمل البوستينج التلقائي

### 1. تشغيل محرك البوستينج
```bash
# يدوياً:
node scripts/execute_posting_job.js --apply

# أو تلقائياً (مخطط):
# كل يوم في 23:00 (عند إغلاق المتجر)
```

### 2. خطوات المحرك
```javascript
// 1. قراءة الحركات المخزنية التي لم يتم بوستينجها
SELECT * FROM inventory_movements 
WHERE status='draft' AND gl_posting_status IS NULL

// 2. لكل حركة، تطبيق قواعس البوستينج
for each movement {
  // حدد الحساب بناءً على warehouse
  invAccount = posting_rules
    .where(warehouse = movement.warehouse)
    .inventory_account;
  
  // حدد حساب المصروف بناءً على service_type
  expAccount = posting_rules
    .where(service_type = movement.service_type_code)
    .expense_account;
  
  // إذا كانت إضافة → Dr. Inv / Cr. AP
  // إذا كانت صرف → Dr. Exp / Cr. Inv
}

// 3. إنشاء القيود
INSERT INTO journal_entries ...

// 4. تحديث الحالات
UPDATE inventory_movements SET gl_posting_status='posted'
UPDATE business_events SET status='posted'
```

### 3. المراقبة والأخطاء
```sql
-- إذا حدث خطأ:
UPDATE inventory_movements 
SET gl_posting_status='error', gl_posting_error='...'
WHERE movement_id=X;

-- تصحيح:
UPDATE inventory_movements 
SET gl_posting_status=NULL 
WHERE movement_id=X;
-- ثم تشغيل المحرك مرة أخرى
```

---

## 📋 الجداول الحالية (May 11, 2026)

```sql
-- 1. العمليات الأساسية
✅ inventory_movements       -- حركات المخزن
✅ inventory_transactions    -- رؤوس الحركات
✅ items                     -- الأصناف
✅ suppliers                 -- الموردين
✅ cost_centers              -- مراكز التكلفة

-- 2. أحداث ومحرك البوستينج
✅ business_events           -- أحداث الأعمال
✅ posting_rules             -- قواعس البوستينج
✅ supplier_service_map      -- تعيين الموردين والخدمات
✅ service_types             -- أنواع الخدمات (Phase 2 ready)

-- 3. المحاسبة
✅ journal_entries           -- رؤوس القيود
✅ journal_entry_lines       -- خطوط القيود
✅ chart_of_accounts         -- الحسابات المحاسبية
✅ account_balances          -- أرصدة الحسابات (view)

-- 4. التتبع والتتبع
✅ posting_trace_log         -- سجل تتبع البوستينج
✅ account_classification    -- تصنيف الحسابات
✅ source_documents_bridge   -- جسر الوثائق المصدرية
```

---

## 🚀 الخطوات التالية (Phase 2 & 3)

### Phase 2: تصحيح API وإضافة أنواع الخدمات
**تاريخ البدء:** May 13, 2026

```bash
# 1. نشر Schema الخدمات
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/governance/05_phase2_service_taxonomy_and_mapping.sql

# 2. تحديث API
# - inventory.ts: إضافة service_type_code إلزامي
# - suppliers.ts: تحديث supplier_service_map
# - treasury.ts: إضافة financial_account_code

# 3. اختبار (6 سيناريوهات)
npm run test:phase2

# 4. نشر
npm run backend:deploy:prod
```

### Phase 3: مسح شامل وإعادة إدخال
**تاريخ البدء:** May 27, 2026

```bash
# 1. مسح البيانات
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/governance/04_full_clean_reseed_scope_company1.sql

# 2. إعادة إدخال البيانات الرئيسية
# - الموردين والأصناف
# - حركات المخزن (بصيغة قانونية)

# 3. تشغيل محرك البوستينج
node scripts/execute_posting_job.js --apply

# 4. التحقق من التوازن
SELECT * FROM account_balances WHERE balance != 0;
```

---

## 📞 للمزيد من المعلومات

- **دليل البوستينج V2:** [README_POSTING_ENGINE_V2.md](README_POSTING_ENGINE_V2.md)
- **دليل التتبع:** [README_TRACEABILITY.md](README_TRACEABILITY.md)
- **تفاصيل المراحل:** [README_PHASE_2_3_QUICK_START.md](README_PHASE_2_3_QUICK_START.md)
- **قائمة التنفيذ:** [EXECUTION_CHECKLIST_PHASE_2_3.md](EXECUTION_CHECKLIST_PHASE_2_3.md)

---

**آخر تحديث:** May 11, 2026  
**الحالة:** ✅ جاهز للإنتاج  
**التالي:** انتظار موافقة الفريق على Phase 2
