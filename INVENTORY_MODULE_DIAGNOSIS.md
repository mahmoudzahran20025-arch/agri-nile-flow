# 🔍 تشخيص مشكلة موديول المخزون

**التاريخ**: 2026-04-27  
**المشكلة**: لا تظهر أي بيانات في صفحة أرصدة المخازن

---

## 📊 الوضع الحالي

### **قاعدة البيانات** ✅
```
✅ inventory_movements: 654 حركة
✅ items: 63 صنف
✅ warehouses: 9 مخازن
✅ البيانات موجودة!
```

### **الواجهة** ❌
```
❌ صفحة أرصدة المخازن فاضية
❌ رسالة: "لا توجد أرصدة مخزنية"
❌ "أضف حركة مخزنية لتظهر هنا"
```

---

## 🔍 التحليل

### **المشكلة المحتملة #1: API Endpoint**
```typescript
// Frontend يستدعي:
GET /api/inventory/balances

// Backend يجب أن يرجع:
[
  {
    item_code: 1010002,
    item_name: "حمض فسفوريك",
    warehouse: "FERT-WH",
    balance_qty: 6225,
    balance_value: 312500,
    unit: "كيس"
  },
  ...
]
```

**السبب المحتمل:**
- API لا يرجع بيانات
- API يرجع format خاطئ
- API يحتاج authentication
- API يفلتر بـ company_id خاطئ

---

### **المشكلة المحتملة #2: حساب الأرصدة**
```sql
-- Backend يحسب الأرصدة من inventory_movements
SELECT 
  item_code,
  warehouse,
  SUM(CASE WHEN movement_type = 'in' THEN quantity ELSE -quantity END) as balance_qty
FROM inventory_movements
WHERE company_id = 1
GROUP BY item_code, warehouse
HAVING balance_qty > 0
```

**السبب المحتمل:**
- movement_type غير صحيح (كلها 'اضافة' بدلاً من 'in'/'out')
- الحساب خاطئ
- GROUP BY خاطئ

---

### **المشكلة المحتملة #3: Frontend Logic**
```typescript
// الكود الحالي:
const { data: balances, isLoading } = useQuery({
  queryKey: ['inventory', 'balances', activeWarehouse],
  queryFn: () => inventoryApi.balances(activeWarehouse ?? undefined)
})

// إذا balances = []
// يظهر: "لا توجد أرصدة مخزنية"
```

**السبب المحتمل:**
- API يرجع []
- Query key خاطئ
- Cache issue

---

## 🎯 خطة التشخيص

### **Step 1: فحص Backend API** (5 min)
```bash
# Test the API endpoint directly
curl https://agri-nile-flow.mahm-zahran22.workers.dev/api/inventory/balances

# Expected: Array of balance objects
# Actual: ???
```

### **Step 2: فحص حساب الأرصدة** (10 min)
```sql
-- Check if balances calculation works
SELECT 
  item_code,
  warehouse,
  movement_type,
  SUM(quantity) as total_qty
FROM inventory_movements
WHERE company_id = 1
GROUP BY item_code, warehouse, movement_type
LIMIT 10;

-- Check movement types
SELECT DISTINCT movement_type 
FROM inventory_movements 
WHERE company_id = 1;
```

### **Step 3: فحص Frontend** (5 min)
```typescript
// Add console.log to see what's returned
console.log('Balances:', balances)
console.log('Is Loading:', isLoading)
console.log('Grouped:', grouped)
```

---

## 🔧 الحلول المحتملة

### **Solution 1: إصلاح Backend API**
```typescript
// في src/api/inventory.ts (backend)
// تأكد من:
1. API يرجع البيانات الصحيحة
2. Format صحيح
3. company_id filter صحيح
4. حساب الأرصدة صحيح
```

### **Solution 2: إصلاح movement_type**
```sql
-- إذا كل الحركات 'اضافة'
-- نحتاج نحدد in/out بناءً على logic آخر

UPDATE inventory_movements
SET movement_type = CASE
  WHEN movement_type LIKE '%اضافة%' OR movement_type LIKE '%وارد%' THEN 'in'
  WHEN movement_type LIKE '%صرف%' OR movement_type LIKE '%صادر%' THEN 'out'
  ELSE movement_type
END
WHERE company_id = 1;
```

### **Solution 3: إنشاء View للأرصدة**
```sql
-- Create a view for easy balance calculation
CREATE VIEW IF NOT EXISTS inventory_balances AS
SELECT 
  im.company_id,
  im.item_code,
  i.name as item_name,
  i.unit,
  im.warehouse,
  SUM(CASE 
    WHEN im.movement_type IN ('in', 'اضافة', 'وارد') THEN im.quantity
    ELSE -im.quantity
  END) as balance_qty,
  SUM(CASE 
    WHEN im.movement_type IN ('in', 'اضافة', 'وارد') THEN im.quantity * COALESCE(im.unit_price, 0)
    ELSE -im.quantity * COALESCE(im.unit_price, 0)
  END) as balance_value
FROM inventory_movements im
LEFT JOIN items i ON i.code = im.item_code AND i.company_id = im.company_id
GROUP BY im.company_id, im.item_code, i.name, i.unit, im.warehouse
HAVING balance_qty > 0;
```

---

## 🚀 الإجراء الفوري

**أولاً: نحتاج نعرف السبب الحقيقي!**

سأنشئ سكربت تشخيص:

```javascript
// diagnose_inventory.js
// 1. Query database for movements
// 2. Calculate balances manually
// 3. Compare with API response
// 4. Identify the issue
```

---

**Created by**: Kiro AI  
**Date**: 2026-04-27  
**Status**: DIAGNOSIS IN PROGRESS
