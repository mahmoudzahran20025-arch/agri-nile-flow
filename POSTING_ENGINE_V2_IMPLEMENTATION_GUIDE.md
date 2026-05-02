# دليل التنفيذ العملي: بوستينج انجين V2

**التاريخ:** 1 مايو 2026  
**الحالة:** جاهز للتنفيذ الفوري  
**المدة المتوقعة:** 8-10 أسابيع

---

## الخطوات الأولى (الأسبوع الأول)

### 1. تهيئة الـ Environment

```bash
# 1. Clone الـ feature branch
git checkout -b feature/posting-engine-v2

# 2. Backup الـ D1 database (إذا كان موجود بيانات)
wrangler d1 execute agri-nile-flow-data-lake --remote --file=backup_initial.sql > backup_$(date +%Y%m%d_%H%M%S).sql

# 3. تحقق من عدد الصفوف في الجداول الحساسة
wrangler d1 execute agri-nile-flow-data-lake --remote --command "
  SELECT 'posting_rules' as table_name, COUNT(*) as row_count FROM posting_rules
  UNION ALL
  SELECT 'journal_entries', COUNT(*) FROM journal_entries
  UNION ALL
  SELECT 'business_events', COUNT(*) FROM business_events;"
```

**النتيجة المتوقعة:** يجب أن تكون الأرقام صغيرة (< 100 صف)

### 2. إضافة ملفات المشروع

```bash
# قم بـ copy/paste الملفات:
migrations/0051_posting_engine_phase1_basics.sql
migrations/0052_master_data_tables.sql
src/types/posting_v2.ts

# التحقق من التركيب:
ls -la migrations/0051_*.sql
ls -la migrations/0052_*.sql
ls -la src/types/posting_v2.ts
```

### 3. تطبيق Phase 1 Migrations

```bash
# في الترتيب التالي:
wrangler d1 execute agri-nile-flow-data-lake --remote --file=migrations/0051_posting_engine_phase1_basics.sql
wrangler d1 execute agri-nile-flow-data-lake --remote --file=migrations/0052_master_data_tables.sql

# التحقق من النجاح
wrangler d1 execute agri-nile-flow-data-lake --remote --command "
  SELECT 'Columns added' as status;
  SELECT COUNT(DISTINCT business_unit_id) as bu_dimension FROM journal_entry_lines;
  SELECT COUNT(*) as material_groups FROM md_material_groups;
  SELECT COUNT(*) as business_units FROM md_business_units;"
```

---

## التطوير التفصيلي (أسابيع 2-3)

### Task 1: تحديث API Backend

**الملف:** `src/api/gl/posting-setup.ts`

أضف الـ endpoints الجديدة:

```typescript
// 1. Material Groups endpoints
postingSetup.get('/material-groups', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare(`SELECT id, code, name, description, is_active FROM md_material_groups 
              WHERE company_id = ? ORDER BY code`)
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

postingSetup.post('/material-groups', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const body = await c.req.json<{ code: string; name: string; description?: string }>()
  
  const { meta } = await c.env.DB
    .prepare(`INSERT INTO md_material_groups (company_id, code, name, description, is_active, created_at)
              VALUES (?, ?, ?, ?, 1, datetime('now'))`)
    .bind(company_id, body.code.toUpperCase(), body.name, body.description || null).run()
  
  return c.json({ success: true, data: { id: meta.last_row_id } }, 201)
})

// 2. Business Units endpoints
postingSetup.get('/business-units', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare(`SELECT id, code, name, description, is_active FROM md_business_units 
              WHERE company_id = ? ORDER BY code`)
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

postingSetup.post('/business-units', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const body = await c.req.json<{ code: string; name: string; description?: string }>()
  
  const { meta } = await c.env.DB
    .prepare(`INSERT INTO md_business_units (company_id, code, name, description, is_active, created_at)
              VALUES (?, ?, ?, ?, 1, datetime('now'))`)
    .bind(company_id, body.code.toUpperCase(), body.name, body.description || null).run()
  
  return c.json({ success: true, data: { id: meta.last_row_id } }, 201)
})

// 3. Event Types endpoints
postingSetup.get('/event-types', async (c) => {
  const { results } = await c.env.DB
    .prepare(`SELECT id, code, name, description, 
                    affects_inventory, affects_wip, affects_cogs, 
                    affects_revenue, affects_expense, is_active
             FROM md_event_types WHERE is_active = 1 ORDER BY code`)
    .all()
  return c.json({ success: true, data: results })
})

// 4. Account Roles endpoints
postingSetup.get('/account-roles', async (c) => {
  const { results } = await c.env.DB
    .prepare(`SELECT id, code, name, description, category, is_active
             FROM md_account_roles WHERE is_active = 1 ORDER BY code`)
    .all()
  return c.json({ success: true, data: results })
})

// 5. Currencies endpoints
postingSetup.get('/currencies', async (c) => {
  const { results } = await c.env.DB
    .prepare(`SELECT id, code, name, symbol, decimal_places, is_active
             FROM md_currencies WHERE is_active = 1 ORDER BY code`)
    .all()
  return c.json({ success: true, data: results })
})
```

### Task 2: تحديث Frontend API Client

**الملف:** `web/src/api/gl.ts`

```typescript
// Add to glApi export:
export const glApi = {
  // ... existing endpoints ...
  
  // NEW: Material Groups
  materialGroups: () => api.get<MaterialGroup[]>('/gl/posting-setup/material-groups'),
  createMaterialGroup: (data: { code: string; name: string; description?: string }) =>
    api.post('/gl/posting-setup/material-groups', data),
  
  // NEW: Business Units
  businessUnits: () => api.get<BusinessUnit[]>('/gl/posting-setup/business-units'),
  createBusinessUnit: (data: { code: string; name: string; description?: string }) =>
    api.post('/gl/posting-setup/business-units', data),
  
  // NEW: Event Types
  eventTypes: () => api.get<EventType[]>('/gl/posting-setup/event-types'),
  
  // NEW: Account Roles
  accountRoles: () => api.get<AccountRole[]>('/gl/posting-setup/account-roles'),
  
  // NEW: Currencies
  currencies: () => api.get<Currency[]>('/gl/posting-setup/currencies'),
}
```

### Task 3: إنشاء UI للماستر داتا

**ملف جديد:** `web/src/pages/gl/MasterDataPage.tsx`

```typescript
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2 } from 'lucide-react'
import Modal from '../../components/ui/Modal'
import { glApi } from '../../api/client'

export default function MasterDataPage() {
  const [tab, setTab] = useState<'material-groups' | 'business-units' | 'currencies' | 'roles'>('material-groups')

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Tab Navigation */}
      <div className="flex border-b bg-white">
        {[
          { id: 'material-groups', label: 'مجموعات المواد' },
          { id: 'business-units', label: 'وحدات الأعمال' },
          { id: 'currencies', label: 'العملات' },
          { id: 'roles', label: 'أدوار الحسابات' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as any)}
            className={`px-6 py-3 font-semibold text-[13px] border-b-2 transition ${
              tab === t.id
                ? 'border-[#0F2D5C] text-[#0F2D5C]'
                : 'border-transparent text-slate-600 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {tab === 'material-groups' && <MaterialGroupsTab />}
        {tab === 'business-units' && <BusinessUnitsTab />}
        {tab === 'currencies' && <CurrenciesTab />}
        {tab === 'roles' && <AccountRolesTab />}
      </div>
    </div>
  )
}

// Sub-components for each tab...
function MaterialGroupsTab() {
  const [showAdd, setShowAdd] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['material-groups'],
    queryFn: () => glApi.materialGroups(),
  })

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-slate-700">مجموعات المواد</h2>
        <button
          onClick={() => setShowAdd(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={14} /> إضافة
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-8">جاري التحميل...</div>
      ) : !data?.length ? (
        <div className="text-center py-8 text-slate-400">لا توجد مجموعات مواد</div>
      ) : (
        <div className="grid gap-3">
          {data?.map(mg => (
            <div key={mg.id} className="p-4 border border-slate-200 rounded bg-white hover:shadow-sm transition">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-mono text-[13px] font-semibold text-[#0F2D5C]">{mg.code}</p>
                  <p className="text-sm text-slate-700 mt-1">{mg.name}</p>
                  {mg.description && <p className="text-xs text-slate-500 mt-1">{mg.description}</p>}
                </div>
                <span className={`px-2 py-1 rounded text-[11px] font-semibold ${
                  mg.is_active === 1 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                }`}>
                  {mg.is_active === 1 ? 'نشط' : 'معطل'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddMaterialGroupModal open={showAdd} onClose={() => setShowAdd(false)} />
      )}
    </div>
  )
}

// Similar implementations for other tabs...

function AddMaterialGroupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')

  const mut = useMutation({
    mutationFn: () => glApi.createMaterialGroup({ code: code.toUpperCase(), name, description }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['material-groups'] })
      setCode('')
      setName('')
      setDescription('')
      setError('')
      onClose()
    },
    onError: (e: any) => setError(e.message || 'حدث خطأ'),
  })

  return (
    <Modal open={open} title="إضافة مجموعة مواد" onClose={onClose} size="sm">
      <div className="space-y-4 text-[13px]">
        <div>
          <label className="block text-slate-600 font-semibold mb-1">الكود *</label>
          <input
            className="input uppercase"
            placeholder="SEEDS"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            maxLength={20}
          />
        </div>
        <div>
          <label className="block text-slate-600 font-semibold mb-1">الاسم *</label>
          <input
            className="input"
            placeholder="التقاوي والبذور"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-slate-600 font-semibold mb-1">الوصف</label>
          <textarea
            className="input"
            placeholder="وصف اختياري..."
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
          />
        </div>
        {error && <p className="text-red-600 text-[12px]">{error}</p>}
      </div>

      <div className="flex justify-end gap-3 mt-6">
        <button className="btn-secondary" onClick={onClose}>
          إلغاء
        </button>
        <button
          className="btn-primary"
          onClick={() => mut.mutate()}
          disabled={mut.isPending || !code || !name}
        >
          {mut.isPending ? 'جاري الحفظ...' : 'حفظ'}
        </button>
      </div>
    </Modal>
  )
}
```

### Task 4: تحديث الـ Routing

**ملف:** `web/src/App.tsx`

```typescript
// في الـ routes:
{
  path: '/gl/master-data',
  element: <MasterDataPage />,
  title: 'بيانات ماستر GL'
}
```

---

## Testing Phase 1 (نهاية الأسبوع 3)

### Test 1: API Endpoints
```bash
# في PowerShell:
$headers = @{
  'Authorization' = 'Bearer YOUR_JWT_TOKEN'
  'Content-Type' = 'application/json'
}

# GET material groups
$response = Invoke-RestMethod `
  -Uri 'https://your-backend-url/api/gl/posting-setup/material-groups' `
  -Method GET `
  -Headers $headers

$response | ConvertTo-Json -Depth 10
```

### Test 2: UI Navigation
```bash
# في المتصفح:
# 1. اذهب لـ /gl/master-data
# 2. اضغط على tab "مجموعات المواد"
# 3. اضغط "إضافة"
# 4. ملأ البيانات واضغط "حفظ"
# 5. تحقق: يجب ظهور المجموعة الجديدة في القائمة
```

### Test 3: Backward Compatibility
```bash
# تأكد أن الـ Engine القديم لسه يشتغل:
wrangler d1 execute agri-nile-flow-data-lake --remote --command "
  SELECT COUNT(*) as posting_rules FROM posting_rules WHERE is_active = 1;
  SELECT COUNT(*) as journal_entries FROM journal_entries WHERE is_posted = 1;"
```

---

## Checklist الإكمال

### Phase 0: Prep
- [ ] Backup أخذ
- [ ] Branch git جاهزة
- [ ] Row count documented

### Phase 1: Schema + API
- [ ] Migration 0051 تطبقت
- [ ] Migration 0052 تطبقت
- [ ] Types في TypeScript
- [ ] API endpoints جديدة (5)
- [ ] Frontend Client مُحدّث
- [ ] MasterDataPage.tsx جاهزة
- [ ] UI Routes مُحدّثة

### Phase 1.5: Testing
- [ ] API tests pass
- [ ] UI tests pass
- [ ] Old engine still works
- [ ] TypeScript compiles clean

### Next Phases
- [ ] Phase 2: Multi-Currency
- [ ] Phase 3: Event Types (optional)
- [ ] Phase 4: Account Roles (optional)

---

## Common Issues & Solutions

### Issue 1: Foreign Key Constraint Error
**الأعراض:** `FOREIGN KEY constraint failed` عند تطبيق migration

**السبب:** جدول مرجعي ناقص

**الحل:**
```sql
-- تحقق من الـ foreign keys
PRAGMA foreign_key_list(posting_rules);
PRAGMA foreign_key_list(journal_entry_lines);
```

### Issue 2: TypeScript Compilation Error
**الأعراض:** `Cannot find type 'PostingRuleV2'`

**السبب:** Import statement غير صحيح

**الحل:**
```typescript
import type { PostingRuleV2 } from '../types/posting_v2'
```

### Issue 3: API Returns 500
**الأعراض:** POST /gl/posting-setup/material-groups يرجع 500

**السبب:** غالباً database migration لم تطبق بشكل كامل

**الحل:**
```bash
# تحقق من الجداول الموجودة
wrangler d1 execute agri-nile-flow-data-lake --remote --command ".tables"

# تحقق من الأعمدة
wrangler d1 execute agri-nile-flow-data-lake --remote --command ".schema md_material_groups"
```

---

## الخطوات التالية (بعد Phase 1)

```
أسبوع 4-6: Phase 2 (Multi-Currency + Events)
├── migrations/0053_multi_currency_support.sql
├── migrations/0054_event_type_standardization.sql
├── src/lib/posting_engine_v2.ts (rewrite)
└── UI: Exchange Rates Manager

أسبوع 7-8: Phase 3 (Account Roles) — اختياري
├── migrations/0055_account_role_mapping.sql
├── Refactor engine entirely
└── Testing

أسبوع 9: QA + Go-Live Prep
```

---

**هل تريد إجراء أي خطوة من هذه الخطوات الآن؟**
