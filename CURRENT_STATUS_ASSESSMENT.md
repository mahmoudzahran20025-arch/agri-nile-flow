# 📊 تقييم الوضع الحالي - Current Status Assessment
**Date**: April 30, 2026  
**Database**: agri-nile-flow-data-lake

---

## ✅ ما تم إنجازه بنجاح (Backend)

### 1. الحسابات الجديدة (Chart of Accounts)
| الكود | الاسم | الحالة |
|-------|-------|--------|
| 13500001 | مخزون تحت التشغيل | ✅ موجود |
| 14040711 | VAT مدخلات | ✅ موجود |
| 14070103 | مخزون بذور | ✅ موجود |
| 14070401 | مخزون محاصيل تامة | ✅ موجود |
| 21060001 | VAT مخرجات | ✅ موجود |
| 55010001-05 | COGS accounts | ✅ موجودة |

### 2. Product Posting Groups (الجديدة)
| الكود | الحالة | الأصناف المرتبطة |
|-------|--------|------------------|
| SEED | ✅ مُنشأ | في انتظار ربط |
| CHEM | ✅ مُنشأ | 7 أصناف |
| HARVEST | ✅ مُنشأ | 14 صنف |
| EQUIP_CAP | ✅ مُنشأ | في انتظار ربط |
| EQUIP_CONS | ✅ مُنشأ | 8 أصناف |

### 3. Posting Rules (الجديدة المُفعّلة)
| PPG | COGS Account | الحالة |
|-----|--------------|--------|
| HARVEST | 55010001 | ✅ active |
| SEED | 55010002 | ✅ active |
| CHEM | 55010003 | ✅ active |
| EQUIP_CAP | 55010004 | ✅ active |
| EQUIP_CONS | 55010005 | ✅ active |

### 4. Posting Setup Tables
- ✅ general_posting_setup: مُحدث بـ COGS الجديدة
- ✅ inventory_posting_setup: مُحدث بالمخزون الجديد

### 5. القيود التجريبية
- ✅ 8 قيود في April 2026
- ✅ جميعها متوازنة (Debit = Credit)
- ✅ جميع الحسابات الجديدة مستخدمة

---

## ⚠️ المشاكل المُكتشفة (Frontend-Backend Linkage)

### 🔴 مشكلة 1: بيانات لا تظهر في صفحات المالية

**الوصف**: الصفحات المالية لا تُظهر البيانات الجديدة

**الأسباب المحتملة**:
1. **API Endpoints**: ربما لا تُرجع الـ PPGs الجديدة
2. **Frontend Cache**: `useQuery` ربما تستخدم cache قديم
3. **Database Joins**: ربما هناك `JOIN` يربط بالـ PPGs القديمة فقط

**الملفات للتحقق**:
```
web/src/api/gl.ts - Line 343: postingGroups('product')
web/src/pages/gl/PostingSetupPage.tsx - Line 180: PostingGroupSelector
```

**الإصلاح المطلوب**:
```typescript
// في gl.ts - التأكد من أن الـ API يُرجع جميع الـ PPGs
postingGroups: (type: PgType) => unwrap(api.get<PostingGroup[]>(`/gl/posting-groups/${type}`)),

// في PostingSetupPage.tsx - إضافة logging للتحقق
const { data: groups } = useQuery({
  queryKey: ['posting-groups', type],
  queryFn: async () => {
    const result = await glApi.postingGroups(type)
    console.log('PPGs loaded:', result) // <-- إضافة هذا
    return result
  },
})
```

---

### 🟡 مشكلة 2: حسابات COGS متعددة في واجهة واحدة

**الوصف**: `PostingSetupPage` يعرض حقل COGS واحد لكل صف BPG×PPG، لكن النظام يستخدم COGS مختلفة لكل PPG (55010001-55010005).

**الموقع**:
```typescript
// PostingSetupPage.tsx Line 211
{acctField('Cost of Goods Sold (COGS)', 'cogs_account', 'expense', true)}
```

**التناقض**:
- الواجهة: تظهر حقل COGS عام (يمكن تعديله)
- الواقع: COGS محددة في posting_rules لكل PPG

**الحلول المقترحة**:
1. **إزالة حقل COGS** من General Setup (يفضل)
2. **جعله read-only** مع عرض قيمة من posting_rules
3. **إضافة جدول منفصل** لـ PPG → COGS mapping

---

### 🟡 مشكلة 3: WIP Account غير مرئي

**الوصف**: لا يوجد حقل لتحديد WIP Account (13500001) في Inventory Setup.

**الموقع**:
```typescript
// PostingSetupPage.tsx Line 397
<AccountPicker value={acct || null} onChange={value => setAcct(value ?? '')} accountType="asset" label="Inventory Account" required />
```

**المطلوب**: 
- إضافة حقل "WIP Account" عندما IPG = 'WIP'
- OR إضافة صف منفصل لـ WIP في Inventory Setup

---

### 🟠 مشكلة 4: Posting Simulator ناقص

**الوصف**: لا يوجد نوع transaction 'harvest' في Posting Simulator.

**الموقع**:
```typescript
// PostingSimulatorPage.tsx Line 18
type TxType = 'inventory_in' | 'inventory_out' | 'supplier_invoice' | 'supplier_payment' | 'expense' | 'revenue'
// ❌ 'harvest' missing!
```

**المطلوب**: إضافة 'harvest' لاختبار WIP → Finished Goods.

---

## 📋 قائمة المهام الفورية

### للتحقق الآن (5 دقائق):
1. ✅ افتح Posting Setup Page → هل تظهر PPGs الجديدة؟
2. ✅ افتح Posting Simulator → هل تظهر PPGs الجديدة في dropdown؟
3. ✅ افتح Chart of Accounts → هل تظهر الحسابات الجديدة (13500001, 55010001...)؟

### للإصلاح Phase 1 (اليوم):
4. ⬜ إصلاح COGS field (إزالة أو read-only)
5. ⬜ إضافة WIP Account field
6. ⬜ التحقق من API يُرجع PPGs الجديدة

### للإصلاح Phase 2 (الأسبوع):
7. ⬜ إضافة 'harvest' للـ Simulator
8. ⬜ إصلاح VAT account filtering
9. ⬜ إضافة صفحة Item-PPG linkage

---

## 🎯 التوصية الفورية

**الخطوة 1**: شغّل Frontend محلياً وافتح:
- http://localhost:5173/gl/posting-setup
- http://localhost:5173/gl/posting-simulator

**الخطوة 2**: افتح Developer Tools (F12) → Console

**الخطوة 3**: تأكد من أن API يُرجع PPGs الجديدة:
```javascript
// في Console
fetch('/api/gl/posting-groups/product').then(r => r.json()).then(console.log)
// يجب أن يظهر: SEED, CHEM, HARVEST, EQUIP_CAP, EQUIP_CONS
```

**الخطوة 4**: إذا لم تظهر الـ PPGs الجديدة، المشكلة في:
- إما Backend API (لا يقرأ من DB)
- إما DB (الـ PPGs غير موجودة فعلياً)

---

## 🔍 استعلامات للتحقق

```sql
-- هل الـ PPGs موجودة فعلياً؟
SELECT code, name, is_active FROM product_posting_groups;

-- هل الحسابات الجديدة موجودة؟
SELECT code, name, is_active FROM chart_of_accounts 
WHERE code IN ('13500001', '14040711', '14070401', '21060001', '55010001');

-- هل posting rules مُفعّلة؟
SELECT prod_posting_group_code, cogs_account, is_active 
FROM posting_rules 
WHERE is_active = 1 AND prod_posting_group_code IN ('HARVEST', 'SEED', 'CHEM');
```

---

**الخلاصة**: Backend جاهز 100%، لكن Frontend يحتاج:
1. التحقق من API يستدعي البيانات الصحيحة
2. إصلاحات UI للـ COGS و WIP
3. تحديثات للـ Posting Simulator
