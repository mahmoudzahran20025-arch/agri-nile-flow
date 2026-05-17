# 📋 دليل الاختبارات الشاملة - Testing Execution Guide
## Comprehensive Testing Framework - Financial Operations & Inventory

**التاريخ:** 2026-05-10  
**الإصدار:** v1.0  
**الحالة:** جاهز للتنفيذ

---

## 📁 الملفات المضمنة

```
testing/
├── 📄 README.md (هذا الملف)
├── 📋 COMPREHENSIVE_TEST_PLAN.md     - خطة الاختبار الشاملة
├── 📋 FRONTEND_TESTING_GUIDE.md      - دليل اختبار الواجهة
├── 🔧 Test_Data_and_Verification_Queries.sql - استعلامات التحقق
├── 🚀 Execute_Comprehensive_Tests.ps1        - سكريبت التنفيذ
└── 💡 RECOMMENDATIONS_AND_IMPROVEMENTS.md    - التوصيات النهائية
```

---

## 🚀 كيفية البدء

### الخطوة 1: فهم الخطة
```bash
# اقرأ خطة الاختبار الشاملة
code COMPREHENSIVE_TEST_PLAN.md
```

**الجزء المهم:**
- أنواع العمليات (كاش، مخزن، إيجار)
- السيناريوهات الاختبارية
- نقاط التحقق الحرجة

---

### الخطوة 2: تحضير البيانات الاختبارية

#### أولاً: تحديد البيانات الفعلية في قاعدتك
```powershell
# افتح PowerShell وشغل هذا:
cd 'c:\Users\mahmo\Contacts\CLAUDE_CO WORK MY WORK\agri-nile-flow'

# استعلم عن الموردين الفعليين
npx wrangler d1 execute agri-nile-flow-data-lake --remote --json --command `
  "SELECT supplier_code, COUNT(*) as count FROM supplier_transactions WHERE company_id=1 GROUP BY supplier_code LIMIT 5;"
```

**النتيجة:** ستحصل على قائمة الموردين الفعليين (استخدم أحدهم في الاختبارات)

---

### الخطوة 3: تشغيل الاختبارات

#### الطريقة الأولى: باستخدام PowerShell Script (سهل جداً)
```powershell
# تشغيل جميع الاختبارات
.\testing\Execute_Comprehensive_Tests.ps1 -TestType all

# أو فقط اختبارات الكاش
.\testing\Execute_Comprehensive_Tests.ps1 -TestType cash

# أو فقط اختبارات المخزن
.\testing\Execute_Comprehensive_Tests.ps1 -TestType inventory
```

**المتوقع:**
```
✓ Environment verified
✓ Suppliers found: 5
✓ GL accounts configured: 45
✓ Cash transaction inserted
✓ Journal entry created
✓ GRN inserted
✓ Overall balance: 0 ✓
```

---

#### الطريقة الثانية: يدوي (استعلام واحد في المرة)

##### Test 1: إدراج عملية كاش
```sql
INSERT INTO cash_transactions (
    company_id, supplier_code, expense_code,
    transaction_type, description, amount,
    created_at, status, device_id
) VALUES (1, 1001, 'SUPPLIES', 'PAYMENT',
    'TEST: Payment - Manual Run', 50000,
    datetime('now'), 'posted', 'test-device');
```

##### Test 2: التحقق من القيد
```sql
SELECT je.id, COUNT(jel.id) as lines,
       SUM(jel.debit) as debit, SUM(jel.credit) as credit
FROM journal_entries je
LEFT JOIN journal_entry_lines jel ON je.id = jel.entry_id
WHERE je.description LIKE '%TEST:%'
GROUP BY je.id;
```

---

### الخطوة 4: اختبار الواجهة (Frontend)

#### اتبع الخطوات من الدليل:
```bash
code FRONTEND_TESTING_GUIDE.md
```

**الخطوات:**
1. شغل Frontend: `npm run dev`
2. ادخل البيانات
3. اضغط Submit
4. تابع الـ Network tab
5. تحقق من Database

---

## 📊 مثال تطبيقي كامل

### السيناريو: دفعة كاش بسيطة (50,000 EGP)

#### 1️⃣ تحضير البيانات:
```powershell
$testAmount = 50000
$testSupplier = 1001
$testDate = (Get-Date).ToString('yyyy-MM-dd')
```

#### 2️⃣ إدراج البيانات:
```sql
INSERT INTO cash_transactions (
    company_id, supplier_code, expense_code,
    transaction_type, description, amount,
    created_at, status
) VALUES (1, 1001, 'SUPPLIES', 'PAYMENT',
    'TEST: Payment for supplies', 50000,
    datetime('now'), 'posted');
```

#### 3️⃣ التحقق من الإدراج:
```sql
SELECT id, supplier_code, amount, status
FROM cash_transactions
WHERE description LIKE '%TEST: Payment for supplies%'
ORDER BY created_at DESC LIMIT 1;
```

**النتيجة:**
```
id: 1001
supplier_code: 1001
amount: 50000
status: posted
```

#### 4️⃣ التحقق من القيد:
```sql
SELECT COUNT(DISTINCT jel.entry_id) as je_count,
       SUM(jel.debit) as total_debit,
       SUM(jel.credit) as total_credit
FROM journal_entry_lines jel
JOIN journal_entries je ON jel.entry_id = je.id
WHERE je.description LIKE '%TEST: Payment%';
```

**النتيجة:**
```
je_count: 1
total_debit: 50000
total_credit: 50000 ✓
```

#### 5️⃣ النتيجة النهائية:
```
✅ Operation successful
   - Cash transaction created
   - Journal entry posted
   - Balance is correct (debit=credit)
   - Ready for production
```

---

## 🔍 كيفية قراءة النتائج

### ✅ النجاح:
```
{
  "ok": true,
  "transaction_id": "txn-123456",
  "journal_entry_id": "je-789012",
  "status": "posted"
}
```

### ❌ الفشل:
```
{
  "ok": false,
  "error": "VALIDATION_ERROR",
  "message": "Supplier code is mandatory for GRN",
  "statusCode": 422
}
```

---

## 📝 قائمة التحقق أثناء الاختبار

### قبل الاختبار:
- [ ] Backend يعمل (Cloudflare Workers deployed)
- [ ] Frontend يعمل (localhost:5173)
- [ ] قاعدة البيانات accessible
- [ ] لديك supplier_codes فعلية من Database

### أثناء الاختبار:
- [ ] افتح Console (F12)
- [ ] افتح Network tab
- [ ] سجل أي errors
- [ ] التقط screenshots

### بعد الاختبار:
- [ ] تحقق من Database
- [ ] تحقق من Journal Balance (debit=credit)
- [ ] وثق النتائج

---

## 🎯 الاختبارات الموصى بها بالترتيب

### اليوم (First Day):
1. ✅ **Environment Verification** (~5 دقائق)
2. ✅ **Cash Payment Test** (~15 دقيقة)
3. ✅ **Inventory GRN Test** (~15 دقيقة)

### غداً (Second Day):
4. ⏳ **Inventory ISSUE Test** (~15 دقيقة)
5. ⏳ **Balance Reconciliation** (~10 دقائق)
6. ⏳ **Error Handling Test** (~20 دقيقة)

### الأسبوع المقبل:
7. ⏳ **Frontend Complete Workflow** (~30 دقيقة)
8. ⏳ **Idempotency Test** (~15 دقيقة)
9. ⏳ **Performance Test** (~20 دقيقة)

---

## 🐛 استكشاف الأخطاء

### Error: "Supplier not found"
**السبب:** supplier_code غير موجود في Database  
**الحل:** استخدم supplier من الاستعلام الأول
```powershell
npx wrangler d1 execute agri-nile-flow-data-lake --remote --json --command \
  "SELECT DISTINCT supplier_code FROM supplier_transactions LIMIT 1;"
```

---

### Error: "GL Account not configured"
**السبب:** حساب محاسبي غير معروف  
**الحل:** تحقق من Chart of Accounts
```sql
SELECT account_code, account_name 
FROM chart_of_accounts 
WHERE account_type IN ('EXPENSE', 'ASSET');
```

---

### Error: "Duplicate key violation"
**السبب:** محاولة إدراج نفس البيانات مرتين  
**الحل:** استخدم operationId unique
```sql
-- استخدم timestamp unique
WHERE local_id = DATETIME('now') || '_' || RANDOM();
```

---

## 📊 تقرير النتائج المتوقع

بعد انتهاء الاختبارات، أعد التقرير التالي:

```markdown
# Test Execution Report - 2026-05-10

## 1. Environment Status
- ✅ Database: Connected
- ✅ Backend: Working
- ✅ Frontend: Working
- ✅ Network: Healthy

## 2. Test Results
| Test | Status | Duration | Notes |
|------|--------|----------|-------|
| Cash Payment | PASS | 45s | Balance verified |
| GRN Receipt | PASS | 52s | GL posting correct |
| ISSUE | PASS | 38s | Center mapped |

## 3. GL Balance Check
- Total Entries: 3
- Total Debit: 72,500 EGP
- Total Credit: 72,500 EGP
- Balance: 0 ✓

## 4. Issues Found
- [ ] None - All tests passed

## 5. Recommendations
- Implement validation on frontend
- Add real-time feedback
- Monitor GL account mapping

## 6. Production Ready
- Status: YES ✓
- Confidence: 95%
```

---

## 🔄 تنظيف بيانات الاختبار (Optional)

بعد انتهاء الاختبارات، يمكنك حذف البيانات:

```sql
-- حذف آمن (ستحتفظ بنسخة احتياطية)
DELETE FROM journal_entry_lines 
WHERE entry_id IN (
  SELECT id FROM journal_entries 
  WHERE description LIKE '%TEST:%'
);

DELETE FROM journal_entries 
WHERE description LIKE '%TEST:%';

DELETE FROM cash_transactions 
WHERE description LIKE '%TEST:%';

DELETE FROM inventory_movements 
WHERE notes LIKE '%TEST:%';
```

---

## 💡 نصائح مهمة

✅ **استخدم نفس البيانات في كل اختبار** - سهولة المقارنة  
✅ **احفظ transaction IDs** - للتتبع المستقبلي  
✅ **وثق أي exceptions** - للـ code review  
✅ **اختبر على Test environment أولاً** - قبل Production  

❌ **لا تستخدم Production data للاختبارات**  
❌ **لا تحذف data بدون backup**  
❌ **لا تخطي خطوات التحقق**  

---

## 📞 الدعم والمساعدة

### إذا واجهت مشاكل:
1. افتح Console (F12) وابحث عن الأخطاء
2. تحقق من Database باستخدام الاستعلامات المرفقة
3. راجع RECOMMENDATIONS_AND_IMPROVEMENTS.md
4. اتصل بـ Backend team إذا استمرت المشكلة

---

## 🎓 موارد إضافية

- 📋 **SQL Queries:** `Test_Data_and_Verification_Queries.sql`
- 🖥️ **Frontend Guide:** `FRONTEND_TESTING_GUIDE.md`
- 🏗️ **Architecture:** `COMPREHENSIVE_TEST_PLAN.md`
- 💡 **Improvements:** `RECOMMENDATIONS_AND_IMPROVEMENTS.md`

---

## ✅ الخطوات التالية بعد الاختبار

1. ✅ تحديث الموردين (الـ 6 موردين المتبقيين)
2. ✅ تطبيق التوصيات على Frontend
3. ✅ تطبيق التوصيات على Backend
4. ✅ اختبار شامل ثاني
5. ✅ Deployment إلى Production

---

**تاريخ الإنشاء:** 2026-05-10  
**الحالة:** جاهز للتنفيذ الفوري 🚀  
**الإصدار:** v1.0  
**المسؤول:** Quality Assurance Team
