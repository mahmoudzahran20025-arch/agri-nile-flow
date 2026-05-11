# خطة اختبارات شاملة للعمليات المالية والمخزنية
## Testing Plan for Financial Operations & Inventory Movements

**التاريخ:** 2026-05-10  
**الهدف:** التحقق من تسجيل العمليات من الـ Frontend وانعكاسها الصحيح في الحسابات  
**الحالة:** جاهز للتنفيذ

---

## 1️⃣ حالة الموردين - الـ 6 صفوف المتبقية

### المشكلة:
6 حركات GRN (مشتريات) بدون supplier_code:

| ID | Item Code | Qty In | Status |
|----|-----------|--------|--------|
| 6859 | 1010189 | 500 | ⏳ بحاجة msupplier |
| 6860 | 1010436 | 500 | ⏳ بحاجة supplier |
| 6861 | 1020361 | 2,000 | ⏳ بحاجة supplier |
| 6862 | 1010074 | 10,000 | ⏳ بحاجة supplier |
| 6863 | 1010002 | 15,000 | ⏳ بحاجة supplier |
| 6864 | 1010060 | 10,000 | ⏳ بحاجة supplier |

**التوصية:** 
- ✅ إما: تحديد supplier من مستند خارجي (Purchase Order/Invoice)
- ❌ أو: تعليم هذه الحركات كـ "Investigation" (لا تشترك في الرواتب الحقيقية)

---

## 2️⃣ أنواع العمليات للاختبار

### A) عمليات الكاش (Cash Transactions)
**الهدف:** تسجيل دفعة كاش وتتبعها إلى الحساب الصحيح

**البيانات المطلوبة:**
- supplier_code (المورد المدفوع له)
- amount (المبلغ)
- expense_code (نوع المصروف: صيانة، إيجار، مشتريات)
- description

**التحقق:**
- ✓ القيد المحاسبي تم إنشاؤه
- ✓ الحساب البنكي صحيح (Cash Account)
- ✓ حساب المصروف متطابق مع expense_code

---

### B) عمليات المخزن (Inventory Movements)
**أنواع:**
1. **GRN (مشتريات من موردين)**
   - تحديث: supplier_code ✅
   - الكمية المستلمة: qty_in
   - الحساب: مشتريات ← موردين

2. **ISSUE (استخراج من المخزن)**
   - تحديث: center_code
   - الكمية الخارجة: qty_out
   - الحساب: تكاليف العمليات ← مخزن

3. **TRANSFER (تحويل بين المستودعات)**
   - warehouse_id المصدر والهدف
   - الكمية المحولة
   - الحساب: لا تأثير محاسبي (مخزن ← مخزن)

---

### C) عمليات الإيجار (Equipment Rental)
**البيانات:**
- equipment_id
- rental_period (من - إلى)
- amount
- center_code (مركز الاستفادة)

**التحقق:**
- ✓ الإيجار مسجل تحت "Operating Expenses"
- ✓ linked إلى center_code الصحيح

---

### D) عمليات أخرى (Other Operations)
**المحتملة:**
- Inventory Adjustments (تسويات المخزن)
- Asset Depreciation (استهلاك الأصول)
- Work Order Completions (إكمال أوامر العمل)

---

## 3️⃣ خطة الاختبار التفصيلية

### Phase 1: إعداد بيانات الاختبار

#### Test Scenario 1.1: عملية كاش بسيطة
```
Operation: Cash Payment for Supplies
Input:
  - supplier_code: 1001 (مورد تم التحقق منه)
  - amount: 50,000 EGP
  - expense_code: "SUPPLIES"
  - date: 2026-05-10
  
Expected Output:
  - journal_entries: 1 entry created
  - debit: 50,000 (Supplies Expense - Code XXX)
  - credit: 50,000 (Bank Account - Code YYY)
  - status: posted
```

#### Test Scenario 1.2: عملية مخزن - GRN
```
Operation: Goods Receipt (Purchase)
Input:
  - supplier_code: 1001
  - item_code: 1010189
  - qty_in: 100 units
  - unit_price: 150 EGP
  - total_value: 15,000 EGP
  
Expected Output:
  - journal_entries: 1 entry created
  - debit: 15,000 (Inventory - Code 1410)
  - credit: 15,000 (Accounts Payable - Code 2101)
  - inventory_movements: qty updated
  - status: posted
```

#### Test Scenario 1.3: عملية مخزن - ISSUE
```
Operation: Issue from Store
Input:
  - item_code: 1010189
  - qty_out: 50 units
  - unit_price: 150 EGP
  - total_value: 7,500 EGP
  - center_code: 1001 (مركز عمليات)
  
Expected Output:
  - journal_entries: 1 entry created
  - debit: 7,500 (Operating Expenses)
  - credit: 7,500 (Inventory - Code 1410)
  - inventory balance updated (qty reduced)
  - status: posted
```

#### Test Scenario 1.4: عملية مخزن - TRANSFER
```
Operation: Transfer Between Warehouses
Input:
  - item_code: 1010189
  - qty: 30 units
  - from_warehouse_id: 101
  - to_warehouse_id: 102
  
Expected Output:
  - journal_entries: 0 (no accounting impact)
  - inventory_movements: 2 records (out/in)
  - warehouse balances updated
  - status: posted
```

---

### Phase 2: تنفيذ الاختبارات

#### Test Execution Steps:

**2.1 Frontend Data Entry**
```
1. افتح Frontend
2. اختر نوع العملية (كاش/مخزن/إيجار)
3. أدخل البيانات طبقاً للـ scenario
4. تحقق من validation (errors/warnings)
5. اضغط Submit
```

**2.2 Backend Reception**
```
- API endpoint يتلقى البيانات
- يتحقق من الأبعاد المطلوبة (supplier/center/warehouse)
- ينشئ business_event
- يُنشئ journal_entry
- يُسجل في inventory_movements/cash_transactions
```

**2.3 Database Verification**
```sql
-- تحقق من:
1. business_events table (record created)
2. journal_entries table (JE created + posted)
3. journal_entry_lines table (debit/credit lines correct)
4. relevant transaction table (inventory/cash/etc)
5. Balance verification (debit = credit)
```

---

## 4️⃣ اختبار واحد عملي كمثال

### Test: Cash Payment for Equipment Rental

**الإدخال (Frontend):**
```
Operation Type: Cash Payment
Description: Equipment Rental - May 2026
Supplier Code: 1002 (Equipment Rental Company)
Amount: 25,000 EGP
Expense Code: EQUIPMENT_RENTAL
Center Code: 1001 (Operations)
Date: 2026-05-10
```

**التحقق المطلوب:**
```
1. ✓ تم إنشاء business_event
   - entity_type: cash_transaction
   - event_type: payment_issued
   
2. ✓ تم إنشاء journal_entry
   - entry_date: 2026-05-10
   - description: "Cash Payment - Equipment Rental"
   - status: posted
   
3. ✓ تم إنشاء journal_entry_lines (2 lines):
   - Line 1: debit 25,000 → Equipment Rental Expense (كود المصروف)
   - Line 2: credit 25,000 → Bank Account (حساب الكاش)
   
4. ✓ تم تسجيل في cash_transactions
   - amount: 25,000
   - supplier_code: 1002
   - expense_code: EQUIPMENT_RENTAL
   - status: posted
   - journal_entry_id: linked correctly
   
5. ✓ التوازن المحاسبي:
   - debit total = credit total
   - balance = 0
```

---

## 5️⃣ نقاط التحقق الحرجة

### Frontend ← → Backend

| Check Point | Expected Result | Risk Level |
|-------------|-----------------|-----------|
| Data Validation | يرفض null في الأبعاد المطلوبة | 🔴 High |
| API Response | 200 OK + transaction_id | 🔴 High |
| Idempotency | نفس العملية مرتين = 1 record | 🟡 Medium |
| GL Account Mapping | المصروف → Account Code صحيح | 🔴 High |
| Journal Balance | debit = credit دائماً | 🔴 High |
| Status Consistency | business_event + JE + transaction متطابقة | 🟡 Medium |
| Timestamp Sequence | created_at الوقت متسلسل | 🟢 Low |

---

## 6️⃣ الإخراجات المتوقعة

### ✅ النجاح:
- جميع العمليات مُسجلة في الحسابات الصحيحة
- لا توجد أخطاء توازن
- الروابط (links) كاملة (business_event ← JE ← transaction)
- الحالات (statuses) متسقة

### ❌ الفشل (الأخطاء المحتملة):
- ✗ GRN بدون supplier_code (6 موردين)
- ✗ ISSUE بدون center_code
- ✗ TRANSFER بدون warehouse_id
- ✗ الحساب المحاسبي الخطأ (GL mapping)
- ✗ عدم توازن القيود (debit ≠ credit)
- ✗ عدم إنشاء business_event
- ✗ JE لم تُنشأ أو لم تُنشر

---

## 7️⃣ التوصيات للـ Frontend

### يجب تحسينها:
1. **Validation Alerts**
   - ⚠️ تحذير واضح عند الضغط على Save بدون supplier_code
   - مثال: "❌ Supplier is required for Purchase Order"

2. **Dropdown Lists**
   - إظهار supplier list (من Database)
   - إظهار center list
   - إظهار warehouse list
   - بدلاً من إدخال manual entry

3. **Real-time Balance Display**
   - عرض inventory balance الحالي للمادة
   - عرض المورد المرتبط

4. **Submit Feedback**
   - بعد Submit: عرض "✅ Operation Posted Successfully"
   - عرض transaction_id و journal_entry_id
   - عرض GL accounts المتأثرة

---

## 8️⃣ التوصيات للـ Backend

### يجب تحسينها:
1. **Enhanced Validation**
   ```
   IF movement_type = 'GRN' AND supplier_code IS NULL
     THEN reject with: "Supplier code is mandatory for GRN"
   ```

2. **GL Account Mapping**
   - تحقق من وجود الحساب المحاسبي قبل الإنشاء
   - قم بـ retry إذا فشل GL mapping

3. **Audit Trail**
   - سجل كل محاولة submit (حتى الفاشلة)
   - بما فيها سبب الفشل

4. **Atomic Transactions**
   - إما: تنشئ كل شيء (business_event + JE + transaction)
   - أو: rollback الكل إذا فشل أي جزء

---

## 9️⃣ جدول الاختبارات الكامل

| Seq | Test Case | Input Data | Expected JE | Priority | Status |
|-----|-----------|-----------|-------------|----------|--------|
| 1 | Cash: Supplier Payment | supplier_code, amount, expense | Exp Dr / AP Cr | 🔴 | ⏳ |
| 2 | Cash: Expense Payment | amount, expense_code | Exp Dr / Bank Cr | 🔴 | ⏳ |
| 3 | Inventory: GRN | supplier, item, qty, value | Inv Dr / AP Cr | 🔴 | ⏳ |
| 4 | Inventory: ISSUE | center_code, item, qty | Exp Dr / Inv Cr | 🔴 | ⏳ |
| 5 | Inventory: TRANSFER | warehouse_from, warehouse_to | No JE | 🟡 | ⏳ |
| 6 | Rental: Equipment | equipment_id, amount, period | Exp Dr / Bank Cr | 🟡 | ⏳ |
| 7 | Idempotency: Duplicate Submit | same data twice | 1 record created | 🟡 | ⏳ |
| 8 | Validation: Missing Supplier | GRN without supplier | Rejection error | 🔴 | ⏳ |
| 9 | Validation: Missing Center | ISSUE without center | Rejection error | 🔴 | ⏳ |
| 10 | Balance Check | All operations | debit = credit | 🔴 | ⏳ |

---

## 🔟 الخطوات التالية

### اليوم:
1. ✅ تحديد الـ 6 موردين (supplier_code)
2. ✅ تحضير بيانات اختبار
3. ⏳ تنفيذ اختبارات على Test Environment

### غداً:
4. ⏳ تجميع النتائج
5. ⏳ إعداد تقرير النتائج
6. ⏳ تقديم التوصيات

### الأسبوع التالي:
7. ⏳ تطبيق التحسينات على Frontend
8. ⏳ تطبيق التحسينات على Backend
9. ⏳ re-test المرة الثانية

---

## ملاحظات مهمة

⚠️ **قبل الاختبارات:**
- تأكد من وجود suppliers في Database
- تأكد من وجود GL Accounts معرفة
- تأكد من أن environment = Test (ليس Production)

✅ **أثناء الاختبارات:**
- احفظ كل responses من API
- سجل أي أخطاء أو تحذيرات
- التقط screenshots من الـ Frontend والـ Backend

📊 **بعد الاختبارات:**
- حلل النتائج
- قدم توصيات واضحة
- اقترح أولويات الإصلاح

---

**الحالة الحالية:** جاهز للبدء 🚀
**التاريخ:** 2026-05-10
**المسؤول:** System Testing Framework
