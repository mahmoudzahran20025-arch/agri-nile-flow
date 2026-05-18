# 🔍 مشاكل المخزون والتحليلات - Inventory & Analytics Issues
**Date**: April 30, 2026  
**Status**: تحقق من الربط بين Frontend و Backend

---

## ⚠️ المشاكل المُكتشفة في المخزون

### 1. 🚨 مشكلة رئيسية: InventoryPostingHealthPage لا تُظهر البيانات الجديدة

**الملف**: `web/src/pages/inventory/InventoryPostingHealthPage.tsx`

**الوصف**: الصفحة تستدعي `/inventory/posting-health` وتتوقع البيانات:
- `warehouse` - اسم المخزن
- `ipg` - Inventory Posting Group
- `ppg` - Product Posting Group

**المشاكل المحتملة**:

#### أ) Backend API قد لا يُرجع PPGs الجديدة
```typescript
// inventory.ts Line 133-152
postingHealth: () => unwrap(api.get<{
  data: Array<{
    warehouse: string
    ipg: string | null
    ppg: string | null  // ← قد يكون NULL أو قديم
    ...
  }
}>('/inventory/posting-health')),
```

**التحقق المطلوب**:
```sql
-- هل الـ API يقرأ من الـ items الحقيقية؟
SELECT DISTINCT 
  i.posting_group_code as ppg,
  ipg.code as ipg,
  COUNT(*) as cnt
FROM items i
LEFT JOIN inventory_posting_groups ipg ON i.inv_posting_group_code = ipg.code
WHERE i.company_id = 1
GROUP BY i.posting_group_code, ipg.code
ORDER BY ppg;
```

---

### 2. 🟡 مشكلة: ItemMasterPage لا تُظهر PPGs الجديدة في الفلاتر

**الملف**: `web/src/pages/inventory/ItemMasterPage.tsx` (Line 232-236)

```typescript
const allPpg = useMemo(() => {
  const set = new Set<string>()
  items.forEach(i => { if (i.prod_posting_group_code) set.add(i.prod_posting_group_code) })
  return Array.from(set).sort()
}, [items])
```

**المشكلة**: `allPpg` يُنشأ من الـ items الموجودة، لكن إذا كانت الـ items لا تحمل PPGs الجديدة، لن تظهر في الفلتر.

**السبب المحتمل**:
- الـ API `/inventory/items-master` لا يُرجع `prod_posting_group_code` بشكل صحيح
- أو الـ items لم تُربط بالـ PPGs الجديدة

**التحقق**:
```sql
-- هل الـ items تحمل PPGs الجديدة؟
SELECT 
  posting_group_code,
  COUNT(*) as cnt
FROM items 
WHERE company_id = 1
GROUP BY posting_group_code
ORDER BY cnt DESC;
```

---

### 3. 🟠 مشكلة: GL Preview لا يتعرف على الـ Accounts الجديدة

**الملف**: `web/src/api/inventory.ts` (Line 83-107)

```typescript
glPreview: (body: {
  warehouse: string
  item_code: number
  movement_type: 'اضافة' | 'صرف'
  ...
}) => unwrap(api.post<{
  lines: Array<{
    side: 'DR' | 'CR'
    account_code: string   // ← هل تُرجع 13500001, 55010001؟
    account_label: string
    amount: number
    narration: string
  }>
}>('/inventory/gl-preview', body)),
```

**المشكلة**: إذا كانت الـ API تستخدم posting rules القديمة، ستُرجع:
- `61110101` (COGS القديم) بدلاً من `55010001`
- `13500001` (WIP) قد لا يُستخدم

**التحقق المطلوب**:
1. افتح Posting Simulator
2. اختبر حركة "إضافة" لمخزون مع PPG = HARVEST
3. تحقق من الحسابات المُستخدمة في القيد

---

### 4. 🟡 مشكلة: الصفحات لا تُظهر "لا توجد بيانات" بشكل صحيح

**الملف**: `InventoryPostingHealthPage.tsx` (Line 130-133)

```typescript
{isLoading ? (
  <div className="p-12 text-center text-slate-400 animate-pulse">جاري التحميل...</div>
) : health.length === 0 ? (
  <div className="p-12 text-center text-slate-400">لا توجد حركات مخزنية بعد</div>
) : (
```

**المشكلة**: إذا كان الـ API يُرجع `data: []` (مصفوفة فارغة)، ستظهر الرسالة "لا توجد حركات مخزنية بعد" حتى لو كانت الحركات موجودة في قاعدة البيانات.

**السبب**: ربما الـ Backend لا يقرأ من الـ tables الصحيحة أو يوجد خطأ في الـ JOIN.

---

## 📊 مشاكل التحليلات والتقارير

### 5. 🚨 مشكلة: Analytics Dashboard قد تستخدم بيانات قديمة

**الملفات المحتملة**: (لم يتم قراءتها بعد)
- `web/src/pages/analytics/*`
- `web/src/pages/reports/*`

**المشكلة**: إذا كانت الـ Dashboards تحسب:
- تكلفة المخزون
- قيمة المخزون
- حركات المخزون

باستخدام الـ accounts القديمة (`61110101`...)، فإن التحليلات ستكون **خاطئة**.

---

## 🧪 خطوات التحقق الفورية

### 1. تحقق من API - Items Master
```javascript
// في Browser Console
fetch('/api/inventory/items-master')
  .then(r => r.json())
  .then(data => {
    console.log('Total items:', data.length);
    const ppgCounts = {};
    data.forEach(i => {
      const ppg = i.prod_posting_group_code || 'NULL';
      ppgCounts[ppg] = (ppgCounts[ppg] || 0) + 1;
    });
    console.log('PPG Distribution:', ppgCounts);
    // يجب أن يظهر: HARVEST, SEED, CHEM, EQUIP_CAP, EQUIP_CONS
  });
```

**إذا لم يظهر PPGs الجديدة** → المشكلة في:
- Backend API لا يُرجع `posting_group_code` من DB
- OR: الـ items لم تُربط بالـ PPGs الجديدة

---

### 2. تحقق من API - Posting Health
```javascript
fetch('/api/inventory/posting-health')
  .then(r => r.json())
  .then(data => {
    console.log('Summary:', data.summary);
    console.log('First 5 combos:', data.data.slice(0, 5));
    // تحقق من وجود PPGs الجديدة في data.data
    const ppgs = new Set(data.data.map(d => d.ppg).filter(Boolean));
    console.log('PPGs in health data:', Array.from(ppgs));
  });
```

**إذا لم يظهر PPGs الجديدة** → المشكلة في:
- Backend API لا يقرأ من `inventory_movements` مع `posting_group_code` الصحيح
- OR: الـ `inventory_movements` لا تحمل PPGs الجديدة

---

### 3. تحقق من API - GL Preview
```javascript
fetch('/api/inventory/gl-preview', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    warehouse: 'MAIN',
    item_code: 1001, // ← استبدل بصنف حقيقي
    movement_type: 'صرف',
    quantity: 10,
    unit_price: 100
  })
})
.then(r => r.json())
.then(data => {
  console.log('GL Preview lines:', data.lines);
  // تحقق من الحسابات المُستخدمة
  data.lines.forEach(l => {
    console.log(`${l.side}: ${l.account_code} - ${l.account_label}`);
  });
});
```

**إذا ظهرت حسابات قديمة (61110101)** → المشكلة في:
- Backend يستخدم posting rules القديمة
- OR: Posting Setup غير مُحدث

---

## 🔴 التشخيص الأولي

| # | المشكلة | الاحتمال الأكبر | الأثر |
|---|---------|-----------------|-------|
| 1 | PPGs الجديدة لا تظهر في صفحات المخزون | Backend API لا يقرأ من items.posting_group_code | ❌ مستخدمون لا يستطيعون رؤية الـ PPGs الصحيحة |
| 2 | COGS القديم يُستخدم | Posting rules القديمة لا تزال active | ❌ قيود محاسبية خاطئة |
| 3 | تحليلات المخزون خاطئة | Analytics تستخدم accounts قديمة | ❌ قرارات مالية خاطئة |
| 4 | Inventory Health يُظهر "لا توجد بيانات" | Backend API query خاطئة | ❌ لا يوجد visibility على مشاكل المخزون |

---

## 🎯 خطة الإصلاح المُقترحة

### Phase 1: التحقق (30 دقيقة)
1. ✅ شغّل الـ 3 استعلامات JavaScript أعلاه في Console
2. ✅ قارن النتائج مع قاعدة البيانات
3. ✅ حدد إذا كانت المشكلة في Frontend أو Backend

### Phase 2: إصلاح Backend APIs (إذا لزم الأمر)
4. ⬜ تحديث `/inventory/items-master` ليُرجع `posting_group_code`
5. ⬜ تحديث `/inventory/posting-health` ليستخدم PPGs الجديدة
6. ⬜ تحديث `/inventory/gl-preview` ليستخدم posting rules الجديدة

### Phase 3: إصلاح Frontend (إذا لزم الأمر)
7. ⬜ تحديث `InventoryPostingHealthPage.tsx` لعرض PPGs الجديدة
8. ⬜ تحديث `ItemMasterPage.tsx` لتحديث الفلاتر
9. ⬜ التحقق من Analytics Dashboards

---

**هل تريد أن أبدأ بالتحقق من الـ Backend APIs الآن؟**
