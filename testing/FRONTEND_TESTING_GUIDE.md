# دليل اختبار الـ Frontend - تطبيق العمليات المالية
## Frontend Testing Guide - Financial Operations

**التاريخ:** 2026-05-10  
**الهدف:** اختبار واجهة الإدخال (Frontend) وتتبع البيانات إلى Backend  
**الحالة:** جاهز للتنفيذ

---

## 1️⃣ جهيزة الاختبار (Test Environment Setup)

### الخطوة 1: تشغيل Frontend locally
```bash
cd agri-nile-flow
npm run dev
# يفتح http://localhost:5173
```

### الخطوة 2: تشغيل Backend (إن لم يكن مفعل)
```bash
# Backend يعمل على Cloudflare Workers
npm run backend:deploy:prod
# أو للـ dev:
npm run dev:backend
```

### الخطوة 3: فتح Console للتحقق من Errors
```
في المتصفح: F12 → Console tab
أتاب Network tab (لمراقبة API calls)
```

---

## 2️⃣ اختبار العملية الأولى: دفعة كاش بسيطة

### 📝 البيانات المطلوبة:
```
نوع العملية: Cash Payment (دفع كاش)
المورد: [اختر من dropdown] ← مهم جداً!
المبلغ: 50,000 EGP
نوع المصروف: Supplies (شراء إمدادات)
الوصف: TEST: Payment for supplies - May 10, 2026
التاريخ: 2026-05-10
المركز: Operations [اختياري]
```

### ✅ خطوات التنفيذ:

#### الخطوة 1: الدخول للصفحة
```
Frontend URL: http://localhost:5173/operations/cash
أو: http://localhost:5173/transactions/new
```

#### الخطوة 2: ملء النموذج
```
┌─────────────────────────────────────┐
│ Cash Payment Entry Form             │
├─────────────────────────────────────┤
│                                     │
│ Supplier: [Dropdown ▼]              │  ← اختر مورد معروف
│         └─ Supplier 1001            │
│         └─ Supplier 1002            │
│         └─ Supplier 1003            │
│                                     │
│ Amount: [50000]    EGP              │
│                                     │
│ Expense Type: [Supplies]            │
│ Description: TEST: Payment...       │
│                                     │
│ Date: [2026-05-10] ▼               │
│                                     │
│ [SAVE] [CLEAR]                      │
└─────────────────────────────────────┘
```

#### الخطوة 3: بعد SAVE
**التوقعات:**
```
✅ ظهور رسالة: "Operation Saved Successfully"
   أو
   "Transaction ID: [txn-123456]"

❌ إذا كان فيه خطأ:
   "Error: Supplier is required"
   أو
   "Error: Amount must be > 0"
```

#### الخطوة 4: تتبع API Call
في Network tab:
```
Request URL: https://...backend.../api/transactions/cash
Method: POST
Body: {
  "supplier_code": 1001,
  "amount": 50000,
  "expense_code": "SUPPLIES",
  "description": "TEST: Payment for supplies...",
  "date": "2026-05-10"
}

ملاحظة مهمة (المسار الفعلي الحالي):
Request URL: https://...backend.../api/treasury/transactions

Response: 200 OK
Body: {
  "ok": true,
  "transaction_id": "txn-123456",
  "journal_entry_id": "je-789012",
  "status": "posted"
}
```

#### الخطوة 5: التحقق من Database
```
npx wrangler d1 execute agri-nile-flow-data-lake --remote --json --command \
  "SELECT id, supplier_code, amount, status, journal_entry_id 
   FROM cash_transactions 
   WHERE description LIKE '%TEST: Payment for supplies%' 
   ORDER BY created_at DESC LIMIT 1;"

Expected Result:
{
  "id": 1001,
  "supplier_code": 1001,
  "amount": 50000,
  "status": "posted",
  "journal_entry_id": 5001
}
```

---

## 3️⃣ اختبار العملية الثانية: استقبال مشتريات (GRN)

### 📝 البيانات المطلوبة:
```
نوع العملية: Goods Receipt (استقبال مشتريات)
المورد: [اختر من dropdown]
المادة: [اختر item من dropdown] ← 1010189
الكمية: 100 وحدة
سعر الوحدة: 150 EGP
التاريخ: 2026-05-10
```

### ✅ خطوات التنفيذ:

#### الخطوة 1: الدخول للصفحة
```
Frontend URL: http://localhost:5173/inventory/receipt
أو: http://localhost:5173/inventory/movements (ثم اختر movement_type = GRN)
```

#### الخطوة 2: ملء النموذج
```
┌──────────────────────────────────────────┐
│ Goods Receipt Entry                      │
├──────────────────────────────────────────┤
│                                          │
│ Supplier: [Select ▼]                     │  ← إلزامي في اختبار GRN
│                                          │
│ Item Code: [1010189] ▼                   │  ← اختر من list
│         └─ Item 1010189: Fertilizer     │
│         └─ Item 1010436: Seeds          │
│                                          │
│ Quantity: [100]    units                 │
│ Unit Price: [150]    EGP                 │
│ Total Value: [15000] EGP (auto-calc)    │
│                                          │
│ Warehouse: [WAREHOUSE-001] ▼             │
│ Date: [2026-05-10]                       │
│                                          │
│ [SUBMIT] [CLEAR]                         │
└──────────────────────────────────────────┘
```

#### الخطوة 3: بعد SUBMIT
**التوقعات:**
```
✅ الرسالة: "Goods Receipt Posted"
   Transaction ID: [grn-123456]
   Journal Entry: [je-789012]
   
✅ Inventory مُحدّث:
   Item 1010189 quantity: +100

❌ الأخطاء الممكنة:
   "Error: Supplier is required for GRN"
   "Error: Item not found"
   "Error: GL Account not configured"
```

#### الخطوة 4: تتبع API
```
Request URL: https://.../api/inventory/grn
Method: POST
Body: {
  "supplier_code": 1001,
  "item_code": 1010189,
  "quantity": 100,
  "unit_price": 150,
  "warehouse": "WAREHOUSE-001",
  "date": "2026-05-10"
}

ملاحظة مهمة (المسار الفعلي الحالي):
Request URL: https://.../api/inventory/movements
Body يجب أن يحتوي:
{
   "movement_type": "GRN",
   "movement_date": "2026-05-10",
   "item_code": 1010189,
   "quantity": 100,
   "unit_price": 150,
   "warehouse": "WAREHOUSE-001",
   "supplier_code": 1001,
   "season_id": 2
}

Response: 200 OK
{
  "ok": true,
  "movement_id": "mov-123456",
  "journal_entry_id": "je-789012",
  "quantity_updated": 100,
  "value_updated": 15000
}
```

#### الخطوة 5: Database Check
```
npx wrangler d1 execute agri-nile-flow-data-lake --remote --json --command \
  "SELECT id, supplier_code, item_code, qty_in, value_in, journal_entry_id 
   FROM inventory_movements 
   WHERE movement_type='GRN' AND item_code=1010189 
   ORDER BY created_at DESC LIMIT 1;"

Expected:
{
  "id": 6905,
  "supplier_code": 1001,
  "item_code": 1010189,
  "qty_in": 100,
  "value_in": 15000,
  "journal_entry_id": 5002
}
```

---

## 4️⃣ اختبار العملية الثالثة: استخراج من المخزن (ISSUE)

### 📝 البيانات المطلوبة:
```
نوع العملية: Store Issue (استخراج من المخزن)
المادة: [اختر item]
الكمية: 50 وحدة
المركز: [Operations center]
التاريخ: 2026-05-10
```

### ✅ خطوات التنفيذ:

#### الخطوة 1: الدخول
```
Frontend: http://localhost:5173/inventory/issue
```

#### الخطوة 2: النموذج
```
┌──────────────────────────────────────────┐
│ Store Issue Entry                        │
├──────────────────────────────────────────┤
│                                          │
│ Item: [1010189] ▼                        │
│ Available Qty: [100] units               │  ← read-only
│                                          │
│ Quantity to Issue: [50]                  │
│ Unit Price: [150] EGP (auto-filled)      │
│ Total Value: [7500] EGP (auto-calc)      │
│                                          │
│ Center: [Operations] ▼                   │  ← مهم جداً!
│ Warehouse: [WAREHOUSE-001]               │
│ Date: [2026-05-10]                       │
│                                          │
│ Reason: Work materials                   │
│                                          │
│ [SUBMIT] [CLEAR]                         │
└──────────────────────────────────────────┘
```

#### الخطوة 3: النتيجة المتوقعة
```
✅ Success:
   "Issue recorded successfully"
   Transaction ID: [iss-123456]
   
✅ Inventory updated:
   Item 1010189: -50 units

❌ الأخطاء الممكنة:
   "Error: Center is required for ISSUE"
   "Error: Insufficient quantity (available: 100, requested: 50)"
   "Error: GL mapping not configured"
```

#### الخطوة 4: API Request
```
Request: POST /api/inventory/issue
Body: {
  "item_code": 1010189,
  "quantity": 50,
  "center_code": 1001,
  "warehouse": "WAREHOUSE-001",
  "reason": "Work materials",
  "date": "2026-05-10"
}

ملاحظة مهمة (المسار الفعلي الحالي):
Request: POST /api/inventory/movements
Body يجب أن يحتوي:
{
   "movement_type": "ISSUE",
   "movement_date": "2026-05-10",
   "item_code": 1010189,
   "quantity": 50,
   "warehouse": "WAREHOUSE-001",
   "center_code": 1001,
   "season_id": 2,
   "notes": "Work materials"
}

Response: {
  "ok": true,
  "movement_id": "mov-123457",
  "journal_entry_id": "je-789013",
  "quantity_deducted": 50,
  "remaining_balance": 50
}
```

---

## 5️⃣ اختبار idempotency لإضافة معدات أمر عمل

### الهدف
- ضمان عدم إنشاء سطور معدات مكررة عند إعادة الضغط على الحفظ أو إعادة الإرسال الشبكي.

### Endpoint
```
POST /api/operations/orders/:id/equipment
```

### Body (يجب أن يحتوي operation_id)
```json
{
  "operation_id": "wo12_equipment_550e8400-e29b-41d4-a716-446655440000",
  "equipment_name": "لودر اختبار",
  "task_date": "2026-05-10",
  "hours_worked": 2,
  "cost_per_hour": 175,
  "equipment_usage_mode": "rental",
  "supplier_code": 20100033,
  "notes": "idempotency check"
}
```

### سلوك متوقع
1. أول إرسال بنفس `operation_id`:
   - HTTP 201
   - `success=true` مع `id` جديد.
2. إعادة نفس الطلب بنفس `operation_id` ونفس البيانات:
   - HTTP 200
   - `duplicate=true`
   - نفس `id` القديم بدون إنشاء سطر جديد.
3. إعادة نفس `operation_id` لكن بيانات مختلفة:
   - HTTP 409
   - رسالة تضارب.

---

## 6️⃣ قائمة التحقق النهائية (Checklist)

### ✅ من جهة الـ Frontend:

| التحقق | الحالة | الملاحظات |
|-------|--------|---------|
| النموذج يظهر صحيح | ⏳ | هل كل الحقول موجودة؟ |
| Dropdowns تملأ من DB | ⏳ | هل الموردين والمواد تظهر؟ |
| Validation messages | ⏳ | هل تحذر عند الأخطاء؟ |
| Success message | ⏳ | هل تظهر رسالة النجاح؟ |
| Loading spinner | ⏳ | هل يظهر أثناء Submit؟ |
| Transaction ID | ⏳ | هل يعرض ID الحقيقي؟ |
| Form clear after submit | ⏳ | هل ينظف النموذج؟ |
| Error handling | ⏳ | هل تعرض أخطاء API؟ |

### ✅ من جهة الـ Backend:

| التحقق | الحالة | الملاحظات |
|-------|--------|---------|
| API endpoint responds | ⏳ | هل يعطي 200 OK؟ |
| Data inserted in DB | ⏳ | هل تظهر في database؟ |
| Journal entry created | ⏳ | هل تم إنشاء QE؟ |
| Business event logged | ⏳ | هل سجل الحدث؟ |
| GL mapping correct | ⏳ | هل الحسابات صحيحة؟ |
| Balance = 0 | ⏳ | هل debit = credit؟ |
| Idempotency works | ⏳ | نفس الطلب مرتين = 1 record؟ |
| Error messages clear | ⏳ | هل الأخطاء واضحة؟ |

---

## 7️⃣ جدول النتائج المتوقعة

### Test Case: Cash Payment (50,000 EGP)
```
Database After Success:
┌─ cash_transactions
│  ├─ id: 1001
│  ├─ supplier_code: 1001 ✓
│  ├─ amount: 50,000 ✓
│  ├─ status: posted ✓
│  └─ journal_entry_id: 5001 ✓
│
├─ journal_entries
│  ├─ id: 5001
│  ├─ entry_date: 2026-05-10 ✓
│  ├─ description: Cash Payment ✓
│  ├─ is_posted: 1 ✓
│  └─ status: posted ✓
│
└─ journal_entry_lines
   ├─ entry_id: 5001
   ├─ Line 1:
   │  ├─ account_code: SUPPLIES_EXP (مصروف)
   │  ├─ debit: 50,000 ✓
   │  └─ credit: 0
   └─ Line 2:
      ├─ account_code: BANK_ACCOUNT (البنك)
      ├─ debit: 0
      └─ credit: 50,000 ✓

Balance Check:
  Total Debit = 50,000 ✓
  Total Credit = 50,000 ✓
  Balance = 0 ✓ ← PASS
```

### Test Case: GRN (100 units × 150 = 15,000 EGP)
```
Database After Success:
┌─ inventory_movements
│  ├─ id: 6905
│  ├─ supplier_code: 1001 ✓
│  ├─ item_code: 1010189 ✓
│  ├─ qty_in: 100 ✓
│  ├─ value_in: 15,000 ✓
│  ├─ status: posted ✓
│  └─ journal_entry_id: 5002 ✓
│
├─ journal_entries
│  ├─ id: 5002
│  ├─ description: GRN - Supplier 1001 ✓
│  └─ is_posted: 1 ✓
│
└─ journal_entry_lines
   ├─ Line 1:
   │  ├─ account_code: INVENTORY (مخزن)
   │  ├─ debit: 15,000 ✓
   │  └─ credit: 0
   └─ Line 2:
      ├─ account_code: ACCOUNTS_PAYABLE (حسابات دائنة)
      ├─ debit: 0
      └─ credit: 15,000 ✓

Balance Check:
  Total Debit = 15,000 ✓
  Total Credit = 15,000 ✓
  Balance = 0 ✓ ← PASS
```

---

## 8️⃣ الأخطاء المحتملة والحل

### ❌ Error 1: "Supplier is required"
```
المشكلة: لم تختر مورد
الحل: اختر من dropdown بدلاً من الكتابة manual
```

### ❌ Error 2: "GL Account not configured"
```
المشكلة: الحساب المحاسبي غير معروف في النظام
الحل: تحقق من chart_of_accounts وتأكد من وجود الحساب
```

### ❌ Error 3: "Journal entry not created"
```
المشكلة: لم يتم إنشاء قيد محاسبي
الحل: تحقق من logs والـ gl_posting_error في database
```

### ❌ Error 4: "Insufficient quantity"
```
المشكلة: محاولة استخراج أكثر من المتاح
الحل: تحقق من inventory balance قبل الاستخراج
```

---

## 9️⃣ كيفية التقاط Screenshots

### للتقرير النهائي:
```
1. Frontend Entry Form (screenshot)
2. Success Message (screenshot)
3. Network tab with Request/Response (screenshot)
4. Database Query Result (text)
5. Journal Entry Details (screenshot)
```

---

## 🔟 ملاحظات عملية

⚠️ **مهم جداً:**
- اختبر على **Test Environment** أولاً، ليس Production
- احفظ **transaction IDs** و **journal entry IDs**
- استخدم نفس البيانات في كل اختبار (لسهولة التتبع)
- وثق أي **errors** أو **warnings**

✅ **نصائح:**
- اتبع ترتيب الاختبارات (كاش → GRN → ISSUE)
- راقب **Network tab** أثناء كل عملية
- تحقق من **Console** للأخطاء الخفية
- احفظ كل النتائج في ملف

---

## 1️⃣1️⃣ ملف التقرير النهائي المتوقع

بعد انتهاء الاختبارات، يجب إعداد تقرير يحتوي على:

```
TEST EXECUTION REPORT
Date: 2026-05-10
Environment: Test

1. TESTS EXECUTED: 3
   ✅ Cash Payment: PASS
   ✅ GRN Receipt: PASS
   ✅ Store Issue: PASS

2. TOTAL BALANCE CHECK: PASS
   Total Debit: 72,500 EGP
   Total Credit: 72,500 EGP
   Balance: 0 ✓

3. ISSUES FOUND: [list]
4. RECOMMENDATIONS: [list]
5. READY FOR PRODUCTION: YES/NO
```

---

**الحالة:** جاهز للبدء 🚀  
**التاريخ:** 2026-05-10
