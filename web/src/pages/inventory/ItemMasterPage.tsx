/**
 * ItemMasterPage — Centralized item registry with accounting fields.
 * Aligned with Dynamics 365 / SAP item card paradigm.
 *
 * Tabs:
 *   1. الأصناف — searchable table with PPG/IPG badges, balances
 *   2. الإعداد المحاسبي — per-item accounting field editor
 */
import { useState, useCallback, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Package, ShieldCheck, AlertTriangle, CheckCircle,
  Search, Edit2, ExternalLink, X, Save, ChevronDown, ChevronUp,
  Settings, Plus,
} from 'lucide-react'
import { inventoryApi } from '../../api/inventory'
import { glApi } from '../../api/gl'
import Modal from '../../components/ui/Modal'
import { CommandBar } from '../../components/ui/CommandBar'
import { TableSkeleton } from '../../components/ui/Skeleton'
import { usePermission } from '../../hooks/usePermission'

// ─── Formatters ──────────────────────────────────────────────────────────────
const EGP = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
const NUM = (n: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)

// ─── Types ────────────────────────────────────────────────────────────────────
interface ItemMaster {
  code:                    number
  name:                    string
  unit:                    string | null
  base_unit:               string | null
  package_type:            string | null
  package_capacity:        number | null
  category_id:             number | null
  prod_posting_group_code: string | null
  inv_posting_group_code:  string | null
  standard_cost:           number | null
  reorder_threshold:       number | null
  item_type:               'inventory' | 'service' | 'non_stock' | null
  is_sellable:             number | null
  is_purchasable:          number | null
  list_price:              number | null
  barcode:                 string | null
  expiry_tracking:         number | null
  wip_cost_category:       string | null
  category_name:           string | null
  total_qty:               number
  total_value:             number
  warehouse_count:         number
  catalog_status:          string
  movement_count:          number
}

// ─── Catalog Status Badge ────────────────────────────────────────────────────
function CatalogStatusBadge({ status, moveCount }: { status: string; moveCount: number }) {
  const badges: Record<string, { bg: string; text: string; label: string; icon: string }> = {
    catalog_only: {
      bg: 'bg-slate-50',
      text: 'text-slate-600 border-slate-200',
      label: 'مرجعي',
      icon: '📋',
    },
    moved_zero_balance: {
      bg: 'bg-amber-50',
      text: 'text-amber-700 border-amber-200',
      label: 'صفر الرصيد',
      icon: '⚠️',
    },
    in_stock: {
      bg: 'bg-green-50',
      text: 'text-green-700 border-green-200',
      label: 'في المخزون',
      icon: '✓',
    },
  }
  const badge = badges[status] || badges.catalog_only
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-semibold border ${badge.text} ${badge.bg}`}>
      <span>{badge.icon}</span>
      {badge.label}
      {moveCount > 0 && <span className="text-xs opacity-60">({moveCount})</span>}
    </span>
  )
}

// ─── PPG / IPG Badge ─────────────────────────────────────────────────────────
function GroupBadge({ code, type }: { code: string | null; type: 'PPG' | 'IPG' }) {
  if (!code) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-semibold bg-red-50 text-red-600 border border-red-200">
        <AlertTriangle size={10} />
        بدون {type}
      </span>
    )
  }
  const color = type === 'PPG' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-purple-50 text-purple-700 border-purple-200'
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-semibold border ${color}`}>
      <CheckCircle size={10} />
      {code}
    </span>
  )
}

// ─── Accounting Edit Modal ────────────────────────────────────────────────────
interface EditForm {
  prod_posting_group_code: string
  inv_posting_group_code:  string
  standard_cost:           string
  reorder_threshold:       string
  costing_method:          'moving_average' | ''
  track_lots:              boolean
  cogs_account_override:   string
  base_unit:               string
  package_type:            string
  package_capacity:        string
  item_type:               'inventory' | 'service' | 'non_stock'
  is_sellable:             boolean
  is_purchasable:          boolean
  list_price:              string
  barcode:                 string
  expiry_tracking:         boolean
  wip_cost_category:       string
}

function AccountingEditModal({
  item, onClose,
}: {
  item: ItemMaster & {
    costing_method?:        'moving_average' | null
    track_lots?:            number | null
    cogs_account_override?: string | null
  }
  onClose: () => void
}) {
  const qc  = useQueryClient()
  const { canWrite } = usePermission()

  const [form, setForm] = useState<EditForm>({
    prod_posting_group_code: item.prod_posting_group_code ?? '',
    inv_posting_group_code:  item.inv_posting_group_code  ?? '',
    standard_cost:           item.standard_cost != null ? String(item.standard_cost) : '',
    reorder_threshold:       item.reorder_threshold != null ? String(item.reorder_threshold) : '',
    costing_method:          (item.costing_method as EditForm['costing_method']) ?? 'moving_average',
    track_lots:              !!item.track_lots,
    cogs_account_override:   item.cogs_account_override ?? '',
    base_unit:               item.base_unit ?? '',
    package_type:            item.package_type ?? '',
    package_capacity:        item.package_capacity != null ? String(item.package_capacity) : '',
    item_type:               (item.item_type ?? 'inventory') as EditForm['item_type'],
    is_sellable:             item.is_sellable !== 0,
    is_purchasable:          item.is_purchasable !== 0,
    list_price:              item.list_price != null ? String(item.list_price) : '',
    barcode:                 item.barcode ?? '',
    expiry_tracking:         !!item.expiry_tracking,
    wip_cost_category:       item.wip_cost_category ?? '',
  })
  const [err, setErr] = useState('')

  const { data: ppgList = [] } = useQuery({
    queryKey: ['posting-groups', 'product'],
    queryFn:  () => glApi.postingGroups('product'),
    staleTime: 120_000,
  })
  const { data: ipgList = [] } = useQuery({
    queryKey: ['posting-groups', 'inventory'],
    queryFn:  () => glApi.postingGroups('inventory'),
    staleTime: 120_000,
  })
  const ppgOptions = ppgList as { code: string; name: string }[]
  const ipgOptions = ipgList as { code: string; name: string }[]

  const mutation = useMutation({
    mutationFn: () => inventoryApi.updateItemMaster(item.code, {
      prod_posting_group_code: form.prod_posting_group_code || null,
      inv_posting_group_code:  form.inv_posting_group_code  || null,
      standard_cost:           form.standard_cost     ? Number(form.standard_cost)     : null,
      reorder_threshold:       form.reorder_threshold ? Number(form.reorder_threshold) : null,
      costing_method:          form.costing_method    || null,
      track_lots:              form.track_lots,
      cogs_account_override:   form.cogs_account_override.trim() || null,
      base_unit:               form.base_unit.trim()        || null,
      package_type:            form.package_type.trim()     || null,
      package_capacity:        form.package_capacity        ? Number(form.package_capacity) : null,
      item_type:               form.item_type,
      is_sellable:             form.is_sellable,
      is_purchasable:          form.is_purchasable,
      list_price:              form.list_price ? Number(form.list_price) : null,
      barcode:                 form.barcode.trim() || null,
      expiry_tracking:         form.expiry_tracking,
      wip_cost_category:       form.wip_cost_category || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory', 'items-master'] })
      qc.invalidateQueries({ queryKey: ['inventory', 'posting-health'] })
      onClose()
    },
    onError: (e: Error) => setErr(e.message || 'خطأ في الحفظ'),
  })

  const set = <K extends keyof EditForm>(k: K, v: EditForm[K]) => setForm(f => ({ ...f, [k]: v }))

  return (
    <Modal open title={`إعداد محاسبي: ${item.name}`} onClose={onClose} size="md">
      <div className="space-y-4">
        {/* Info row */}
        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl text-sm">
          <Package size={16} className="text-slate-400" />
          <span className="font-medium text-slate-700">{item.name}</span>
          {item.unit && <span className="text-slate-400">({item.unit})</span>}
          <span className="ml-auto text-slate-500">كود: {item.code}</span>
        </div>

        {/* Posting groups */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label flex items-center gap-1.5">
              مجموعة ترحيل المنتج (PPG)
              <span className="text-xs text-red-500">*</span>
            </label>
            {ppgOptions.length > 0 ? (
              <select className="input" value={form.prod_posting_group_code}
                onChange={e => set('prod_posting_group_code', e.target.value)}>
                <option value="">-- بدون PPG --</option>
                {ppgOptions.map(g => (
                  <option key={g.code} value={g.code}>{g.code} — {g.name}</option>
                ))}
              </select>
            ) : (
              <input className="input" placeholder="مثال: FERT" value={form.prod_posting_group_code}
                onChange={e => set('prod_posting_group_code', e.target.value)} />
            )}
            <p className="text-xs text-slate-400 mt-1">يحدد حسابات المبيعات والمشتريات</p>
          </div>

          <div>
            <label className="label">مجموعة ترحيل المخزون (IPG)</label>
            {ipgOptions.length > 0 ? (
              <select className="input" value={form.inv_posting_group_code}
                onChange={e => set('inv_posting_group_code', e.target.value)}>
                <option value="">-- مخزن افتراضي --</option>
                {ipgOptions.map(g => (
                  <option key={g.code} value={g.code}>{g.code} — {g.name}</option>
                ))}
              </select>
            ) : (
              <input className="input" placeholder="مثال: FERT-WH" value={form.inv_posting_group_code}
                onChange={e => set('inv_posting_group_code', e.target.value)} />
            )}
            <p className="text-xs text-slate-400 mt-1">المخزن الأساسي لهذا الصنف</p>
          </div>
        </div>

        {/* Cost + reorder */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">التكلفة المعيارية (ج.م / وحدة)</label>
            <input type="number" className="input" min="0" step="0.01" placeholder="0.00"
              value={form.standard_cost} onChange={e => set('standard_cost', e.target.value)} />
            <p className="text-xs text-amber-600 mt-1">للتقارير فقط — لا يُستخدم في حساب التكلفة الفعلية</p>
          </div>
          <div>
            <label className="label">حد إعادة الطلب</label>
            <input type="number" className="input" min="0" step="0.001" placeholder="0"
              value={form.reorder_threshold} onChange={e => set('reorder_threshold', e.target.value)} />
            <p className="text-xs text-slate-400 mt-1">تنبيه عند الوصول لهذا الرصيد</p>
          </div>
        </div>

        {/* Costing method + track lots */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">طريقة التكلفة</label>
            <select className="input" value={form.costing_method}
              onChange={e => set('costing_method', e.target.value as EditForm['costing_method'])}>
              <option value="moving_average">متوسط متحرك (Moving Average)</option>
            </select>
          </div>
          <div className="flex flex-col justify-center">
            <label className="label">تتبع الدُفعات (Lot Tracking)</label>
            <label className="flex items-center gap-3 cursor-pointer mt-1 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors">
              <input
                type="checkbox"
                checked={form.track_lots}
                onChange={e => set('track_lots', e.target.checked)}
                className="w-4 h-4 rounded accent-brand-600"
              />
              <span className="text-sm text-slate-700 font-medium">
                {form.track_lots ? 'مفعّل — يتطلب رقم دفعة' : 'معطّل'}
              </span>
            </label>
          </div>
        </div>

        {/* Unit & Packaging */}
        <div className="border-t border-slate-100 pt-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">الوحدة والتغليف</p>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">الوحدة الأساسية</label>
              <input type="text" className="input" placeholder="مثال: كجم، لتر، قرص"
                value={form.base_unit} onChange={e => set('base_unit', e.target.value)} />
              <p className="text-xs text-slate-400 mt-1">وحدة الحركة الأساسية</p>
            </div>
            <div>
              <label className="label">نوع العبوة</label>
              <input type="text" className="input" placeholder="مثال: كيس، برميل، صندوق"
                value={form.package_type} onChange={e => set('package_type', e.target.value)} />
              <p className="text-xs text-slate-400 mt-1">اسم وحدة التغليف</p>
            </div>
            <div>
              <label className="label">سعة العبوة</label>
              <input type="number" className="input" min="0" step="0.001" placeholder="0"
                value={form.package_capacity} onChange={e => set('package_capacity', e.target.value)} />
              <p className="text-xs text-slate-400 mt-1">
                {form.package_capacity && form.base_unit
                  ? `${form.package_capacity} ${form.base_unit} / عبوة`
                  : 'وحدات أساسية لكل عبوة'}
              </p>
            </div>
          </div>
          {form.package_capacity && Number(form.package_capacity) > 0 && (
            <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 mt-2">
              عند الإدخال: عدد العبوات × {form.package_capacity} {form.base_unit || 'وحدة'} = الكمية الإجمالية (محسوبة تلقائياً)
            </p>
          )}
        </div>

        {/* Item type & behavioral flags */}
        <div className="border-t border-slate-100 pt-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">نوع الصنف والسلوك</p>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">نوع الصنف</label>
              <select className="input" value={form.item_type}
                onChange={e => set('item_type', e.target.value as EditForm['item_type'])}>
                <option value="inventory">مخزوني (Inventory)</option>
                <option value="service">خدمة (Service)</option>
                <option value="non_stock">غير مخزوني (Non-Stock)</option>
              </select>
              <p className="text-xs text-slate-400 mt-1">يحدد آلية تتبع الحركة والترحيل</p>
            </div>
            <div className="flex flex-col justify-center gap-3 pt-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="rounded" checked={form.is_sellable}
                  onChange={e => set('is_sellable', e.target.checked)} />
                <span className="text-sm">قابل للبيع</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="rounded" checked={form.is_purchasable}
                  onChange={e => set('is_purchasable', e.target.checked)} />
                <span className="text-sm">قابل للشراء</span>
              </label>
            </div>
          </div>
        </div>

        {/* POS + Expiry fields */}
        <div className="border-t border-slate-100 pt-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">نقطة البيع والتتبع</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">سعر الإدراج (ج.م / وحدة)</label>
              <input type="number" className="input" min="0" step="0.01" placeholder="0.00"
                value={form.list_price} onChange={e => set('list_price', e.target.value)} />
              <p className="text-xs text-slate-400 mt-1">سعر البيع الأساسي — مطلوب لنقطة البيع</p>
            </div>
            <div>
              <label className="label">الباركود</label>
              <input type="text" className="input font-mono" placeholder="مثال: 6224000023"
                value={form.barcode} onChange={e => set('barcode', e.target.value)} />
              <p className="text-xs text-slate-400 mt-1">فريد لكل شركة — يُستخدم في المسح الضوئي</p>
            </div>
          </div>
          <div className="mt-3">
            <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors">
              <input
                type="checkbox"
                checked={form.expiry_tracking}
                onChange={e => set('expiry_tracking', e.target.checked)}
                className="w-4 h-4 rounded accent-brand-600"
              />
              <div>
                <span className="text-sm text-slate-700 font-medium">تتبع تاريخ الصلاحية</span>
                <p className="text-xs text-slate-400">عند التفعيل: الحركات الواردة (GRN) تتطلب تاريخ انتهاء الصلاحية</p>
              </div>
            </label>
          </div>
          <div className="mt-3">
            <label className="label">فئة تكلفة WIP (تجاوز)</label>
            <select className="input" value={form.wip_cost_category}
              onChange={e => set('wip_cost_category', e.target.value)}>
              <option value="">افتراضي (مواد)</option>
              <option value="materials">مواد (materials)</option>
              <option value="fuel">وقود (fuel)</option>
              <option value="equipment">معدات (equipment)</option>
              <option value="contractor">مقاولون (contractor)</option>
              <option value="overhead">مصاريف عامة (overhead)</option>
              <option value="other">أخرى (other)</option>
            </select>
            <p className="text-xs text-slate-400 mt-1">يحدد الفئة التكليفية عند ترحيل هذا الصنف إلى WIP دورة المحصول</p>
          </div>
        </div>

        {/* COGS account override */}
        <div>
          <label className="label">حساب تكلفة البضاعة المباعة (تجاوز)</label>
          <input
            type="text"
            className="input font-mono"
            placeholder="مثال: 45010002 — اتركه فارغاً للاستخدام الافتراضي"
            value={form.cogs_account_override}
            onChange={e => set('cogs_account_override', e.target.value)}
          />
          <p className="text-xs text-slate-400 mt-1">
            يتجاوز حساب COGS الافتراضي لهذا الصنف تحديداً. يُستخدم لأصناف ذات معالجة محاسبية خاصة.
          </p>
        </div>

        {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>إلغاء</button>
          {canWrite('inventory') && (
            <button
              type="button"
              className="btn-primary flex-1 gap-2"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              <Save size={15} />
              {mutation.isPending ? 'جاري الحفظ...' : 'حفظ الإعداد'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

const PAGE_SIZE = 50

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ItemMasterPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { canWrite } = usePermission()

  // Server-side filter state
  const [search,       setSearch]       = useState('')
  const [searchInput,  setSearchInput]  = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'missing_ppg' | 'missing_ipg' | 'below_reorder'>(() => {
    const risk = searchParams.get('risk')
    if (risk === 'no_ppg')        return 'missing_ppg'
    if (risk === 'no_ipg')        return 'missing_ipg'
    if (risk === 'below_reorder') return 'below_reorder'
    return 'all'
  })
  const [catalogStatus, setCatalogStatus] = useState<'all' | 'catalog_only' | 'moved_zero_balance' | 'in_stock'>('all')
  const [page, setPage] = useState(1)

  const [editItem,      setEditItem]      = useState<ItemMaster | null>(null)
  const [expandedCode,  setExpandedCode]  = useState<number | null>(null)

  // Debounce search input → server query
  const applySearch = useCallback((val: string) => {
    setSearch(val)
    setPage(1)
  }, [])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['inventory', 'items-master', page, search, filterStatus, catalogStatus],
    queryFn:  () => inventoryApi.itemsMaster({
      page,
      size: PAGE_SIZE,
      search:        search || undefined,
      filter_status: filterStatus === 'all' ? undefined : filterStatus,
      catalog_status: catalogStatus === 'all' ? undefined : catalogStatus,
    }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })

  const { data: healthData } = useQuery({
    queryKey: ['inventory', 'posting-health'],
    queryFn:  inventoryApi.postingHealth,
    staleTime: 60_000,
  })

  const items      = data?.data      ?? []
  const total      = data?.total     ?? 0
  const pageCount  = data?.page_count ?? 1
  const health     = healthData?.summary

  const changeFilter = (f: typeof filterStatus) => {
    setFilterStatus(f)
    setPage(1)
  }

  const changeCatalogFilter = (s: typeof catalogStatus) => {
    setCatalogStatus(s)
    setPage(1)
  }

  return (
    <div className="flex flex-col h-full">
      <CommandBar
        title="سجل الأصناف الموحد"
        subtitle="إدارة الأصناف مع الإعداد المحاسبي المركزي"
        actions={canWrite('inventory') ? [
          {
            label: 'صنف جديد',
            icon: <Plus size={15} />,
            variant: 'primary' as const,
            onClick: () => navigate('/inventory/items/new'),
          },
        ] : []}
      />
      <div className="flex-1 overflow-y-auto p-5 space-y-5 pb-10">

      {/* Health summary bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-100 rounded-xl flex items-center justify-center text-brand-600">
            <Package size={18} />
          </div>
          <div>
            <p className="text-xs text-slate-400">إجمالي الأصناف</p>
            <p className="text-xl font-bold text-slate-800">{total}</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center text-purple-600">
            <ShieldCheck size={18} />
          </div>
          <div>
            <p className="text-xs text-slate-400">صحة إعداد الترحيل</p>
            <p className={`text-xl font-bold ${(health?.health_pct ?? 0) >= 100 ? 'text-green-700' : 'text-amber-700'}`}>
              {health?.health_pct ?? 100}%
            </p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
            <Settings size={18} />
          </div>
          <div>
            <p className="text-xs text-slate-400">تغطية التوليفات</p>
            <p className="text-xl font-bold text-slate-800">
              {health?.covered ?? 0} / {health?.total_combos ?? 0}
            </p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600">
            <AlertTriangle size={18} />
          </div>
          <div>
            <p className="text-xs text-slate-400">بدون مجموعة ترحيل</p>
            <button
              className="text-xl font-bold text-amber-700 hover:underline"
              onClick={() => changeFilter('missing_ppg')}
            >
              {health?.missing_setup ?? '—'}
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            className="input pr-9 w-full"
            placeholder="بحث بالاسم أو الكود..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applySearch(searchInput)}
          />
          {searchInput && (
            <button className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              onClick={() => { setSearchInput(''); applySearch('') }}>
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex gap-1 flex-wrap">
          {([
            ['all',          'الكل'],
            ['missing_ppg',  '⚠ بدون PPG'],
            ['missing_ipg',  '⚠ بدون IPG'],
            ['below_reorder','↓ تحت الحد'],
          ] as const).map(([val, label]) => (
            <button key={val}
              onClick={() => changeFilter(val)}
              className={`btn text-xs px-3 ${filterStatus === val ? 'btn-primary' : 'btn-secondary'}`}>
              {label}
            </button>
          ))}
        </div>

        <span className="text-sm text-slate-400">|</span>

        <div className="flex gap-1 flex-wrap">
          {([
            ['all',               'الكل'],
            ['catalog_only',      '📋 مرجعي'],
            ['moved_zero_balance','⚠️ صفر'],
            ['in_stock',          '✓ في المخزون'],
          ] as const).map(([val, label]) => (
            <button key={val}
              onClick={() => changeCatalogFilter(val as typeof catalogStatus)}
              className={`btn text-xs px-3 ${catalogStatus === val ? 'btn-primary' : 'btn-secondary'}`}>
              {label}
            </button>
          ))}
        </div>

        <span className="text-sm text-slate-400 ml-auto">
          {total} صنف {isFetching && !isLoading ? '·  جاري التحديث...' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={10} cols={8} />
        ) : items.length === 0 ? (
          <div className="p-16 text-center text-slate-400">
            <Package size={40} className="mx-auto mb-3 opacity-20" />
            لا توجد نتائج
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['الصنف', 'الوحدة', 'الحالة', 'مجموعة PPG', 'مجموعة IPG', 'الرصيد', 'القيمة', 'تكلفة معيارية', ''].map(h => (
                    <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map(item => {
                  const hasIssue  = !item.prod_posting_group_code || !item.inv_posting_group_code
                  const isExpanded = expandedCode === item.code
                  return (
                    <Fragment key={item.code}>
                      <tr
                        className={`hover:bg-slate-50 transition-colors ${hasIssue ? 'bg-amber-50/50' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {hasIssue && <AlertTriangle size={13} className="text-amber-500 shrink-0" />}
                            <button
                              className="font-medium text-brand-700 hover:underline flex items-center gap-1"
                              onClick={() => navigate(`/inventory/item/${item.code}`)}>
                              {item.name}
                              <ExternalLink size={11} className="opacity-40" />
                            </button>
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">كود: {item.code} · {item.category_name ?? '—'}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{item.unit ?? '—'}</td>
                        <td className="px-4 py-3"><CatalogStatusBadge status={item.catalog_status} moveCount={item.movement_count} /></td>
                        <td className="px-4 py-3"><GroupBadge code={item.prod_posting_group_code} type="PPG" /></td>
                        <td className="px-4 py-3"><GroupBadge code={item.inv_posting_group_code} type="IPG" /></td>
                        <td className="px-4 py-3 font-medium text-slate-700">{NUM(item.total_qty)} {item.unit ?? ''}</td>
                        <td className="px-4 py-3 font-semibold text-brand-700">{EGP(item.total_value)}</td>
                        <td className="px-4 py-3 text-slate-500">
                          {item.standard_cost != null ? EGP(item.standard_cost) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {canWrite('inventory') && (
                              <button
                                className="p-1.5 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors"
                                title="تعديل الإعداد المحاسبي"
                                onClick={() => setEditItem(item)}>
                                <Edit2 size={14} />
                              </button>
                            )}
                            <button
                              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                              title="تفاصيل"
                              onClick={() => setExpandedCode(isExpanded ? null : item.code)}>
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50/70">
                          <td colSpan={9} className="px-6 py-3">
                            <div className="grid grid-cols-3 gap-4 text-sm">
                              <div>
                                <p className="text-slate-400 text-xs mb-1">حد إعادة الطلب</p>
                                <p className="font-medium">{item.reorder_threshold != null ? `${NUM(item.reorder_threshold)} ${item.unit ?? ''}` : '—'}</p>
                              </div>
                              <div>
                                <p className="text-slate-400 text-xs mb-1">عدد المخازن</p>
                                <p className="font-medium">{item.warehouse_count}</p>
                              </div>
                              <div>
                                <p className="text-slate-400 text-xs mb-1">متوسط سعر التكلفة</p>
                                <p className="font-medium">{item.total_qty > 0 ? EGP(item.total_value / item.total_qty) : '—'}</p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pageCount > 1 && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-sm">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="btn btn-secondary px-3 disabled:opacity-40">
              السابق
            </button>
            <span className="text-slate-500">
              صفحة {page} من {pageCount} · {total} صنف
            </span>
            <button
              disabled={page >= pageCount}
              onClick={() => setPage(p => p + 1)}
              className="btn btn-secondary px-3 disabled:opacity-40">
              التالي
            </button>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editItem && (
        <AccountingEditModal item={editItem} onClose={() => setEditItem(null)} />
      )}
      </div>
    </div>
  )
}
