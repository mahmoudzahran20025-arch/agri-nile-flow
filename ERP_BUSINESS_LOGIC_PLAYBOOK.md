# دليل منطق الأعمال المتكامل (ERP Business Logic Playbook)
## شركة نواة المستقبل — تطبيق Nawa AgroLedger

**التاريخ:** 2026-04-21  
**الغرض:** تحويل التطبيق من مجموعة شاشات منفصلة إلى نظام ERP علائقي متكامل، بحيث تنتقل كل حركة تشغيلية (مخزن/خزينة/مورد/مصروف حقل) تلقائياً إلى قيد يومية مزدوج القيد وتنعكس مباشرة على شجرة الحسابات، الأرصدة، القوائم المالية، والتقارير.

---

## 1. المبدأ الأساسي: «القيد المزدوج هو قلب النظام»

في أي ERP ناجح، يجب أن تطبَّق القاعدة التالية **بلا استثناء**:

> **كل حركة تشغيلية في أي نظام فرعي (subsystem) تُنتج قيد يومية واحداً على الأقل، والقيد يجب أن يكون متوازناً (Σ DR = Σ CR)، ولا يُسمح بأي حركة تُخَزَّن في قاعدة البيانات دون أن تُنشئ القيد المقابل في نفس الـ Transaction.**

### 1.1 سلسلة التدفق الصحيحة

```
[شاشة إدخال المستخدم]
        │
        ▼
[Validation Layer]  ← يفحص البيانات قبل الحفظ (§5)
        │
        ▼
[Subsystem Table]   ← تخزين الحركة التشغيلية (inventory_movements, supplier_transactions, cash_transactions)
        │
        ▼ (نفس الـ DB Transaction)
[Posting Engine]    ← يقرأ إعدادات الربط من جدول account_mapping
        │
        ▼
[gl_vouchers]       ← رأس القسيمة
        │
        ▼
[gl_entries]        ← سطور المدين والدائن (متوازنة)
        │
        ▼
[Views & Reports]   ← v_trial_balance, v_supplier_balance, v_item_stock, v_cash_position
```

### 1.2 لماذا تطبيقك الحالي فيه مشاكل؟

بناءً على الشاشات التي أرسلتها:
- **شاشة حركات المخزون فارغة** رغم أن ملفاتك Excel بها 700 حركة — لم يحدث الترحيل بعد.
- **شاشة "تكلفة الفدان" تظهر 0** لكل حقل — هذا لأنه لا يوجد جدول يربط حركات المخزون بمركز التكلفة (الحقل/البيفوت) ليجمّعها.
- **شاشة "الإيرادات والمصروفات" كلها أصفار** — شجرة الحسابات موجودة، لكن **لا يوجد Posting Engine** يغذيها من الحركات.
- **شاشة "تقادم الذمم الدائنة" فارغة** — بينما الشاشة الأخرى (التي فيها بيانات) تحسب الأعمار من قيود مختلفة، مما يدل على عدم وجود مصدر بيانات موحد.

**السبب الجذري:** النظام مبني كـ "جزر منفصلة" (Data Silos) بدلاً من "نظام موحد بقيد مزدوج".

---

## 2. شجرة الحسابات المقترحة (Chart of Accounts) — متوافقة مع النشاط الزراعي

### 2.1 البنية الهرمية الخماسية (5 مستويات)

```
Level 1 (Class)       → 1 رقم    — الأصل/الخصم/حقوق ملكية/إيراد/مصروف
Level 2 (Group)       → 2 رقم    — أصول متداولة، ثابتة...
Level 3 (Sub-group)   → 3 رقم    — النقدية، المخزون...
Level 4 (Account)     → 4 رقم    — البنك الأهلي، مخزون أسمدة...
Level 5 (Sub-account) → 5+ رقم   — حسابات تفصيلية لكل مورد/حقل
```

### 2.2 دليل الحسابات التفصيلي

| الكود | الاسم | النوع | Normal Balance | ملاحظة |
|---:|---|---|---|---|
| **1** | **الأصول (Assets)** | Header | DR | |
| 11 | الأصول المتداولة | Header | DR | |
| 111 | النقدية وما في حكمها | Header | DR | |
| 1110 | الصندوق الرئيسي | Asset | DR | **حساب الخزينة** — مربوط بالـ cash_transactions |
| 1111 | الصندوق الفرعي (قطع غيار) | Asset | DR | |
| 1120 | البنك — الأهلي المصري | Asset | DR | |
| 112 | المدينون والمصروفات المقدمة | Header | DR | |
| 1121 | العملاء المحليون (control) | Asset | DR | يفتح تحته sub-account لكل عميل |
| 1122 | مقدمات موردين | Asset | DR | |
| 113 | المخزون (Inventory Control) | Header | DR | |
| 1131 | مخزون أسمدة | Asset | DR | **مربوط بـ warehouse='اسمدة'** |
| 1132 | مخزون مبيدات | Asset | DR | warehouse='مبيدات' |
| 1133 | مخزون تقاوي وبذور | Asset | DR | warehouse='تقاوي وبذور' |
| 1134 | مخزون شبكات ري | Asset | DR | warehouse='شبكات ري' |
| 1135 | مخزون قطع غيار | Asset | DR | warehouse='قطع غيار' |
| 12 | الأصول الثابتة | Header | DR | |
| 1210 | أراضي زراعية | Asset | DR | |
| 1220 | آلات ومعدات | Asset | DR | |
| 1221 | مجمع إهلاك الآلات والمعدات | Contra-Asset | CR | |
| 1230 | شبكات ري (أصل ثابت) | Asset | DR | |
| 1240 | مباني ومنشآت | Asset | DR | |
| **2** | **الخصوم (Liabilities)** | Header | CR | |
| 21 | الخصوم المتداولة | Header | CR | |
| 2110 | الموردون المحليون (control) | Liability | CR | **Control account** — يفتح تحته sub للكل مورد |
| 2111 | موردون — منتجات زراعية | Liability | CR | تقسيم فرعي |
| 2112 | موردون — آلات ومعدات | Liability | CR | |
| 2113 | موردون — متنوعات | Liability | CR | |
| 2114 | موردون — عمالة | Liability | CR | |
| 2120 | شيكات برسم الدفع | Liability | CR | |
| 2130 | مرتبات وأجور مستحقة | Liability | CR | |
| 2140 | ضرائب مستحقة | Liability | CR | |
| **3** | **حقوق الملكية (Equity)** | Header | CR | |
| 3110 | رأس المال المدفوع | Equity | CR | **مربوط بـ partners.capital_paid** |
| 3120 | جاري الشركاء | Equity | CR | partners.current_acct |
| 3130 | أرباح محتجزة | Equity | CR | تُقفل فيها صافي الربح آخر الموسم |
| **4** | **الإيرادات (Revenues)** | Header | CR | |
| 4110 | إيرادات القمح | Revenue | CR | |
| 4120 | إيرادات الذرة | Revenue | CR | |
| 4130 | إيرادات الأرز | Revenue | CR | |
| 4140 | **إيرادات بنجر السكر** | Revenue | CR | المحصول الأساسي |
| 4190 | إيرادات محاصيل أخرى | Revenue | CR | |
| 4210 | إيرادات متنوعة | Revenue | CR | |
| **5** | **المصروفات (Expenses)** | Header | DR | |
| 51 | تكاليف إنتاج مباشرة | Header | DR | |
| 5110 | تكلفة الأسمدة والمبيدات | Expense | DR | **مربوطة بصرف مخازن الأسمدة** |
| 5120 | تكلفة البذور والمستلزمات | Expense | DR | |
| 5130 | تكلفة الري | Expense | DR | |
| 5140 | تكلفة الحصاد | Expense | DR | |
| 5150 | تكلفة الميكنة والمعدات | Expense | DR | |
| 5160 | إيجار آلات ومعدات | Expense | DR | |
| 52 | تكاليف عمالة | Header | DR | |
| 5210 | أجور العمال اليومية | Expense | DR | |
| 5220 | مرتبات الموظفين الثابتة | Expense | DR | |
| 5230 | مكافآت وحوافز | Expense | DR | |
| 53 | تكاليف تشغيلية | Header | DR | |
| 5310 | إيجار الأراضي الزراعية | Expense | DR | |
| 5320 | نقل ونولون | Expense | DR | |
| 5330 | إشراف زراعي | Expense | DR | |
| 54 | مصروفات إدارية وعمومية | Header | DR | |
| 5410 | مصروفات إدارية وعمومية | Expense | DR | |
| 5420 | اهتلاك الأصول الثابتة | Expense | DR | |
| 5430 | مصروفات متنوعة | Expense | DR | |

### 2.3 قواعد ذهبية للشجرة

1. **Header accounts لا تستقبل قيوداً مباشرة** — فقط Level 4+ هي postable.
2. **Control Accounts** (2110 موردون) يُمنع الإدخال المباشر عليها — التعامل يكون عبر الـ sub-accounts (حساب كل مورد منفرد).
3. **كل حساب له Normal Balance** — الزيادة دائماً بالجهة الطبيعية؛ العكس يعني تصحيح.

---

## 3. جدول ربط الحسابات (Account Mapping) — حجر الزاوية

هذا هو الجدول الذي يفتقده تطبيقك حالياً. أضفه في قاعدة البيانات فوراً:

```sql
CREATE TABLE account_mapping (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL,
  mapping_key         TEXT    NOT NULL,   -- معرف القاعدة
  description         TEXT,
  dr_account_code     BIGINT  NOT NULL REFERENCES accounts(code),
  cr_account_code     BIGINT  NOT NULL REFERENCES accounts(code),
  is_active           INTEGER NOT NULL DEFAULT 1,
  effective_from      DATE    NOT NULL,
  UNIQUE (company_id, mapping_key, effective_from)
);
```

### 3.1 قواعد الربط الإلزامية (Seed Data)

| mapping_key | الوصف | DR | CR |
|---|---|---:|---:|
| `INV_RECEIPT_FERTILIZER` | استلام أسمدة من مورد بالآجل | 1131 | 2111 |
| `INV_RECEIPT_PESTICIDE` | استلام مبيدات | 1132 | 2111 |
| `INV_RECEIPT_SEEDS` | استلام تقاوي | 1133 | 2111 |
| `INV_RECEIPT_IRRIGATION` | استلام شبكات ري (أصل/مستهلك) | 1134 | 2111 |
| `INV_RECEIPT_SPARES` | استلام قطع غيار | 1135 | 2112 |
| `INV_ISSUE_FERTILIZER` | صرف أسمدة لحقل | 5110 | 1131 |
| `INV_ISSUE_PESTICIDE` | صرف مبيدات | 5110 | 1132 |
| `INV_ISSUE_SEEDS` | صرف تقاوي | 5120 | 1133 |
| `INV_ISSUE_SPARES` | صرف قطع غيار | 5150 | 1135 |
| `CASH_PAYMENT_SUPPLIER` | دفع نقدي لمورد | 2110/sub | 1110 |
| `CASH_PAYMENT_LABOR` | دفع أجور عمالة يومية | 5210 | 1110 |
| `CASH_PAYMENT_MACHINE_RENT` | دفع إيجار ميكنة | 5160 | 1110 |
| `CASH_RECEIPT_PARTNER` | مساهمة شريك نقداً | 1110 | 3120 |
| `CASH_RECEIPT_SALES` | بيع نقدي لمحصول | 1110 | 4140 |
| `AP_BILL_SUPERVISION` | فاتورة إشراف زراعي | 5330 | 2110/sub |
| `AP_BILL_TRANSPORT` | فاتورة نقل | 5320 | 2110/sub |
| `AP_PAYMENT` | سداد مستحق لمورد | 2110/sub | 1110 |
| `AR_INVOICE_CROP` | فاتورة بيع محصول لعميل | 1121/sub | 4140 |
| `AR_RECEIPT` | تحصيل من عميل | 1110 | 1121/sub |

### 3.2 كيف يستخدمها الـ Posting Engine

```javascript
// pseudocode
function post(movement) {
  const key = resolveMappingKey(movement);      // حدد القاعدة حسب warehouse+type
  const rule = await db.get(
    "SELECT dr_account_code, cr_account_code FROM account_mapping WHERE mapping_key=?",
    [key]
  );
  if (!rule) throw new Error(`No mapping rule for ${key} — configure in Settings > Account Linking`);
  
  const voucher = await db.insert("gl_vouchers", {
    voucher_no: generateNo(),
    voucher_date: movement.date,
    source_module: movement.module,    // 'INV' | 'CASH' | 'AP'
    source_ref_id: movement.id,
    narration: movement.narration
  });
  
  await db.insert("gl_entries", [
    { voucher_id: voucher.id, account_code: rule.dr_account_code, debit: movement.amount,  credit: 0,               supplier_code: movement.supplier_code, center_code: movement.center_code },
    { voucher_id: voucher.id, account_code: rule.cr_account_code, debit: 0,                credit: movement.amount, supplier_code: movement.supplier_code, center_code: movement.center_code }
  ]);
}
```

**القاعدة الحرجة:** كل من التوابع `insert movement`, `insert voucher`, `insert entries` يجب أن تكون داخل **نفس الـ DB Transaction** (`BEGIN ... COMMIT`). فشل أي منها يعمل `ROLLBACK`.

---

## 4. مواصفة كل وحدة (Subsystem) — ماذا يحدث عند كل إجراء

### 4.1 شاشة «حركات المخزون» (Inventory Movement)

**الحقول الإلزامية:**
- التاريخ ≥ بداية الفترة المفتوحة و ≤ تاريخ اليوم
- المخزن (من القائمة المقيدة: اسمدة/مبيدات/تقاوي/شبكات ري/قطع غيار)
- النوع: اضافة / صرف
- الصنف (من جدول items — يجب أن يكون موجوداً)
- الكمية > 0
- الوحدة (مطابقة لـ items.unit)

**إذا النوع = اضافة:**
- إلزامي: كود المورد (FK → suppliers)
- إلزامي: سعر الوحدة > 0
- قيمة الوارد = الكمية × السعر
- Posting: `INV_RECEIPT_<category>` → DR مخزون / CR موردون

**إذا النوع = صرف:**
- إلزامي: مركز التكلفة (البيفوت/الحقل)
- سعر الوحدة = آخر متوسط مرجح (computed, not entered)
- قيمة المنصرف = الكمية × المتوسط
- Posting: `INV_ISSUE_<category>` → DR مصروف مركز التكلفة / CR مخزون

**Validations قبل الحفظ:**
1. `صرف` لا يُسمح به إذا الرصيد المتاح < الكمية المطلوبة (منع الرصيد السالب)
2. الصنف يجب أن يكون نوع المخزن يطابق التصنيف (سماد لا يُصرف من مخزن المبيدات)
3. لو `صرف` لبيفوت، يجب أن يكون البيفوت في حالة `نشط` للموسم الحالي

### 4.2 شاشة «الخزينة» (Cash/Treasury)

**كل سند قبض أو صرف → حركة في cash_transactions + قيد يومية**

**حالة ت = د (قبض):**
- DR: 1110 الصندوق
- CR: حساب المصدر (حسب expense_code / supplier_code):
  - إذا مساهمة شريك → CR: 3120 جاري الشركاء (sub = اسم الشريك)
  - إذا تحصيل من عميل → CR: 1121/sub
  - إذا بيع نقدي → CR: 4140 (إيرادات بنجر السكر)

**حالة ت = م (صرف):**
- CR: 1110 الصندوق
- DR: حساب الطرف المستلم:
  - إذا دفعة لمورد → DR: 2110/sub
  - إذا أجور عمال → DR: 5210
  - إذا مصروف مباشر → DR: حسب expense_type mapping

**Validation:**
- الرصيد النقدي بعد الصرف ≥ 0 (منع السحب على المكشوف إلا بإذن)
- المستلم/المسلم إلزامي

### 4.3 شاشة «الموردون والعملاء» (AP/AR)

**إصدار فاتورة مورد (د):**
- DR: حساب المصروف/المخزون المناسب
- CR: 2110/sub (حساب المورد)

**سداد مورد (م):**
- DR: 2110/sub
- CR: 1110 (صندوق) أو 1120 (بنك)
- إذا بشيك → CR: 2120 شيكات برسم الدفع (حتى يتم الصرف ثم يُحوَّل من 2120 إلى 1110)

**Validation:**
- المورد يجب أن يكون نشطاً (is_active=1)
- المبلغ > 0
- رقم المستند غير مكرر لنفس المورد في نفس اليوم

### 4.4 شاشة «الشركاء» (Partners)

كل مساهمة → قيد:
- DR: 1110 صندوق
- CR: 3120 جاري الشركاء (sub = اسم الشريك)

كل سحب شريك → قيد عكسي.

### 4.5 شاشة «تكلفة الفدان» — الآن نفهم لماذا كانت صفراً

**المعادلة:**
```
تكلفة الفدان =
      (Σ قيمة المنصرف من المخازن WHERE center_code = الحقل)
    + (Σ cash_transactions WHERE center_code = الحقل AND direction='م')
    + (Σ supplier_transactions WHERE center_code = الحقل)
    ─────────────────────────────────────────
              مساحة الفدان
```

هذا يعمل **فقط** إذا كل حركة مخزن/خزينة/مورد تحمل `center_code` صحيح. المشكلة في ملفاتك أن 55–95 % من `center_code` فارغة أو `#N/A` — لذلك تكلفة الفدان = 0.

**الحل:** اجعل `center_code` حقلاً إلزامياً (NOT NULL) في جميع شاشات الإدخال التي تمس مصروفاً، مع قائمة منسدلة محمّلة من `cost_centers` النشطة للموسم الحالي.

---

## 5. طبقة التحقق (Validation Layer) — منع الأخطاء قبل الحدوث

### 5.1 Global Validations (تطبّق على كل الشاشات)

| القاعدة | التطبيق |
|---|---|
| `transaction_date` ≠ NULL | Database constraint `NOT NULL` + UI date picker |
| `transaction_date` ضمن فترة مفتوحة | `EXISTS (SELECT 1 FROM accounting_periods WHERE ... AND is_closed=0)` |
| `amount` > 0 | `CHECK (amount > 0)` |
| `supplier_code/item_code/center_code` موجود في المرجع | Foreign Key + dropdown يعرض الأسماء فقط |
| النص المدخل يُنظَّف | `TRIM()` + `REPLACE(multi-spaces, single)` قبل الحفظ |
| الرقم الإنجليزي أو العربي يُقبل | تحويل `٠١٢٣٤٥٦٧٨٩` → `0123456789` في frontend |
| المستندات لا تتكرر | `UNIQUE (company_id, document_type, document_number, transaction_date)` |

### 5.2 Business-Rule Validations

| الحالة | القاعدة |
|---|---|
| صرف مخزون بكمية > الرصيد | ارفض مع رسالة "الرصيد المتاح 5 كجم — لا يمكن صرف 10" |
| إغلاق موسم قبل مطابقة | ارفض إذا ميزان المراجعة غير متوازن |
| قيد بتاريخ سابق للفترة المقفلة | ارفض — يتم استخدام "قيد تسوية" في الفترة المفتوحة |
| مساهمة شريك بدون اسم شريك | ارفض مع رسالة واضحة |
| صنف نشط + مخزن مطابق | dropdown الصنف يعرض فقط أصناف المخزن المختار |

### 5.3 قالب رسالة خطأ موحّد

كل validation failure يجب أن يُرجِع:
```json
{
  "success": false,
  "error_code": "INV_INSUFFICIENT_STOCK",
  "message": "الرصيد المتاح من 'سلفات النشادر محبب' في مخزن الأسمدة هو 200 كجم فقط",
  "field": "quantity",
  "max_allowed": 200
}
```

---

## 6. إدارة الفترات المحاسبية (Period Control)

### 6.1 جدول الفترات

```sql
CREATE TABLE accounting_periods (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL,
  year        INTEGER NOT NULL,
  month       INTEGER NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  is_closed   INTEGER NOT NULL DEFAULT 0,
  closed_at   TEXT,
  closed_by   INTEGER REFERENCES users(id),
  UNIQUE (company_id, year, month)
);
```

### 6.2 قواعد الإقفال

1. لا يُقفل الشهر إلا بعد:
   - `v_trial_balance` متوازن (Σ DR = Σ CR ± 0.01)
   - لا توجد قيود `pending_review`
   - لا توجد حركات بتاريخ أكبر من `end_date` في هذا الشهر
2. عند إقفال شهر → لا يُسمح بأي INSERT/UPDATE/DELETE على قيود تاريخها ضمنه
3. لإغلاق موسم كامل → ترحيل صافي الربح من 4xxx و 5xxx إلى 3130 (أرباح محتجزة)

### 6.3 Closing Journal Entries (قيود الإقفال)

```sql
-- 1) إقفال الإيرادات (أرصدتها CR) في حساب النتيجة
INSERT INTO gl_entries (..., account_code, debit, credit) VALUES
  (..., 4140, balance_of_4140, 0),            -- عكس الإيراد
  (..., 9999_income_summary, 0, balance_of_4140);

-- 2) إقفال المصروفات (أرصدتها DR)
INSERT INTO gl_entries VALUES
  (..., 9999_income_summary, balance_of_expenses, 0),
  (..., 5110, 0, balance_of_5110), ...;

-- 3) ترحيل الصافي إلى أرباح محتجزة
INSERT INTO gl_entries VALUES
  (..., 9999_income_summary, net_income_dr, 0),
  (..., 3130, 0, net_income_cr);
```

---

## 7. تدفقات العمل الكاملة (End-to-End Workflows)

### 7.1 سيناريو: شراء أسمدة من مورد بالآجل ثم صرفها لحقل

1. **شاشة الموردين → فاتورة شراء**  
   المستخدم يدخل: المورد=شركة عرفة، الصنف=سلفات نشادر، كمية=1000، سعر=50، القيمة=50,000
   - INSERT into `supplier_transactions_clean`
   - POST: DR 1131 (مخزون أسمدة) 50,000 / CR 2110/عرفة 50,000

2. **شاشة حركات المخزون → إضافة**  
   تلقائياً من الفاتورة: السنة=2026، الشهر=4، المخزن=اسمدة، النوع=اضافة
   - INSERT into `inventory_movements_clean` (qty_in=1000, value_in=50000)
   - (لا قيد جديد — القيد سُجّل في الخطوة 1)

3. **شاشة حركات المخزون → صرف**  
   المستخدم: الصنف=سلفات نشادر، مركز التكلفة=بيفوت 718، كمية=200
   - النظام يحسب: متوسط سعر = 50، قيمة المنصرف = 10,000
   - INSERT `inventory_movements_clean` (qty_out=200, value_out=10000, center_code=1006001)
   - POST: DR 5110 (تكلفة أسمدة)/بيفوت 718 — 10,000 / CR 1131 — 10,000

4. **شاشة الخزينة → صرف دفعة**  
   دفع 30,000 للشركة نقداً
   - INSERT `cash_transactions_clean` (direction='م', supplier=عرفة, amount=30000)
   - POST: DR 2110/عرفة 30,000 / CR 1110 — 30,000

5. **شاشة تكلفة الفدان تلقائياً تعرض:**  
   بيفوت 718 (55 فدان) = 10,000 ج.م ÷ 55 = 181.82 ج.م/فدان

6. **شاشة ميزان الموردين:**  
   شركة عرفة = 50,000 (مدين) − 30,000 (دائن) = **20,000 ج.م مستحق لها**

### 7.2 سيناريو: بيع محصول بنجر نقداً

1. **شاشة الخزينة → سند قبض**  
   من: عميل النقدي، البيان: بيع 100 طن بنجر، المبلغ: 500,000
   - POST: DR 1110 — 500,000 / CR 4140 (إيرادات بنجر) — 500,000

2. **شاشة الإيرادات والمصروفات تعكس فوراً:**  
   إيرادات بنجر السكر (4140) = 500,000

---

## 8. قائمة مراجعة التنفيذ (Implementation Checklist)

ضع كل بند في TODO list في الكود:

### Phase 1: البنية التحتية المحاسبية
- [ ] إنشاء جدول `accounts` وتحميله من §2.2
- [ ] إنشاء جدول `account_mapping` وتحميل قواعد §3.1
- [ ] إنشاء جدول `accounting_periods` وفتح الفترات 2025-11 إلى 2026-12
- [ ] إنشاء `gl_vouchers` + `gl_entries` مع CHECK constraint (debit=0 XOR credit=0)
- [ ] إنشاء 4 Views: `v_trial_balance`, `v_supplier_balance`, `v_item_stock`, `v_cash_position`

### Phase 2: Posting Engine
- [ ] دالة `resolveMappingKey(movement)` تحدد القاعدة الصحيحة حسب `warehouse + type`
- [ ] دالة `postVoucher(movement)` تنشئ قسيمة + سطرين على الأقل داخل Transaction واحد
- [ ] Trigger/Hook بعد كل INSERT في `cash_transactions`, `supplier_transactions`, `inventory_movements` يستدعي `postVoucher`
- [ ] Assertion: كل voucher balanced → فحص شهري أوتوماتيكي

### Phase 3: Validation Layer
- [ ] Validation service مشترك للثلاث شاشات (نفس قواعد §5)
- [ ] دالة تنظيف (trim + unify Arabic digits + collapse spaces) قبل INSERT
- [ ] فحص الرصيد قبل صرف المخزون
- [ ] فحص الفترة المحاسبية مفتوحة
- [ ] رسائل خطأ موحّدة بلغة المستخدم (عربي)

### Phase 4: ترحيل البيانات التاريخية
- [ ] ترحيل الملفات الثلاثة Excel باستخدام `ledger_migration.sql` + `migration_manifest.json`
- [ ] توليد gl_vouchers تاريخية لكل حركة مرحّلة
- [ ] تشغيل assertion التوازن وتأكيد تطابق أرصدة الشاشات مع شيتات Excel الأصلية

### Phase 5: تحسينات UX
- [ ] dropdown ديناميكي: اختيار المخزن يفلتر الأصناف
- [ ] dropdown: مركز التكلفة يعرض فقط البيفوتات النشطة للموسم
- [ ] عرض الرصيد الحالي تحت حقل الكمية في شاشة الصرف
- [ ] تحذير بصري عند إدخال تاريخ مستقبلي أو في فترة مقفلة
- [ ] شاشة Settings → Account Linking تسمح للمستخدم بتعديل قواعد §3.1

### Phase 6: التقارير المرئية
- [ ] تقرير تكلفة الفدان يعيد القراءة من `v_field_cost` (View جديد)
- [ ] تقرير أعمار الذمم يقرأ من `v_supplier_balance` مع aging buckets
- [ ] تقرير الأرباح والخسائر يقرأ من `v_pnl` (View جديد)
- [ ] الإشعارات: لو رصيد صنف < reorder_threshold → alert

---

## 9. جدول الأخطاء الشائعة ومنعها

| الخطأ | السبب | المنع |
|---|---|---|
| حركة مخزون بدون مركز تكلفة | UI يسمح بحقل فارغ | `NOT NULL` + dropdown إلزامي |
| قيد غير متوازن | Posting Engine يكتب صف واحد | CHECK constraint + Transaction atomic |
| مورد مكرر باسمين | إدخال يدوي بدون FK | قائمة منسدلة تمنع الإدخال الحر |
| رصيد سالب في المخزون | السماح بالصرف قبل الفحص | validation قبل INSERT |
| شهر مقفل ثم تعديل قيد | لا يوجد is_closed check | Trigger يمنع UPDATE/DELETE |
| أرقام عربية في DB | قبول `٢٠٠٠` كنص | تحويل في frontend قبل الإرسال |
| تاريخ مستقبلي | date picker بلا حد أقصى | `max={today}` في input |
| شيك مدفوع لكن الرصيد لم يتأثر | لا يوجد تمييز بين 2120 و1110 | Posting rule منفصل للشيكات |

---

## 10. نصيحة ختامية

**لا تحاول ترحيل كل شيء دفعة واحدة.** الترتيب الأمثل:

1. **ابنِ الإنفراستركشر المحاسبي أولاً** (Phase 1 + 2) — اليوم الأول والثاني.
2. **اختبر على 10 قيود تجريبية يدوية** — تأكد أن المبدأ مزدوج القيد يعمل.
3. **أضف Validation Layer** (Phase 3) — يوم ثالث.
4. **رحّل البيانات التاريخية من Excel** (Phase 4) — يوم رابع.
5. **وازن ميزان المراجعة مقابل Excel** — لا تنتقل لأي خطوة إضافية قبل تطابق الأرقام.
6. **شغّل التقارير** — ستعمل كلها تلقائياً لأنها مجرد SELECT من Views.

عند الانتهاء من Phase 1 + 2، أرسل لي:
- أول قيد من `gl_vouchers` + `gl_entries` ليُفحص
- نتيجة `SELECT * FROM v_trial_balance`

وسأعطيك مراجعة سطر بسطر قبل أن تبدأ في الترحيل الحقيقي.

---

## 11. الملفات المصاحبة

| الملف | الغرض |
|---|---|
| `DATA_QUALITY_MIGRATION_REPORT.md` | تحليل ملفات Excel (تم) |
| `migration_manifest.json` | خريطة الأعمدة للترحيل (تم) |
| `ledger_migration.sql` | DDL جداول Staging + Clean + GL (تم) |
| `ERP_BUSINESS_LOGIC_PLAYBOOK.md` | **هذا الدليل** — قواعد العمل المتكاملة |

عند مشاركة أي خطأ في الإدخال، اربطه برقم القسم من هذا الدليل (مثل "المشكلة مرتبطة بـ §4.1 validation" أو "قاعدة ربط §3.1 ناقصة") وسأحدد السبب الجذري فوراً.
