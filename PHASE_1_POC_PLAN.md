# 🧪 Phase 1: Proof of Concept (POC)

## 🎯 الهدف
اختبار النظام الحالي مع **عينة صغيرة** من البيانات الحقيقية قبل اتخاذ أي قرارات كبيرة

---

## ⏱️ المدة المتوقعة
**2-3 أيام** (بدل 3-4 أسابيع للـ Full Migration)

---

## 📋 الخطوات التفصيلية

### **Step 1: اختيار عينة صغيرة** (30 دقيقة)

من ملفات Excel، اختار:
- ✅ **3 موردين** (مورد محلي، مورد مستورد، عميل)
- ✅ **5 أصناف** (صنف من كل فئة: أسمدة، بذور، معدات، إلخ)
- ✅ **1 مخزن**
- ✅ **10 معاملات** (5 فواتير مشتريات + 5 دفعات)

**السبب**: عينة صغيرة = سهل التتبع، سهل التراجع، سريع التنفيذ

---

### **Step 2: إعداد Posting Groups للعينة** (1 ساعة)

#### 2.1 تحديد الـ Posting Groups المناسبة

بناءً على تحليل بياناتك:

**Business Posting Groups:**
```javascript
[
  { code: 'LOCAL', name: 'موردين محليين' },
  { code: 'IMPORT', name: 'موردين مستوردين' },
  { code: 'CUSTOMER', name: 'عملاء' }
]
```

**Product Posting Groups:**
```javascript
[
  { code: 'FERT', name: 'أسمدة' },
  { code: 'SEED', name: 'بذور' },
  { code: 'EQUIP', name: 'معدات' }
]
```

**Inventory Posting Groups:**
```javascript
[
  { code: 'MAIN-WH', name: 'المخزن الرئيسي' }
]
```

#### 2.2 إنشاء Posting Setup

**General Posting Setup** (3 تركيبات فقط):
```javascript
[
  // LOCAL × FERT
  {
    bus_posting_group_code: 'LOCAL',
    prod_posting_group_code: 'FERT',
    purchases_account: '5001',  // مشتريات أسمدة
    sales_account: '4001',      // مبيعات أسمدة
    cogs_account: '5101',       // تكلفة البضاعة
  },
  
  // LOCAL × SEED
  {
    bus_posting_group_code: 'LOCAL',
    prod_posting_group_code: 'SEED',
    purchases_account: '5002',
    sales_account: '4002',
    cogs_account: '5102',
  },
  
  // Catch-all (NULL × NULL)
  {
    bus_posting_group_code: null,
    prod_posting_group_code: null,
    purchases_account: '5999',
    sales_account: '4999',
    cogs_account: '5199',
  }
]
```

**Inventory Posting Setup** (1 تركيبة فقط):
```javascript
[
  {
    inv_posting_group_code: 'MAIN-WH',
    prod_posting_group_code: 'FERT',
    inventory_account: '1301',  // مخزون أسمدة
  }
]
```

#### 2.3 تشغيل السكريبت

```bash
# استخدم السكريبت اللي عملناه
node migration_scripts/01_setup_posting_groups.js
```

---

### **Step 3: إدخال البيانات الأساسية** (1 ساعة)

#### 3.1 إدخال الموردين (3 موردين)

```javascript
// مثال: مورد محلي
POST /api/suppliers
{
  "code": "20300086",
  "name": "عيد شعبان-لودر",
  "type": "supplier",
  "bus_posting_group": "LOCAL",  // ← المفتاح
  "gl_account": "3001"
}

// مثال: عميل
POST /api/suppliers
{
  "code": "20900151",
  "name": "جهاز مستقبل مصر",
  "type": "customer",
  "bus_posting_group": "CUSTOMER",
  "gl_account": "3002"
}
```

#### 3.2 إدخال الأصناف (5 أصناف)

```javascript
POST /api/items
{
  "code": "FERT-001",
  "name": "حمض فسفوريك",
  "unit": "كجم",
  "prod_posting_group": "FERT",  // ← المفتاح
  "unit_cost": 50
}
```

#### 3.3 إدخال المخزن (1 مخزن)

```javascript
POST /api/warehouses
{
  "code": "WH-MAIN",
  "name": "المخزن الرئيسي",
  "inv_posting_group": "MAIN-WH"  // ← المفتاح
}
```

---

### **Step 4: اختبار Posting Engine** (2 ساعة)

#### 4.1 تفعيل الـ Engine

```sql
UPDATE system_config 
SET config_value = '1' 
WHERE config_key = 'posting_engine';
```

#### 4.2 إنشاء معاملة تجريبية

**Test Case 1: فاتورة مشتريات**

```javascript
POST /api/supplier-invoices
{
  "supplier_code": "20300086",
  "date": "2025-01-15",
  "amount": 5000,
  "items": [
    {
      "item_code": "FERT-001",
      "quantity": 100,
      "unit_price": 50
    }
  ]
}
```

**المتوقع**: النظام يُنشئ قيد تلقائي:
```
Dr. 5001 (مشتريات أسمدة)     5,000
Dr. 1301 (مخزون أسمدة)        5,000
    Cr. 3001 (موردون محليون)      10,000
```

#### 4.3 التحقق من القيد

```bash
GET /api/gl/entries?ref_type=supplier_invoice

# يجب أن يظهر القيد المُنشأ تلقائياً
```

#### 4.4 مراجعة Trial Balance

```bash
GET /api/gl/trial-balance

# يجب أن يكون متوازن:
# Debit = Credit
```

---

### **Step 5: تقييم النتائج** (1 ساعة)

#### ✅ **إذا نجح الاختبار:**

**الأسئلة:**
1. هل القيود صحيحة؟
2. هل الحسابات المستخدمة مناسبة؟
3. هل الـ UX واضح؟
4. هل فيه أخطاء أو warnings؟

**القرار:**
- ✅ **إذا كل شيء تمام**: أكمل مع باقي البيانات (Phase 2)
- ⚠️ **إذا فيه مشاكل صغيرة**: اضبطها وأعد الاختبار
- ❌ **إذا فيه مشاكل كبيرة**: راجع الاستراتيجية

#### ❌ **إذا فشل الاختبار:**

**الأسئلة:**
1. إيه المشكلة بالضبط؟
2. هل المشكلة في الـ Posting Groups؟
3. هل المشكلة في الكود؟
4. هل المشكلة في البيانات؟

**القرار:**
- 🔧 **إذا مشكلة في الكود**: اصلحها
- 📊 **إذا مشكلة في الـ Setup**: اضبط الـ Posting Groups
- 📝 **إذا مشكلة في البيانات**: نظف البيانات

---

## 📊 Checklist

### قبل البدء
- [ ] Backup كامل للنظام
- [ ] اختيار العينة (3 موردين، 5 أصناف، 10 معاملات)
- [ ] مراجعة شجرة الحسابات

### أثناء التنفيذ
- [ ] إنشاء Posting Groups
- [ ] إنشاء Posting Setup
- [ ] Health Check (is_ready = true)
- [ ] إدخال البيانات الأساسية
- [ ] تفعيل Posting Engine
- [ ] إنشاء معاملة تجريبية
- [ ] التحقق من القيد

### بعد الانتهاء
- [ ] مراجعة Trial Balance
- [ ] مراجعة Journal Entries
- [ ] Integrity Check
- [ ] تقييم النتائج
- [ ] توثيق الملاحظات

---

## 🎯 Success Criteria

**POC ناجح إذا:**
1. ✅ القيود تُنشأ تلقائياً
2. ✅ الحسابات صحيحة
3. ✅ Trial Balance متوازن
4. ✅ لا توجد integrity errors
5. ✅ الـ UX واضح ومفهوم

**POC فاشل إذا:**
1. ❌ القيود لا تُنشأ
2. ❌ الحسابات خاطئة
3. ❌ Trial Balance غير متوازن
4. ❌ توجد integrity errors
5. ❌ الـ UX مربك

---

## 🚀 الخطوة التالية

### إذا نجح الـ POC:
➡️ **Phase 2**: توسيع النطاق (Scale Up)
- إضافة باقي الموردين (29 مورد)
- إضافة باقي الأصناف (4,839 صنف)
- إضافة باقي المعاملات (50,000 معاملة)

### إذا فشل الـ POC:
➡️ **Phase 1.5**: إصلاح المشاكل
- تحديد السبب الجذري
- إصلاح الكود/Setup
- إعادة الاختبار

---

## 💡 لماذا POC أولاً؟

### المميزات:
1. ✅ **سريع**: 2-3 أيام بدل 3-4 أسابيع
2. ✅ **آمن**: عينة صغيرة = سهل التراجع
3. ✅ **تعليمي**: تفهم النظام قبل الالتزام
4. ✅ **واقعي**: تكتشف المشاكل مبكراً
5. ✅ **مرن**: تقدر تغير الاستراتيجية بسهولة

### البديل (Full Migration مباشرة):
1. ❌ **بطيء**: 3-4 أسابيع
2. ❌ **خطر**: صعب التراجع
3. ❌ **أعمى**: تكتشف المشاكل متأخر
4. ❌ **جامد**: صعب تغيير الاستراتيجية

---

## 📝 ملاحظات مهمة

### 1. لا تحذف البيانات الديمو بعد
- ممكن تحتاجها للمقارنة
- احذفها بعد نجاح الـ POC

### 2. استخدم بيئة تجريبية
- لا تختبر على Production
- استخدم Local D1 أو Dev Environment

### 3. وثّق كل حاجة
- اكتب الملاحظات
- صوّر screenshots
- سجّل المشاكل

### 4. لا تستعجل
- خد وقتك في الفهم
- اسأل لو مش فاهم حاجة
- الدقة أهم من السرعة

---

**تم إعداد هذه الوثيقة بواسطة**: Kiro AI  
**التاريخ**: 27 أبريل 2026  
**الإصدار**: 1.0
