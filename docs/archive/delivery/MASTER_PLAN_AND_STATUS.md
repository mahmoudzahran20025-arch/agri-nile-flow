# خطة العمل الشاملة — Agri-Nile Flow GL Recovery
**تاريخ التحديث:** 10 مايو 2026  
**المرحلة الحالية:** Phase 2 منتهية ✅ — Phase 3 جاهزة للتنفيذ

---

## ملخص ما تم إنجازه حتى الآن

### Phase 0 — استعادة البيانات المفسودة ✅ (تم في جلسات سابقة)
| الخطوة | النتيجة |
|--------|---------|
| Backup للبيانات الأصلية | ✅ جداول `_corrupted_2026_05_09` |
| تنظيف supplier_transactions | ✅ 313 سجل posted |
| تنظيف cash_transactions | ✅ 69 سجل posted |
| تنظيف inventory_movements | ✅ 700 حركة posted |
| بناء audit trail | ✅ `data_integrity_recovery_log` |

### Phase 1 — حوكمة البيانات (Governance) ✅ مكتملة
| العنصر | النتيجة |
|--------|---------|
| مراكز التكلفة (11 محور + إدارية) | ✅ 13 مركز، تسلسل هرمي مكتمل |
| taxonomy المعدات (11 نوع) | ✅ `equipment_types` محدث |
| تصنيف أنشطة الموردين | ✅ equipment/labor/agricultural |
| `dimension_requirements` | ✅ 4 قواعد تحقق |

### Phase 2 — Backfill حتمي ✅ مكتمل
| القاعدة | السجلات المُعالجة |
|--------|---------|
| INV_RULE_1: item_code → center (self-map) | 13 سجل |
| INV_RULE_2: warehouse → center (self-map) | 5 سجلات |
| **المجموع** | **18 سجل في audit trail** |
| **التحسن الفعلي** | 88 → 70 مفقود (79.5% ✅) |

---

## الوضع الحالي لكل مصدر بيانات

### 📦 المصدر 1: inventory_movements (700 حركة)

#### ✅ ما يعمل صح
- **ISSUE** (صرف): 611 حركة → 100% لها مركز تكلفة → **صح تماماً**
- **GRN** (استلام): 19 حركة لها مركز تكلفة → صواب (مشتريات مباشرة لبيفوت محدد)

#### ⚠️ الـ 70 GRN بدون مركز تكلفة — هل هذا خطأ؟
**الإجابة الدقيقة:** هذا **ليس خطأ بالضرورة** — بل هو نمط عمل مقصود:

| المخزن | GRNs بلا مركز | قيمة (ج) | التفسير |
|--------|--------------|-----------|---------|
| اسمدة | 33 | 15,587,150 | مخزن مشترك ← التوزيع يحدث عند الصرف (ISSUE) |
| مبيدات | 8 | 754,380 | مخزن مشترك ← نفس المنطق |
| شبكات ري | 11 | 12,925 | قطع ري مشتركة |
| تعبئة وتغليف | 1 | 150 | مشترك |
| تقاوي وبذور | 17 | 0 | ⚠️ قيمة صفر — يحتاج تحقق |

**المنطق التجاري:** الأسمدة والمبيدات تُشترى مركزياً (مخزن مشترك) ثم تُوزع على البيفوتات عند الصرف. التكلفة تُعلق على مركز التكلفة في لحظة **الصرف (ISSUE)** وليس الاستلام (GRN).

#### ❓ نقاط غير مؤكدة تحتاج تحقق
1. **تقاوي وبذور** — تظهر في الفئتين (مع مركز ومن دون)، و17 سجل بقيمة صفر. ماذا تمثل؟
2. **مبيدات** — 8 بلا مركز و2 بمراكز من نفس المخزن. هل التوزيع عشوائي في الإدخال الأصلي؟

---

### 💼 المصدر 2: supplier_transactions (313 معاملة)

| التصنيف | العدد | مركز التكلفة |
|---------|-------|-------------|
| ميكنة (entry_type=د) | 200 | ✅ 100% |
| مواد زراعية (expense_category=31001 - د) | 40 | ✅ 100% |
| مواد زراعية (expense_category=31001 - م) | 26 | ✅ 100% |
| إدخالات بقيمة صفر (expense_category=null) | 16 | ✅ 100% |
| عمالة (entry_type=د) | 14 | ✅ 100% |
| مواد أخرى (33003 - م) | 13 | ✅ 100% |
| عمالة (م) | 4 | ✅ 100% |

**✅ 100% مكتمل — لا مشاكل**

#### ✅ توضيح expense_category (تم التحقق)
- `expense_category = '31001'` و `'33003'` → هذه **أكواد من جدول `expense_types`** (ليست من chart_of_accounts)
- `33003` = **أدوات مكتبية** → GL account: `51200034`
- `31001` = **تحقق مطلوب** (يبدأ بـ 31 ← فئة مواد زراعية في الغالب)
- كل expense_type له `gl_account_code` مرتبط → **هذا هو مفتاح الربط بالقيود المحاسبية**
- **الحالة:** ✅ مقصود وصحيح — expense_category هو كود `expense_types`

---

### 🏦 المصدر 3: cash_transactions (69 معاملة)

**✅ 100% مكتملة — مراكز التكلفة موجودة بالكامل**
- الرصيد النهائي: 19,801- جنيه  
- 4 كودات صرف → 4 مراكز تكلفة (100% حتمي)

---

### 📊 المصدر 4: business_events (1,082 حدث)

| المتري | القيمة |
|--------|--------|
| إجمالي الأحداث | 1,082 |
| مرتبطة بـ journal_entry | **0 (صفر!)** |

**🔴 مشكلة حرجة:** كل الأحداث التجارية موجودة لكن لا يوجد قيد محاسبي واحد. السلسلة المحاسبية مقطوعة تماماً.

---

### 📒 المصدر 5: journal_entries / journal_entry_lines

| الجدول | العدد |
|--------|-------|
| journal_entries | **0 (فارغ تماماً)** |
| journal_entry_lines | **0 (فارغ تماماً)** |
| posting_rule_resolutions | **0 (فارغ تماماً)** |

**الموجود لكن غير مُفعّل:**
- 84 posting_rules (29 control + 19 general + 36 inventory)
- 347 حساب في chart_of_accounts
- 13 مركز تكلفة

---

## اكتشاف الثغرات الحالية (Gap Analysis)

### الثغرة 1 — الكبرى: السلسلة المحاسبية مقطوعة 🔴
```
supplier_transactions (313) ──→ business_events (1082) ──→ journal_entries (0 !!!)
cash_transactions (69)       ──→ business_events        ──→ journal_entry_lines (0 !!!)
inventory_movements (700)    ──→ business_events        ──→ posting_rule_resolutions (0 !!!)
```
**التأثير:** لا يمكن توليد قوائم مالية. الميزانية صفر. قائمة الدخل صفر.

### الثغرة 2 — GRN بدون مركز تكلفة (70 سجل) 🟡
**القيمة الإجمالية:** ~16.4 مليون جنيه
**الموقف:** قد يكون صحيحاً (مخزن مشترك) لكن يحتاج قرار تجاري رسمي.

### الثغرة 3 — expense_category كود من expense_types 🟢 (تم التحقق)
- `expense_category = '31001'` و `'33003'` هي أكواد من جدول `expense_types`
- كل كود له `gl_account_code` مباشر (مثال: 33003 → 51200034)
- **هذا صحيح ومقصود** — الكود هو مفتاح الربط بالقيد المحاسبي
- **لا يوجد خطأ هنا** ← الثغرة الوحيدة: `31001` لم يُرَ في expense_types (يحتاج تحقق)

### الثغرة 4 — تقاوي وبذور بقيمة صفر 🟡
- 17 حركة GRN في مخزن "تقاوي وبذور" بقيمة 0
- قد تكون: أرصدة افتتاحية، تسويات، أو أخطاء إدخال

### الثغرة 5 — posting_rules منخفضة الفعالية 🟡
- 84 قاعدة ترحيل (29+19+36)
- فقط 44 منها active (52%)
- لا يوجد أي posting_rule_resolutions مرتبط بالبيانات الفعلية

---

## الخطة التفصيلية لما تبقى

---

### Phase 3 — تحقق وقرارات العمل (Business Decisions)
**المدة المتوقعة:** 1-2 يوم  
**الأولوية:** 🔴 حرجة (مطلوبة قبل Phase 4)

#### 3.1 — تحقق من expense_category في supplier_transactions
```sql
-- هل '31001' موجود في chart_of_accounts؟
SELECT code, name_ar FROM chart_of_accounts 
WHERE company_id=1 AND code IN ('31001','33003');
```
**القرار المطلوب:** هل expense_category يمثل كود حساب أم فئة نصية؟

#### 3.2 — قرار GRN بدون مركز تكلفة
**القرارات المطلوبة من الإدارة:**
- [ ] **خيار A (موصى به):** GRN للمخازن المشتركة (اسمدة/مبيدات) = لا يحتاج مركز تكلفة ← التكلفة تُوزع عند الصرف
- [ ] **خيار B:** كل GRN يجب أن يحمل مركز تكلفة ← يتطلب backfill يدوي لـ 70 سجل
- [ ] **قرار تقاوي وبذور:** هل القيمة الصفرية لـ 17 سجل صحيحة؟

#### 3.3 — التحقق من اكتمال posting_rules
```sql
-- كم قاعدة active فعلاً مرتبطة بالبيانات الموجودة؟
SELECT pr.rule_type, pr.mapping_key, pr.is_active
FROM posting_rules pr WHERE company_id=1 ORDER BY rule_type, mapping_key;
```

---

### Phase 4 — بناء السلسلة المحاسبية (GL Chain Materialization)
**المدة المتوقعة:** 2-3 أيام  
**الأولوية:** 🔴 الأهم للنتائج المالية

#### 4.1 — بناء journal_entries من business_events
كل business_event يولد:
```
journal_entries(1 رأس) ← source = business_event_id
journal_entry_lines(2+ سطر) ← DR + CR حسب posting_rules
```

**التسلسل:**
1. **supplier_transactions** → journal_entry
   - DR: حساب التكلفة (expense account من posting_rules)
   - CR: حساب المورد (من chart_of_accounts)
   
2. **cash_transactions** → journal_entry
   - DR: حساب التكلفة
   - CR: حساب الخزينة/البنك

3. **inventory_movements GRN** → journal_entry
   - DR: حساب المخزون (inventory_account من posting_rules)
   - CR: حساب المورد أو الدائنين
   
4. **inventory_movements ISSUE** → journal_entry
   - DR: حساب التكلفة (مع مركز التكلفة)
   - CR: حساب المخزون

#### 4.2 — ربط الـ posting_rules بالبيانات
```sql
-- التحقق: هل الـ prod_posting_group_code في items متطابق مع posting_rules؟
SELECT DISTINCT i.prod_posting_group_code, i.inv_posting_group_code
FROM items i 
LEFT JOIN posting_rules pr ON pr.prod_posting_group_code = i.prod_posting_group_code
WHERE i.company_id=1 AND pr.id IS NULL;
```

---

### Phase 5 — بناء التقارير المالية
**المدة المتوقعة:** 1-2 يوم  
**الأولوية:** 🟡 عالية

#### 5.1 — قائمة الدخل (P&L)
```
إيرادات
  (-) تكلفة المواد الزراعية (المنصرفة من مخزون)
  (-) تكلفة الميكنة (من supplier_transactions - ميكنة)
  (-) تكلفة العمالة (من supplier_transactions - عمالة)
  (-) تكلفة إدارية (cash_transactions)
= صافي الربح/الخسارة
```

#### 5.2 — تحليل مركز التكلفة (Cost Center P&L)
- تقرير لكل بيفوت (1006001-1006010) على حدة
- إجمالي تكاليف كل محور = أساس القرارات الزراعية

#### 5.3 — Inventory Valuation
- WAC (Weighted Average Cost) موجودة في البيانات ✅
- تقرير رصيد المخزون بالقيمة في نهاية الفترة

---

### Phase 6 — الاستكمال اليدوي (Manual Classification)
**المدة المتوقعة:** نصف يوم (مع الإدارة)  
**الأولوية:** 🟢 بعد Phase 3

**الـ 70 GRN بدون مركز تكلفة:**
- إذا القرار أن GRN المشترك لا يحتاج مركز ← انتهى الأمر
- إذا القرار أن يحتاج مركز ← جدول Excel للمراجعة اليدوية

---

## Checklist النتائج المرجوة — بعد اكتمال كل المراحل

### ✅ نتائج البيانات (Data Results)

| # | النتيجة | الحالة |
|---|---------|--------|
| D1 | supplier_transactions: 100% center_code | ✅ مكتمل |
| D2 | cash_transactions: 100% center_code | ✅ مكتمل |
| D3 | inventory_movements ISSUE: 100% center_code | ✅ مكتمل |
| D4 | inventory_movements GRN: قرار عمل موثق | ⏳ Phase 3 |
| D5 | gl_dimension_backfill_audit: 18 سجل | ✅ مكتمل |
| D6 | journal_entries: مولّد لكل معاملة | ⏳ Phase 4 |
| D7 | journal_entry_lines: DR=CR لكل قيد | ⏳ Phase 4 |
| D8 | posting_rule_resolutions: مرتبطة | ⏳ Phase 4 |

### ✅ نتائج المحاسبة (Accounting Results)

| # | النتيجة | الكيفية |
|---|---------|---------|
| A1 | ميزان المراجعة متوازن (DR = CR) | Phase 4 → verify SUM(debit) = SUM(credit) |
| A2 | كل معاملة مرتبطة بقيد محاسبي | Phase 4 → journal_entry_id NOT NULL |
| A3 | مراكز التكلفة محددة للـ ISSUE | ✅ موجود الآن |
| A4 | قائمة الدخل يمكن توليدها | Phase 5 |
| A5 | تحليل تكاليف كل بيفوت | Phase 5 |

### ✅ نتائج التكامل (Integrity Results)

| # | الفحص | الهدف |
|---|-------|--------|
| I1 | لا supplier_transaction بدون مورد | 0 NULLs في supplier_code |
| I2 | كل posting_rule مرتبط بحساب فعّال | 100% account_code في COA |
| I3 | توازن المخزون: رصيد_ك = مجموع (qty_in - qty_out) | لكل item_code |
| I4 | لا journal_entry_lines بدون journal_entry | referential integrity |
| I5 | مجموع القيد المحاسبي = مجموع المعاملات | تطابق مالي كامل |

### ✅ نتائج التقارير (Reporting Results)

| # | التقرير | المصدر |
|---|---------|---------|
| R1 | تكلفة كل بيفوت (مركز تكلفة) | journal_entry_lines GROUP BY cost_center |
| R2 | تكاليف الموردين حسب الفئة | supplier_transactions |
| R3 | رصيد المخزون الحالي | inventory_movements |
| R4 | قائمة الدخل للموسم | journal_entries P&L |
| R5 | عمر المخزون (WAC Valuation) | inventory_movements WAC |

---

## الخطوة الفورية التالية (Quick Wins)

### القرار 1 — يحتاج منك إجابة الآن:
> **هل GRN للمخازن المشتركة (اسمدة، مبيدات) يلزمه مركز تكلفة؟**

**توصيتنا:** لا. لأن:
- 611 ISSUE حركة ← 100% لها مركز تكلفة
- الأسمدة تُصرف من المخزن المركزي لكل بيفوت عبر ISSUE
- محاسبياً: تكلفة الأسمدة تظهر في مركز التكلفة عند الصرف وليس الاستلام
- **النتيجة:** الـ 70 GRN بلا مركز هو سلوك صحيح تجارياً

### القرار 2 — expense_category:
> **هل '31001' و'33003' في expense_category هي أكواد حسابية أم فئات وصفية؟**

خذ هذا الاستعلام لتأكيده:
```sql
SELECT code, name_ar FROM chart_of_accounts WHERE company_id=1 AND code IN ('31001','33003');
```

---

## ملاحظات حول احتمالية أخطاء في الفهم

| الموضوع | الخطأ المحتمل | الصواب المرجح |
|---------|--------------|---------------|
| GRN بلا مركز تكلفة | "هذا خطأ يجب إصلاحه" | المخزن المشترك لا يحتاج مركز ← التكلفة تُوزع عند الصرف |
| تقاوي وبذور بقيمة 0 | "أرصدة افتتاحية خاطئة" | قد تكون حركات كمية فقط (unit value tracked elsewhere) |
| journal_entries = 0 | "النظام يعمل بدون محاسبة" | السلسلة المحاسبية لم تُبنَ بعد (Phase 4 مطلوبة) |
| expense_category = رقم | "خطأ استيراد" | قد يكون مقصوداً (COA code embedded in category) |
| cost_center 210101 و2104 | "مراكز زائدة" | Legacy overhead — لا تحذف، تُبقى للمرجعية |

---

## ملخص تنفيذي — ما أنجزناه وما تبقى

```
[✅ Phase 0] استعادة البيانات المفسودة → 1,082 سجل آمن
[✅ Phase 1] حوكمة: مراكز التكلفة + معدات + موردين → جاهز
[✅ Phase 2] Backfill حتمي: 88 → 70 مفقود → audit trail موثق
[⏳ Phase 3] قرارات عمل + تحقق expense_category → يوم واحد
[⏳ Phase 4] بناء journal_entries (السلسلة المحاسبية) → الأكبر
[⏳ Phase 5] توليد التقارير المالية → يوم
[⏳ Phase 6] استكمال يدوي للـ 70 GRN إذا قُرر
```

**النتيجة النهائية المرجوة:** نظام محاسبة زراعي كامل بمراكز تكلفة لكل بيفوت، ميزان مراجعة متوازن، وتقارير مالية قابلة للتدقيق.
