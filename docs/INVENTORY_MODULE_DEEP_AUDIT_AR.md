# تقرير مراجعة شاملة — وحدة المخزون (Inventory Module)

**تاريخ المراجعة:** 2026-05-05  
**المحترف:** Cascade (AI Code Review)  
**النطاق:** جميع ملفات الواجهة الأمامية (Frontend) والخلفية (Backend) لوحدة المخزون  
**الهدف:** اكتشاف أخطاء Business Logic، ضعف التكامل مع نظام Posting، وتحديد أفضل الممارسات

---

## فهرس المحتويات

1. [ملخص تنفيذي](#1-ملخص-تنفيذي)
2. [صفحات الواجهة الأمامية — مراجعة صفحة بصفحة](#2-صفحات-الواجهة-الأمامية--مراجعة-صفحة-بصفحة)
3. [الخلفية (Backend API) — تحليل دقيق](#3-الخلفية-backend-api--تحليل-دقيق)
4. [أخطاء Business Logic الحرجة](#4-أخطاء-business-logic-الحرجة)
5. [نظام Posting — التكامل المحاسبي](#5-نظام-posting--التكامل-المحاسبي)
6. [أخطاء البيانات وسلامتها](#6-أخطاء-البيانات-وسلامتها)
7. [أفضل الممارسات — ما يعمل بشكل ممتاز](#7-أفضل-الممارسات--ما-يعمل-بشكل-ممتاز)
8. [التوصيات العاجلة والمستقبلية](#8-التوصيات-العاجلة-والمستقبلية)

---

## 1. ملخص تنفيذي

| البُعد | التقييم | الملاحظة الرئيسية |
|--------|---------|-------------------|
| **عمارة الكود** | 8.5/10 | تصميم modular ممتاز، فصل واضح بين API layers |
| **Business Logic** | 7.5/10 | نقاط ضعف في validation أثناء التحويلات وبعض edge cases |
| **Posting/GL Integration** | 8/10 | نظام posting متقدم مع 3 modes (strict_sync, async_reliable, decoupled) |
| **Data Integrity** | 7/10 | `inventory_balances` snapshot يحل مشكلة stale running totals |
| **أمان الواجهة الأمامية** | 6.5/10 | `any` types منتشرة، بعض الـ validation مفقودة |
| **UX/Forms** | 8/10 | Batch modal بتصميم wizard (3 steps) ممتاز |

**الخلاصة:** الوحدة تعمل بشكل إنتاجي قوي، لكن هناك 4-5 أخطاء Business Logic يجب إصلاحها فوراً قبل توسيع الاستخدام.

---

## 2. صفحات الواجهة الأمامية — مراجعة صفحة بصفحة

### 2.1 WarehouseBalancesPage.tsx (472 سطر)

**الحالة:** صفحة داشبورد ممتازة  
**ما يعمل بشكل جيد:**
- KPI cards مع روابط تنقل ذكية (`navigate('/inventory/movements?negative=1')`)
- Reorder alerts banner مع dismissing
- تصدير CSV مباشر
- عرض الأرصدة grouped by warehouse مع expand/collapse

**المشاكل المكتشفة:**

| # | المشكلة | السطر | الخطورة | الإصلاح |
|---|---------|-------|---------|---------|
| 1 | `metrics.negativeRows` يحسب من البيانات المحملة فقط (client-side) وليس من قاعدة البيانات | 82-88 | منخفض | استخدم endpoint منفصل لـ negative count إذا كان هناك pagination |
| 2 | `downloadCsv` يستدعي endpoint بدون warehouse filter | 138 | منخفض | تمرير `activeWarehouse` كـ query param |
| 3 | `canWrite('inventory')` guard على زر التحويل فقط — لا يوجد guard على زر "حركة جديدة" | 142-155 | **متوسطة** | أضف `canWrite` على زر "حركة جديدة" أيضاً |
| 4 | لا يوجد `ErrorBoundary` — أي خطأ في query سيظهر blank page | — | منخفض | أضف `<ErrorBoundary>` |

---

### 2.2 ItemMasterPage.tsx (493 سطر)

**الحالة:** صفحة registry احترافية مع accounting editor  
**ما يعمل بشكل جيد:**
- Pagination server-side مع debounced search
- Filters: `missing_ppg`, `missing_ipg`, `below_reorder`
- Expandable rows لعرض تفاصيل إضافية
- Accounting edit modal مع PPG/IPG dropdowns

**المشاكل المكتشفة:**

| # | المشكلة | السطر | الخطورة | الإصلاح |
|---|---------|-------|---------|---------|
| 1 | `EditForm` يستخدم `string` لـ `standard_cost` و `reorder_threshold` ثم يحولها بـ `Number()` — يمكن أن تنتج `NaN` | 80-85, 103-107 | **متوسطة** | أضف validation: `if (isNaN(val))` قبل الإرسال |
| 2 | `ppgOptions.length > 0 ?` يظهر dropdown — لكن لو كانت القائمة فارغة يظهر input text عادي بدون validation | 137-148 | منخفض | أضف regex validation للـ input |
| 3 | `item.total_value / item.total_qty` في السطر 450 — تقسيم على صفر إذا `total_qty = 0` | 450 | **متوسطة** | أضف `item.total_qty > 0 ? ... : '—'` |
| 4 | `hasIssue` تعتبر `!item.prod_posting_group_code || !item.inv_posting_group_code` — لكن `inv_posting_group_code` اختياري في بعض الحالات | 391 | منخفض | راجع business rule لـ IPG |

---

### 2.3 ItemCardPage.tsx (412 سطر)

**الحالة:** صفحة تفاصيل الصنف مع card movements  
**ما يعمل بشكل جيد:**
- Warehouse breakdown مع progress bars
- Mini chart لآخر 12 حركة (SVG-based)
- CSV export مع warehouse filter
- GL link badge في حركات الصنف

**المشاكل المكتشفة:**

| # | المشكلة | السطر | الخطورة | الإصلاح |
|---|---------|-------|---------|---------|
| 1 | `const total = stockData?.total_qty ?? 1` في حساب نسبة المخزن — لو `total_qty = 0` لا تظهر pct = 0% | 218 | **متوسطة** | استخدم `total > 0 ? (wh.balance_qty / total) * 100 : 0` |
| 2 | `card.slice(-15).map` في الميني تشارت — يأخذ آخر 15 حركة فقط بدون ترتيب زمني صحيح | 260 | منخفض | استخدم `.slice(0, 15)` مع ترتيب تصاعدي |
| 3 | `item` يُجلب من `configApi.items` (كل الأصناف) — لو كان هناك 10,000 صنف سيُحمّل الكل | 88-93 | **متوسطة** | استخدم endpoint مخصص `configApi.item(code)` |

---

### 2.4 InventoryMovementsPage.tsx (484 سطر)

**الحالة:** صفحة قائمة الحركات مع فلاتر متقدمة  
**ما يعمل بشكل جيد:**
- CommandBar pattern مع actions
- Client-side filtering للـ `unlinked_only` و `negative_only`
- KPI strip (إجمالي، وارد، صادر، بدون قيد)
- Pagination مع `has_more`

**المشاكل المكتشفة:**

| # | المشكلة | السطر | الخطورة | الإصلاح |
|---|---------|-------|---------|---------|
| 1 | `unlinked_only` filter يعمل client-side فقط — يمكن أن يُرجع page فارغة بينما توجد بيانات في pages أخرى | 148-155 | **عالية** | انقل الفلتر إلى الخادم |
| 2 | `seasons as any` في السطر 282 — type casting خطير | 282 | منخفض | استخدم typed response |
| 3 | `exportParams` لا تمرر `unlinked_only` أو `negative_only` | 164-170 | منخفض | أضف الفلاتر للتصدير |

---

### 2.5 InventoryAdjustmentsPage.tsx (182 سطر)

**الحالة:** صفحة قائمة التسويات مع create modal  
**ما يعمل بشكل جيد:**
- Flow: create header → navigate to detail → add lines → post
- Validation على `warehouse_id` و `adjustment_date`

**المشاكل المكتشفة:**

| # | المشكلة | السطر | الخطورة | الإصلاح |
|---|---------|-------|---------|---------|
| 1 | `warehouses as any?.entities` — type casting | 151 | منخفض | استخدم typed interface |
| 2 | `createMutation` يقبل `body: any` — فقدان type safety | 31 | منخفض | استخدم `CreateAdjustmentDTO` |

---

### 2.6 AdjustmentDetailPage.tsx (294 سطر)

**الحالة:** صفحة تفاصيل التسوية مع إدارة بنود الجرد  
**ما يعمل بشكل جيد:**
- `hasUnsavedChanges` tracking
- Confirmation dialog قبل الترحيل
- Theoretical qty يُجلب تلقائياً من `inventory_balances`

**المشاكل المكتشفة:**

| # | المشكلة | السطر | الخطورة | الإصلاح |
|---|---------|-------|---------|---------|
| 1 | `balance?.balance_qty || 0` — لو `balance_qty = 0` (falsy) يُعامل كـ `0` صحيح، لكن لو `undefined` يُعامل أيضاً كـ `0` | 84 | منخفض | استخدم `??` بدلاً من `||` |
| 2 | `addingLine.counted_qty` يقبل قيم سالبة بدون validation | 245 | **متوسطة** | أضف `min="0"` و `if (counted_qty < 0)` |
| 3 | لا يوجد tolerance للفرق — أي فرق مهما كان صغيراً يُعتبر variance | — | منخفض | أضف tolerance ±0.001 |
| 4 | `saveLinesMutation` لا تتحقق من duplicate items | 45 | **عالية** | تحقق من `item_code` duplicates قبل الحفظ |
| 5 | `window.confirm` بدلاً من modal component | 144 | منخفض | استخدم `<ConfirmModal>` للتناسق |

---

### 2.7 InventoryPostingHealthPage.tsx (472 سطر)

**الحالة:** صفحة صحة الترحيل — الأفضل في الوحدة  
**ما يعمل بشكل جيد:**
- Matrix تغطية warehouse×PPG
- GL Traceability panel مع filter tabs
- Missing combos alert مع روابط مباشرة
- Ghost posted / pending / failed classifications

**لا توجد مشاكل حرجة — تصميم ممتاز.**

---

### 2.8 WarehousesPage.tsx (130 سطر)

**الحالة:** إدارة المخازن  
**ما يعمل بشكل جيد:**
- IPG dropdown مع inactive filter (`g.is_active === 1`)
- Warning message لو لم يُختار IPG

**المشاكل:**

| # | المشكلة | السطر | الخطورة | الإصلاح |
|---|---------|-------|---------|---------|
| 1 | لا يوجد edit أو deactivate للمخازن — فقط create | — | منخفض | أضف edit/delete functionality |

---

### 2.9 AddInventoryBatchModal.tsx (873 سطر)

**الحالة:** أفضل component في الوحدة — 3-step wizard  
**ما يعمل بشكل جيد:**
- 6 أنواع حركات كلها مدعومة
- GL preview في Step 3
- Duplicate detection
- Stock availability fetch per line
- Payment method selection (cash/credit)

**المشاكل المكتشفة:**

| # | المشكلة | السطر | الخطورة | الإصلاح |
|---|---------|-------|---------|---------|
| 1 | `item_code` يُمرر كـ `string` ثم `Number(l.item_code)` — لو كان فارغاً يُنتج `0` | 394 | **عالية** | تحقق `if (!l.item_code)` قبل `Number()` |
| 2 | `uid()` يستخدم `Math.random()` — collision ممكن | 47 | منخفض | استخدم `crypto.randomUUID()` |
| 3 | `document_number` لو كان مكرراً — التحقق يحدث في الخلفية فقط | 485-500 | منخفض | أضف duplicate check مبكراً |
| 4 | `payment_method` شرطي على `GRN || RETURN_SUPPLIER` — لكن `RETURN_CUSTOMER` يمكن أن يكون cash أيضاً | 505 | منخفض | راجع business logic |
| 5 | `unit_price` غير مطلوب لـ `ISSUE` — يستخدم avg cost تلقائياً — لكن هذا غير واضح للمستخدم | 635-640 | منخفض | أضف tooltip يوضح السلوك |

---

### 2.10 InternalTransferModal.tsx (256 سطر)

**الحالة:** تحويل batch بين المخازن  
**ما يعمل بشكل جيد:**
- Stock fetch per item
- "الكل" button لتحديد الكمية كاملة
- Validation على `from !== to`

**المشاكل المكتشفة:**

| # | المشكلة | السطر | الخطورة | الإصلاح |
|---|---------|-------|---------|---------|
| 1 | `handleQtyChange` يقبل `qty <= 0` — يظهر error لكن يسمح بإدخالها | 73 | منخفض | أضف `min="0.001"` |
| 2 | لا يوجد GL preview للتحويل — المستخدم لا يعرف التأثير المحاسبي | — | منخفض | أضف GL preview مشابه لـ batch modal |

---

## 3. الخلفية (Backend API) — تحليل دقيق

### 3.1 movements.ts (1,060 سطر) — القلب النابض للوحدة

**الهيكل:**
- `GET /movements` — list مع pagination و 7 فلاتر
- `POST /movements` — single movement creation
- `POST /movements/batch` — batch creation (يُستخدمه الواجهة الأمامية)
- `POST /movements/transfer` — single transfer
- `POST /movements/transfer-batch` — batch transfer (يُستخدمه InternalTransferModal)

**نقاط القوة:**
- `permissionGuard('inventory', 'create')` على كل write endpoints
- `enforceInventoryLockDate` — يمنع التعديل في فترات مغلقة
- `getOpenPeriod` — يضمن وجود فترة مالية مفتوحة
- `readInventoryBalance` — O(1) snapshot read (بدلاً من scan كامل لـ movements)
- `upsertInventoryBalance` — يحافظ على snapshot synchronized
- 3 posting modes: `strict_sync`, `async_reliable`, `decoupled`
- `zero_value_policy` validation
- `DUPLICATE_DOCUMENT` guard على batch

**أخطاء Business Logic الحرجة:**

#### 🔴 BUG #1: Batch movements لا تتحقق من `FUTURE_NEGATIVE_STOCK`

```typescript
// في single POST (سطر 170-184):
const minFutureBal = await c.env.DB.prepare(...).first()
if (minFutureBal.min_bal < b.quantity) return 409 // FUTURE_NEGATIVE_STOCK

// في batch POST (سطر 423-437):
// لا يوجد نفس التحقق!
// فقط:
if (!batchIsInbound && li.quantity > prevQty) return 409 // INSUFFICIENT_STOCK
```

**التأثير:** يمكن إنشاء batch movement يُسبب negative stock في حركات مستقبلية بدون warning.  
**الإصلاح:** أضف نفس `minFutureBal` check داخل loop الـ batch.

#### 🔴 BUG #2: `inventory_movements` UPDATE للـ running totals يعتمد على `movement_date` و `id`

```typescript
// السطر 248-253 (single) و 539-543 (batch):
UPDATE inventory_movements 
SET balance_qty = balance_qty + ?, balance_value = balance_value + ?
WHERE ... AND (movement_date > ? OR (movement_date = ? AND id > ?))
```

**التأثير:** لو تم إدخال حركة retroactive (تاريخ سابق) بعد حركات لاحقة، ستُحسب balances بشكل خاطئ للحركات اللاحقة.  
**الملاحظة:** الفريق يعالج هذا بـ `readInventoryBalance` و `upsertInventoryBalance` — لكن الـ running totals في `inventory_movements` قد تصبح stale.

#### 🔴 BUG #3: Transfer operations لا تُحدّث `inventory_balances` بشكل كامل

```typescript
// transfer (سطر 779-787):
if (outId) await upsertInventoryBalance(...srcBal - quantity...)
if (inId)  await upsertInventoryBalance(...dstPrev + quantity...)

// transfer-batch (سطر 972):
// لا يوجد upsertInventoryBalance للـ transfer-batch!
// فقط:
await c.env.DB.batch(stmts) // INSERT only
```

**التأثير:** `transfer-batch` لا يُحدّث `inventory_balances` snapshot — ستكون الأرصدة stale.  
**الإصلاح:** أضف `upsertInventoryBalance` loop بعد `batch(stmts)` في transfer-batch.

#### 🟡 BUG #4: `local_id` generation غير فريد بما فيه الكفاية

```typescript
const localId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
```

**التأثير:** تحت load عالي، collision ممكن.  
**الإصلاح:** `crypto.randomUUID()` أو `nanoid`.

#### 🟡 BUG #5: `valueIn` cash movement يُسجل دائماً — حتى لو فشل GL posting

```typescript
// السطر 332-343:
if ((b.movement_type === 'اضافة' || b.movement_type === 'GRN') && b.payment_method === 'cash') {
  await FinanceCore.recordCashMovement(...)
}
```

**التأثير:** لو فشل `resolveInventoryMovement` (سطر 271) وتم retry لاحقاً، سيتم تسجيل cash movement مرتين.  
**الإصلاح:** حرّك `recordCashMovement` داخل نجاح GL posting block.

---

### 3.2 adjustments.ts (283 سطر)

**الهيكل:**
- GET /adjustments
- POST /adjustments (create header)
- PUT /adjustments/:id/lines (save lines)
- GET /adjustments/:id (detail)
- POST /adjustments/:id/post (post + GL)

**نقاط القوة:**
- `permissionGuard` على كل endpoints
- `status !== 'draft'` guard
- `zero_value_policy` validation
- `inventory_balances` snapshot sync

**أخطاء:**

#### 🔴 BUG #6: Adjustment POST لا يتحقق من `FUTURE_NEGATIVE_STOCK`

```typescript
// السطر 187:
if (movementType === 'صرف' && absQty > prevQty) return 409 // INSUFFICIENT_STOCK

// لكن لا يوجد future balance check!
```

**التأثير:** تسوية بتاريخ سابق يمكن أن تُفسد running totals.  
**الإصلاح:** أضف `minFutureBal` check.

---

### 3.3 governance.ts (739 سطر)

**الهيكل:**
- POST /gl-preview
- GET /items-master
- PATCH /items-master/:code
- GET /posting-health

**نقاط القوة:**
- GL preview بدون side effects
- `inventory_balances` لـ avg cost (لا يعتمد على stale running totals)
- Fallback posting setup (`OR inv_posting_group_code IS NULL`)

**أخطاء:**

#### 🟡 BUG #7: `items-master` count query تستخدم binds بشكل خاطئ

```typescript
// السطر 170-179:
const countRow = await c.env.DB.prepare(`SELECT COUNT(*) ... WHERE ${where}`)
  .bind(company_id, ...binds).first()
```

**التأثير:** `company_id` مُضاف مرتين — مرة في `binds` (سطر 153) ومرة منفصلة.  
**الإصلاح:** `.bind(...binds)` فقط.

---

### 3.4 analytics.ts (107 سطر)

**الهيكل:**
- GET /cost-by-field
- GET /reorder-alerts

#### 🔴 BUG #8: `reorder-alerts` divide by zero

```sql
-- السطر 87:
ROUND(ac.consumed_qty * 100.0 / lb.balance_qty, 1) AS consumption_pct
```

**التأثير:** crash لو `balance_qty = 0`.  
**الإصلاح:**
```sql
ROUND(ac.consumed_qty * 100.0 / NULLIF(lb.balance_qty, 0), 1)
```

#### 🔴 BUG #9: `last_balance` CTE يعتمد على `MAX(id)` بدلاً من `MAX(movement_date, id)`

```sql
-- السطر 66-70:
AND im.id = (SELECT MAX(id) FROM inventory_movements WHERE item_code = im.item_code)
```

**التأثير:** لو تم إدخال حركة بتاريخ سابق بعد حركة حديثة، سيعتبر الـ old movement هي "last".  
**الإصلاح:**
```sql
AND im.id = (SELECT id FROM inventory_movements 
             WHERE item_code = im.item_code AND company_id = im.company_id
             ORDER BY movement_date DESC, id DESC LIMIT 1)
```

---

### 3.5 receipts.ts (101 سطر)

**الحالة:** PO receipt processing  
**ملاحظة:** لا يوجد frontend caller مؤكد — `PurchaseOrdersPage` قد تستخدمه.

**نقاط القوة:**
- PO validation (status, remaining qty)
- GL control accounts resolution
- Audit logging

**لا توجد أخطاء حرجة.**

---

## 4. أخطاء Business Logic الحرجة

### ملخص الـ Critical/Medium Bugs

| # | الملف | السطر | الوصف | الخطورة |
|---|-------|-------|-------|---------|
| 1 | `movements.ts` | 423-437 | Batch لا يتحقق من `FUTURE_NEGATIVE_STOCK` | **عالية** |
| 2 | `movements.ts` | 972 | Transfer-batch لا يُحدّث `inventory_balances` | **عالية** |
| 3 | `adjustments.ts` | 187 | Adjustment لا يتحقق من `FUTURE_NEGATIVE_STOCK` | **عالية** |
| 4 | `analytics.ts` | 87 | Divide by zero في `reorder-alerts` | **عالية** |
| 5 | `analytics.ts` | 66-70 | `MAX(id)` بدلاً من `MAX(date, id)` | **متوسطة** |
| 6 | `movements.ts` | 332-343 | Cash movement يُسجل قبل تأكيد GL posting | **متوسطة** |
| 7 | `AdjustmentDetailPage.tsx` | 45 | Duplicate items check مفقود | **متوسطة** |
| 8 | `AddInventoryBatchModal.tsx` | 394 | `Number('')` = `0` بدون validation | **متوسطة** |

---

## 5. نظام Posting — التكامل المحاسبي

### 5.1 Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Batch Modal    │────▶│ POST /batch      │────▶│ FinanceCore     │
│  (Frontend)     │     │ (Backend)         │     │ resolveInventory│
└─────────────────┘     └──────────────────┘     │ Movement()        │
                                                 └────────┬────────┘
                                                          │
                              ┌───────────────────────────┼──────────┐
                              │                           │          │
                              ▼                           ▼          ▼
                        ┌──────────┐               ┌──────────┐ ┌──────────┐
                        │ strict   │               │ async    │ │ decoupled│
                        │ _sync    │               │ _reliable│ │          │
                        └──────────┘               └──────────┘ └──────────┘
                              │                           │
                              ▼                           ▼
                        ┌──────────┐               ┌──────────┐
                        │ GL Entry │               │ Outbox   │
                        │ (sync)   │               │ (queue)  │
                        └──────────┘               └──────────┘
```

### 5.2 Posting Modes

| Mode | الوصف | الاستخدام | المخاطر |
|------|-------|-----------|---------|
| **strict_sync** | GL posting متزامن — لو فشل، movement يُسجل لكن GL marked as failed | إنتاجي (production) | يمكن أن يُبطئ performance تحت load عالي |
| **async_reliable** | GL posting يُضاف لـ outbox queue ويُعالج لاحقاً | مقبول للـ production | يوجد lag بين movement و GL |
| **decoupled** | لا يوجد GL posting تلقائي — يدوي فقط | تطوير/تجريبي | risk of forgetting posting |

### 5.3 GL Preview System

**الميزة الممتازة:** `POST /gl-preview` يُظهر للمستخدم القيد المحاسبي المتوقع **قبل** إرسال الحركة.

```typescript
// governance.ts: 20-137
// 1. Resolve PPG/IPG
// 2. Read avg cost from inventory_balances (authoritative)
// 3. Build DR/CR lines
// 4. Return with warnings
```

**الحسابات:**
- **إضافة (GRN):** DR Inventory / CR Supplier (credit) أو CR Cash (cash)
- **صرف (ISSUE):** DR COGS / CR Inventory
- **الافتراضيات:**
  - Inventory account: `140701`
  - COGS account: `45010001`
  - Supplier AP: `2120`
  - Cash: `14010101`

### 5.4 Zero-Value Policy

**المنطق:**
```typescript
// inventory_posting.ts (lib)
if (movementValue === 0 && !zeroValueReason) throw 'ZERO_VALUE_REASON_REQUIRED'
if (movementValue === 0 && !['super_admin', 'company_admin', 'accountant'].includes(role)) throw 'ZERO_VALUE_APPROVAL_ROLE_REQUIRED'
```

**ملاحظة:** الحركات الصفرية لا تحتاج GL posting (no financial impact) — تُعلّم كـ `exempt_zero_value`.

### 5.5 Cash Movement Integration

```typescript
// movements.ts: 332-343
if ((GRN || اضافة) && payment_method === 'cash') {
  await FinanceCore.recordCashMovement({ direction: 'م', amount: valueIn })
}
```

**ملاحظة:** هذا يُنشئ حركة خزينة (treasury) تلقائياً عند الشراء النقدي — ممتاز. لكن يجب أن يحدث **بعد** نجاح GL posting.

---

## 6. أخطاء البيانات وسلامتها

### 6.1 `inventory_balances` Snapshot

**المشكلة المحلولة بذكاء:**
الفريق استبدل `vw_stock_balances` (التي كانت تعتمد على running totals من `inventory_movements`) بـ `inventory_balances` table مع `upsertInventoryBalance()`.

**الفائدة:**
- O(1) read للرصيد (بدلاً من scan كامل)
- لا يتأثر بالـ retroactive inserts

**العيب المتبقي:** `transfer-batch` لا يُحدّث الـ snapshot (BUG #2).

### 6.2 Running Totals في `inventory_movements`

**المشكلة:** `balance_qty` و `balance_value` في `inventory_movements` يمكن أن تصبح stale بعد retroactive inserts.

**الحل المقترح:**
- اعتبر `inventory_movements` as **append-only ledger**
- اجعل `inventory_balances` هو **الـ single source of truth**
- احذف أو أهمل `balance_*` columns في `inventory_movements` للقراءات

### 6.3 Foreign Key Validation

**النقص:**
- `supplier_code` في movements لا يُتحقق من وجوده في `suppliers`
- `item_code` في batch modal يُتحقق فقط في الخلفية
- `warehouse` يُمرر كـ string — لا يوجد FK إلى `warehouses.name`

---

## 7. أفضل الممارسات — ما يعمل بشكل ممتاز

### ✅ 7.1 Posting Engine Architecture

ثلاثة modes (`strict_sync`, `async_reliable`, `decoupled`) مع outbox queue و retry mechanism — تصميم enterprise-grade.

### ✅ 7.2 GL Preview قبل الإرسال

يُظهر للمستخدم القيد المحاسبي المتوقع مع warnings — يقلل من أخطاء الإعداد.

### ✅ 7.3 Lock Date Enforcement

```typescript
enforceInventoryLockDate(controls, movementDate)
```

يمنع التعديل في فترات مغلقة — critical for audit trails.

### ✅ 7.4 Transaction Headers

```sql
inventory_transactions: transaction_id
```

جميع الحركات تنتمي لـ transaction — يسهل التتبع والتدقيق.

### ✅ 7.5 Local ID + Idempotency

```typescript
local_id = `inv_${Date.now()}_${random}`
DUPLICATE_DOCUMENT guard
```

يمنع duplicate inserts من network retries.

### ✅ 7.6 Audit Logging

```typescript
void logAudit(DB, { action: 'CREATE', table_name: 'inventory_movements', ... })
```

جميع write operations مُسجلة.

### ✅ 7.7 Batch Modal UX

- 3-step wizard
- Real-time stock fetch
- Duplicate detection
- Summary bar
- GL preview

---

## 8. التوصيات العاجلة والمستقبلية

### 🔥 عاجل — إصلاح فوري (هذا الأسبوع)

| # | الوصف | الملف | السطر | الوقت |
|---|-------|-------|-------|-------|
| 1 | أضف `FUTURE_NEGATIVE_STOCK` check في batch loop | `movements.ts` | ~428 | 30 دقيقة |
| 2 | أضف `upsertInventoryBalance` في transfer-batch | `movements.ts` | ~972 | 30 دقيقة |
| 3 | أضف `NULLIF(balance_qty, 0)` في reorder-alerts | `analytics.ts` | 87 | 5 دقائق |
| 4 | أصلح `MAX(id)` لـ `ORDER BY movement_date DESC, id DESC LIMIT 1` | `analytics.ts` | 66-70 | 15 دقيقة |
| 5 | أضف duplicate items check في adjustment lines | `AdjustmentDetailPage.tsx` | 45 | 20 دقيقة |
| 6 | أضف validation على `item_code` قبل `Number()` | `AddInventoryBatchModal.tsx` | 394 | 10 دقائق |

### 📋 قريب — إصلاح هذا الشهر

| # | الوصف | الملف | السطر | الوقت |
|---|-------|-------|-------|-------|
| 7 | حرّك `recordCashMovement` بعد نجاح GL posting | `movements.ts` | 332 | 20 دقيقة |
| 8 | أضف `minFutureBal` check في adjustment post | `adjustments.ts` | ~187 | 30 دقيقة |
| 9 | أصلح `bind(company_id, ...binds)` في items-master count | `governance.ts` | 179 | 5 دقائق |
| 10 | استبدل `Math.random()` بـ `crypto.randomUUID()` | `movements.ts` + `AddInventoryBatchModal.tsx` | — | 20 دقيقة |
| 11 | أضف `FK validation` لـ `supplier_code` و `item_code` في movements | `movements.ts` | ~130 | 30 دقيقة |

### 🔮 مستقبلي — تحسينات طويلة المدى

| # | الوصف | الجدوى |
|---|-------|--------|
| 12 | **Inventory Costing Method:** الآن يستخدم avg cost فقط — أضف FIFO/LIFO support | متوسطة |
| 13 | **Stock Reservation:** reserve stock للـ work orders قبل الصرف | عالية |
| 14 | **Barcode Scanning:** دعم scanner في batch modal | عالية |
| 15 | **Automated Reorder:** PO suggestions بناءً على reorder threshold | متوسطة |
| 16 | **Multi-UOM:** دعم multiple units of measure (box, kg, piece) | متوسطة |
| 17 | **Serial/Lot Tracking:** تتبع batches للأصناف | منخفضة |

---

## ملحق أ: قائمة الملفات المراجعة

### الواجهة الأمامية (Frontend)
1. `web/src/pages/inventory/WarehouseBalancesPage.tsx` (472)
2. `web/src/pages/inventory/ItemMasterPage.tsx` (493)
3. `web/src/pages/inventory/ItemCardPage.tsx` (412)
4. `web/src/pages/inventory/InventoryMovementsPage.tsx` (484)
5. `web/src/pages/inventory/InventoryAdjustmentsPage.tsx` (182)
6. `web/src/pages/inventory/AdjustmentDetailPage.tsx` (294)
7. `web/src/pages/inventory/InventoryPostingHealthPage.tsx` (472)
8. `web/src/pages/inventory/WarehousesPage.tsx` (130)
9. `web/src/components/forms/AddInventoryBatchModal.tsx` (873)
10. `web/src/components/forms/InternalTransferModal.tsx` (256)

### الخلفية (Backend)
1. `src/api/inventory/movements.ts` (1,060)
2. `src/api/inventory/adjustments.ts` (283)
3. `src/api/inventory/governance.ts` (739)
4. `src/api/inventory/analytics.ts` (107)
5. `src/api/inventory/receipts.ts` (101)

---

**الختام:** وحدة المخزون تعكس نضجاً هندسياً ملحوظاً — خاصة في نظام Posting و GL Integration. الأخطاء المكتشفة قابلة للإصلاح بسرعة (أقل من 4 ساعات عمل) ولا تُشكّل تهديداً وجودياً للنظام. الأولوية القصوى هي إصلاح `FUTURE_NEGATIVE_STOCK` في batch movements وتحديث `inventory_balances` في transfer-batch.

---
*نهاية التقرير*
