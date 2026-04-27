# 📋 استراتيجية إدخال البيانات - نواة المستقبل 2025-2026

## 🎯 الهدف
تحويل البيانات من Excel إلى نظام Agri-Nile Flow المتكامل مع ضمان:
- ✅ التكامل الكامل بين جميع الموديولات
- ✅ تفعيل الـ GL Posting Engine بشكل صحيح
- ✅ الحفاظ على Data Integrity
- ✅ إمكانية التتبع والمراجعة (Audit Trail)

---

## 📊 تحليل البيانات الموجودة

### 1️⃣ **شجرة الحسابات** (`شجرة نواة المستقبل.xlsx`)
- **عدد الحسابات**: 347 حساب
- **الهيكل**: 
  - Level 1: الأصول الثابتة (1)
  - Level 2: الأصول الثابتة (11)
  - Level 3: أراضي (1101), مباني (1102), آلات ومعدات (1103), تجهيزات (1104)
  - Level 4: حسابات تفصيلية (11010001, 11020001, ...)

### 2️⃣ **الموردين والعملاء** (`الموردين والعملاء نواة المستقبل2025-2026.xlsx`)
- **عدد الموردين/العملاء**: 29 كيان
- **عدد المعاملات**: 15,565 معاملة
- **الشيتات**:
  - `الكود`: بيانات الموردين الأساسية
  - `البيان`: المعاملات التفصيلية
  - `أرصدة الموردين`: الأرصدة الافتتاحية
  - `كشف حساب مفصل/مجمل`: تقارير

### 3️⃣ **المخازن** (`مخازن نواة المستقبل2025-2026.xlsx`)
- **عدد الأصناف**: 4,839 صنف
- **عدد الحركات**: 10,569 حركة
- **الشيتات**:
  - `الكود`: بيانات الأصناف
  - `البيانات`: حركات الإضافة والصرف
  - `أرصدة المخازن`: الأرصدة الحالية
  - `بطاقة صنف`: تقارير الأصناف

### 4️⃣ **الخزينة** (`خزينة نواة المستقبل 2025-2026.xlsx`)
- **عدد الحركات**: 19,915 حركة
- **الشيتات**:
  - `البيان`: حركات الاستلام والصرف
  - `الأكواد`: أكواد الحسابات المرتبطة
  - `اجمالي الموردين`: ملخص الدفعات

---

## 🏗️ الخطة الاستراتيجية لإدخال البيانات

### **المرحلة 0: التحضير والإعداد** ⚙️

#### 0.1 مراجعة النظام الحالي
```bash
# تشغيل integrity check
node check_gl_integrity.js

# مراجعة الـ posting engine status
# يجب أن يكون posting_engine = 0
```

#### 0.2 عمل Backup كامل
```bash
# Backup للـ D1 database
wrangler d1 backup agri-nile-db --local

# Backup للملفات
cp -r . ../agri-nile-flow-backup-$(date +%Y%m%d)
```

#### 0.3 تنظيف البيانات الديمو (اختياري)
```sql
-- إذا قررت حذف البيانات الديمو، استخدم:
-- TRUNCATE جميع الجداول ما عدا:
-- - gl_accounts (شجرة الحسابات)
-- - gl_periods (الفترات المالية)
-- - system_config (الإعدادات)
```

---

### **المرحلة 1: إعداد البنية التحتية** 🏛️

#### 1.1 إنشاء/تحديث شجرة الحسابات
```javascript
// استيراد شجرة الحسابات من Excel
// الملف: شجرة نواة المستقبل (1).xlsx
// الشيت: final

const accounts = [
  { code: '1', name: 'الأصول', type: 'asset', parent: null },
  { code: '11', name: 'الأصول الثابتة', type: 'asset', parent: '1' },
  { code: '1101', name: 'أراضي', type: 'asset', parent: '11' },
  // ... إلخ
];

// API Call
for (const account of accounts) {
  await glApi.createAccount(account);
}
```

**✅ Checkpoint**: تأكد من وجود جميع الحسابات في `/gl/accounts`

#### 1.2 إعداد الفترات المالية
```javascript
// إنشاء الفترات المالية لسنة 2025-2026
const periods = [
  { name: 'يناير 2025', start_date: '2025-01-01', end_date: '2025-01-31' },
  { name: 'فبراير 2025', start_date: '2025-02-01', end_date: '2025-02-28' },
  // ... باقي الشهور
];

for (const period of periods) {
  await glApi.createPeriod(period);
}
```

#### 1.3 إعداد Posting Groups (Phase 4)
```javascript
// Business Posting Groups
const businessGroups = [
  { code: 'DOMESTIC', name: 'موردين محليين', type: 'business' },
  { code: 'EXPORT', name: 'عملاء تصدير', type: 'business' },
  { code: 'INTERNAL', name: 'عمليات داخلية', type: 'business' },
];

// Product Posting Groups
const productGroups = [
  { code: 'FERT', name: 'أسمدة', type: 'product' },
  { code: 'SEED', name: 'بذور', type: 'product' },
  { code: 'CHEM', name: 'مبيدات', type: 'product' },
  { code: 'EQUIP', name: 'معدات', type: 'product' },
];

// Inventory Posting Groups
const inventoryGroups = [
  { code: 'FERT-WH', name: 'مخزن أسمدة', type: 'inventory' },
  { code: 'SEED-WH', name: 'مخزن بذور', type: 'inventory' },
  { code: 'MAIN-WH', name: 'المخزن الرئيسي', type: 'inventory' },
];

// إنشاء المجموعات
for (const group of [...businessGroups, ...productGroups, ...inventoryGroups]) {
  await glApi.createPostingGroup(group.type, group);
}
```

#### 1.4 إعداد General Posting Setup
```javascript
// ربط Business × Product بالحسابات
const generalSetup = [
  {
    bus_posting_group_code: 'DOMESTIC',
    prod_posting_group_code: 'FERT',
    sales_account: '4001',           // إيرادات مبيعات أسمدة
    purchases_account: '5001',       // مشتريات أسمدة
    cogs_account: '5101',            // تكلفة البضاعة المباعة
    sales_returns_account: '4101',   // مردودات مبيعات
    purch_returns_account: '5201',   // مردودات مشتريات
  },
  // ... باقي التركيبات
];

for (const setup of generalSetup) {
  await glApi.createGeneralSetup(setup);
}
```

#### 1.5 إعداد Inventory Posting Setup
```javascript
// ربط Inventory × Product بالحسابات
const inventorySetup = [
  {
    inv_posting_group_code: 'FERT-WH',
    prod_posting_group_code: 'FERT',
    inventory_account: '1301',  // مخزون أسمدة
  },
  // ... باقي التركيبات
];

for (const setup of inventorySetup) {
  await glApi.createInventorySetup(setup);
}
```

**✅ Checkpoint**: تشغيل `/gl/posting-setup/health` والتأكد من `is_ready: true`

---

### **المرحلة 2: إدخال البيانات الأساسية (Master Data)** 📇

#### 2.1 إدخال الموردين والعملاء
```javascript
// من ملف: الموردين والعملاء نواة المستقبل2025-2026.xlsx
// الشيت: الكود

const suppliers = [
  {
    code: '20300086',
    name: 'عيد شعبان-لودر',
    type: 'supplier',
    activity: 'موردين آلات ومعدات',
    bus_posting_group: 'DOMESTIC',  // ← ربط بالـ posting group
    gl_account: '3001',             // موردون محليون
  },
  {
    code: '20900151',
    name: 'جهاز مستقبل مصر للتنمية المستدامة',
    type: 'customer',
    activity: 'موردين منتجات زراعية',
    bus_posting_group: 'EXPORT',
    gl_account: '3002',             // عملاء محليون
  },
  // ... باقي الموردين (29 مورد)
];

for (const supplier of suppliers) {
  await api.post('/suppliers', supplier);
}
```

#### 2.2 إدخال الأصناف
```javascript
// من ملف: مخازن نواة المستقبل2025-2026.xlsx
// الشيت: الكود

const items = [
  {
    code: 'FERT-001',
    name: 'حمض فسفوريك',
    unit: 'كجم',
    category: 'أسمدة',
    prod_posting_group: 'FERT',     // ← ربط بالـ posting group
    inv_posting_group: 'FERT-WH',   // ← ربط بالـ posting group
  },
  {
    code: 'FERT-002',
    name: 'حمض كبرتيك',
    unit: 'كجم',
    category: 'أسمدة',
    prod_posting_group: 'FERT',
    inv_posting_group: 'FERT-WH',
  },
  // ... باقي الأصناف (4,839 صنف)
];

for (const item of items) {
  await api.post('/items', item);
}
```

#### 2.3 إدخال المخازن
```javascript
const warehouses = [
  {
    code: 'WH-FERT',
    name: 'مخزن الأسمدة',
    location: 'البرج الأول',
    inv_posting_group: 'FERT-WH',   // ← ربط بالـ posting group
  },
  {
    code: 'WH-SEED',
    name: 'مخزن البذور',
    location: 'البرج الثاني',
    inv_posting_group: 'SEED-WH',
  },
  // ... باقي المخازن
];

for (const warehouse of warehouses) {
  await api.post('/warehouses', warehouse);
}
```

**✅ Checkpoint**: مراجعة البيانات الأساسية في الـ UI

---

### **المرحلة 3: إدخال الأرصدة الافتتاحية** 💰

#### 3.1 أرصدة الموردين
```javascript
// من ملف: الموردين والعملاء نواة المستقبل2025-2026.xlsx
// الشيت: أرصدة الموردين

const openingBalances = [
  {
    supplier_code: '20300086',
    opening_balance: 150000,  // مدين أو دائن
    date: '2025-01-01',
  },
  // ... باقي الأرصدة
];

// إنشاء قيد افتتاحي في GL
const openingEntry = {
  date: '2025-01-01',
  description: 'أرصدة افتتاحية - موردين',
  ref_type: 'opening',
  lines: [
    { account_code: '3001', debit: 0, credit: 150000, description: 'عيد شعبان-لودر' },
    { account_code: '1101', debit: 150000, credit: 0, description: 'رصيد افتتاحي' },
  ],
};

await glApi.createEntry(openingEntry);
```

#### 3.2 أرصدة المخازن
```javascript
// من ملف: مخازن نواة المستقبل2025-2026.xlsx
// الشيت: أرصدة المخازن

const inventoryBalances = [
  {
    item_code: 'FERT-001',
    warehouse_code: 'WH-FERT',
    quantity: 7475,
    unit_cost: 50,  // سعر التكلفة
    total_value: 373750,
  },
  // ... باقي الأرصدة
];

// إنشاء قيد افتتاحي للمخزون
const invOpeningEntry = {
  date: '2025-01-01',
  description: 'أرصدة افتتاحية - مخزون',
  ref_type: 'opening',
  lines: [
    { account_code: '1301', debit: 373750, credit: 0, description: 'مخزون أسمدة' },
    { account_code: '3999', debit: 0, credit: 373750, description: 'رأس المال' },
  ],
};

await glApi.createEntry(invOpeningEntry);
```

**✅ Checkpoint**: مراجعة Trial Balance والتأكد من التوازن

---

### **المرحلة 4: تفعيل Posting Engine** 🚀

#### 4.1 التحقق من الجاهزية
```javascript
const health = await glApi.postingHealth();

console.log(health);
// Expected output:
// {
//   is_ready: true,
//   groups: { business_posting_groups: 3, product_posting_groups: 4, ... },
//   setup: { general_rows: 12, inventory_rows: 12, ... },
//   issues: [],
//   warnings: []
// }
```

#### 4.2 اختبار الـ Validation
```javascript
// اختبار قيد مشتريات
const testValidation = await glApi.validatePosting({
  type: 'supplier_invoice',
  bpg_code: 'DOMESTIC',
  ppg_code: 'FERT',
  ap_code: '3001',
  amount: 10000,
});

console.log(testValidation);
// Expected:
// {
//   lines: [
//     { account_code: '5001', debit: 10000, credit: 0 },
//     { account_code: '3001', debit: 0, credit: 10000 }
//   ],
//   validationErrors: [],
//   isBlocked: false
// }
```

#### 4.3 تفعيل الـ Engine
```sql
-- في D1 Database
UPDATE system_config 
SET config_value = '1' 
WHERE config_key = 'posting_engine';
```

**✅ Checkpoint**: إنشاء معاملة تجريبية والتأكد من إنشاء القيود تلقائياً

---

### **المرحلة 5: إدخال المعاملات التاريخية** 📜

#### 5.1 معاملات الموردين
```javascript
// من ملف: الموردين والعملاء نواة المستقبل2025-2026.xlsx
// الشيت: البيان
// عدد المعاملات: 15,565

// استراتيجية الإدخال:
// 1. تجميع المعاملات حسب النوع (فواتير، دفعات، مردودات)
// 2. إدخالها بالترتيب الزمني
// 3. التحقق من التوازن بعد كل batch

const transactions = [
  {
    type: 'supplier_invoice',
    supplier_code: '20300086',
    date: '2025-01-15',
    amount: 50000,
    description: 'فاتورة مشتريات معدات',
    items: [
      { item_code: 'EQUIP-001', quantity: 1, unit_price: 50000 }
    ]
  },
  // ... باقي المعاملات
];

// إدخال على دفعات (batches)
const BATCH_SIZE = 100;
for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
  const batch = transactions.slice(i, i + BATCH_SIZE);
  
  for (const txn of batch) {
    await api.post('/supplier-invoices', txn);
    // الـ posting engine سيُنشئ القيود تلقائياً
  }
  
  // Checkpoint بعد كل batch
  const integrity = await glApi.integrityCheck();
  if (!integrity.overall_ok) {
    console.error('Integrity check failed!', integrity);
    break;
  }
}
```

#### 5.2 حركات المخزن
```javascript
// من ملف: مخازن نواة المستقبل2025-2026.xlsx
// الشيت: البيانات
// عدد الحركات: 10,569

const inventoryMovements = [
  {
    type: 'in',  // إضافة
    item_code: 'FERT-001',
    warehouse_code: 'WH-FERT',
    quantity: 100,
    unit_cost: 50,
    date: '2025-01-20',
    reference: 'PO-001',
  },
  {
    type: 'out',  // صرف
    item_code: 'FERT-001',
    warehouse_code: 'WH-FERT',
    quantity: 50,
    date: '2025-01-25',
    reference: 'SO-001',
  },
  // ... باقي الحركات
];

for (const movement of inventoryMovements) {
  await api.post('/inventory/movements', movement);
  // الـ posting engine سيُنشئ القيود تلقائياً
}
```

#### 5.3 حركات الخزينة
```javascript
// من ملف: خزينة نواة المستقبل 2025-2026.xlsx
// الشيت: البيان
// عدد الحركات: 19,915

const cashMovements = [
  {
    type: 'receipt',  // استلام
    amount: 25000,
    date: '2025-01-22',
    from: 'customer',
    customer_code: '20900151',
    description: 'تحصيل من عميل',
  },
  {
    type: 'payment',  // صرف
    amount: 30000,
    date: '2025-01-23',
    to: 'supplier',
    supplier_code: '20300086',
    description: 'دفعة لمورد',
  },
  // ... باقي الحركات
];

for (const movement of cashMovements) {
  await api.post('/cash/movements', movement);
  // الـ posting engine سيُنشئ القيود تلقائياً
}
```

**✅ Checkpoint**: بعد كل مرحلة، تشغيل:
```javascript
const integrity = await glApi.integrityCheck();
const trialBalance = await glApi.trialBalance();
```

---

### **المرحلة 6: التحقق والمراجعة** ✅

#### 6.1 Integrity Checks
```javascript
const checks = await glApi.integrityCheck();

// يجب أن تكون جميع الـ checks = OK
console.log(checks);
// {
//   overall_ok: true,
//   has_blockers: false,
//   checks: [
//     { key: 'unbalanced_entries', ok: true, count: 0 },
//     { key: 'orphan_lines', ok: true, count: 0 },
//     { key: 'ghost_mappings', ok: true, count: 0 },
//     ...
//   ]
// }
```

#### 6.2 مقارنة الأرصدة
```javascript
// مقارنة أرصدة Excel مع النظام
const excelBalances = {
  'موردون محليون': 1500000,
  'مخزون أسمدة': 2500000,
  'خزينة': 500000,
};

const systemBalances = await glApi.trialBalance();

// مقارنة يدوية أو آلية
for (const [account, balance] of Object.entries(excelBalances)) {
  const systemAccount = systemBalances.find(a => a.name === account);
  const diff = Math.abs(systemAccount.balance - balance);
  
  if (diff > 0.01) {  // tolerance
    console.error(`Mismatch in ${account}: Excel=${balance}, System=${systemAccount.balance}`);
  }
}
```

#### 6.3 مراجعة التقارير
```bash
# Trial Balance
GET /gl/trial-balance?start=2025-01-01&end=2025-12-31

# Income Statement
GET /gl/income-statement?start=2025-01-01&end=2025-12-31

# Balance Sheet
GET /gl/balance-sheet?as_of=2025-12-31
```

---

## 🔄 استراتيجية الـ Migration

### الخيار 1: Big Bang (دفعة واحدة)
**المميزات**:
- ✅ سريع
- ✅ بسيط

**العيوب**:
- ❌ خطر عالي
- ❌ صعوبة التراجع

**متى تستخدمه**: إذا كانت البيانات نظيفة ومُختبرة جيداً

### الخيار 2: Phased Migration (على مراحل) ⭐ **مُوصى به**
**المميزات**:
- ✅ خطر منخفض
- ✅ إمكانية التراجع
- ✅ اختبار تدريجي

**العيوب**:
- ❌ يأخذ وقت أطول

**الخطة**:
1. **Week 1**: Master Data (موردين، أصناف، مخازن)
2. **Week 2**: Opening Balances + Testing
3. **Week 3**: Historical Transactions (Q1 2025)
4. **Week 4**: Historical Transactions (Q2-Q4 2025)
5. **Week 5**: Validation & Go-Live

### الخيار 3: Parallel Run (تشغيل موازي)
**المميزات**:
- ✅ أقصى درجات الأمان
- ✅ مقارنة مباشرة

**العيوب**:
- ❌ جهد مضاعف

**الخطة**:
- تشغيل النظام القديم (Excel) والجديد (Agri-Nile) معاً لمدة شهر
- مقارنة النتائج يومياً
- التحول الكامل بعد التأكد من التطابق

---

## 🛠️ الأدوات المطلوبة

### 1. Data Migration Scripts
```javascript
// scripts/migrate_suppliers.js
// scripts/migrate_items.js
// scripts/migrate_inventory.js
// scripts/migrate_cash.js
// scripts/migrate_transactions.js
```

### 2. Validation Scripts
```javascript
// scripts/validate_balances.js
// scripts/compare_excel_vs_system.js
// scripts/integrity_check.js
```

### 3. Rollback Scripts
```sql
-- scripts/rollback.sql
-- حذف جميع البيانات المُدخلة والعودة للحالة الأولية
```

---

## ⚠️ المخاطر والتحديات

### 1. Data Quality Issues
**المشكلة**: بيانات غير نظيفة في Excel
**الحل**: 
- تنظيف البيانات قبل الإدخال
- استخدام validation rules
- مراجعة يدوية للبيانات الحرجة

### 2. Posting Group Mapping
**المشكلة**: صعوبة تحديد الـ posting groups المناسبة
**الحل**:
- إنشاء mapping table
- مراجعة مع المحاسب
- اختبار على عينة صغيرة أولاً

### 3. Performance Issues
**المشكلة**: بطء في إدخال 45,000+ معاملة
**الحل**:
- Batch processing
- استخدام transactions
- تعطيل الـ indexes مؤقتاً أثناء الإدخال

### 4. Integrity Violations
**المشكلة**: قيود غير متوازنة أو orphan records
**الحل**:
- Checkpoint بعد كل batch
- Rollback فوري عند اكتشاف مشكلة
- Detailed logging

---

## 📝 Checklist النهائي

### قبل البدء
- [ ] Backup كامل للنظام
- [ ] مراجعة GL Module Documentation
- [ ] تجهيز Posting Groups
- [ ] اختبار على بيئة تجريبية

### أثناء الإدخال
- [ ] إدخال Master Data
- [ ] إدخال Opening Balances
- [ ] تفعيل Posting Engine
- [ ] إدخال Transactions (batches)
- [ ] Integrity Check بعد كل batch

### بعد الانتهاء
- [ ] Full Integrity Check
- [ ] Trial Balance Validation
- [ ] مقارنة مع Excel
- [ ] مراجعة التقارير
- [ ] User Acceptance Testing
- [ ] Go-Live!

---

## 🎯 التوصية النهائية

**الخطة المُوصى بها**:

1. **استخدم Phased Migration** (على مراحل)
2. **ابدأ بـ Master Data** (موردين، أصناف، مخازن)
3. **اختبر Posting Engine** على عينة صغيرة (10-20 معاملة)
4. **أدخل Opening Balances** وتأكد من التوازن
5. **أدخل Transactions** على دفعات (100-500 معاملة/batch)
6. **Checkpoint** بعد كل batch
7. **Rollback فوري** عند أي مشكلة
8. **Full Validation** في النهاية

**المدة المتوقعة**: 3-4 أسابيع

**الجهد المطلوب**: 
- Developer: 2-3 أيام (كتابة السكريبتات)
- Data Entry: 1-2 أسبوع (إدخال البيانات)
- Testing & Validation: 1 أسبوع

---

## 📞 الخطوات التالية

1. **مراجعة هذه الوثيقة** مع الفريق
2. **تحديد الـ Posting Groups** المناسبة
3. **كتابة Migration Scripts**
4. **اختبار على بيئة تجريبية**
5. **البدء في الإدخال**

---

**تم إعداد هذه الوثيقة بواسطة**: Kiro AI  
**التاريخ**: 27 أبريل 2026  
**الإصدار**: 1.0
