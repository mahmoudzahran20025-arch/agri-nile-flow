/**
 * ItemMasterPage — Centralized item registry with accounting fields.
 * Aligned with Dynamics 365 / SAP item card paradigm.
 *
 * Tabs:
 *   1. الأصناف — searchable table with PPG/IPG badges, balances
 *   2. الإعداد المحاسبي — per-item accounting field editor
 */
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Package, ShieldCheck, AlertTriangle, CheckCircle,
  Search, Edit2, ExternalLink, X, Save, ChevronDown, ChevronUp,
  Settings,
} from 'lucide-react'
import { inventoryApi } from '../../api/inventory'
import { glApi } from '../../api/gl'
import Modal from '../../components/ui/Modal'
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
  category_id:             number | null
  prod_posting_group_code: string | null
  inv_posting_group_code:  string | null
  standard_cost:           number | null
  reorder_threshold:       number | null
  category_name:           string | null
  total_qty:               number
  total_value:             number
  warehouse_count:         number
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
}

function AccountingEditModal({
  item, onClose,
}: {
  item: ItemMaster
  onClose: () => void
}) {
  const qc  = useQueryClient()
  const { canWrite } = usePermission()

  const [form, setForm] = useState<EditForm>({
    prod_posting_group_code: item.prod_posting_group_code ?? '',
    inv_posting_group_code:  item.inv_posting_group_code  ?? '',
    standard_cost:           item.standard_cost != null ? String(item.standard_cost) : '',
    reorder_threshold:       item.reorder_threshold != null ? String(item.reorder_threshold) : '',
  })
  const [err, setErr] = useState('')

  // Load posting groups for dropdowns
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
      standard_cost:           form.standard_cost  ? Number(form.standard_cost)  : null,
      reorder_threshold:       form.reorder_threshold ? Number(form.reorder_threshold) : null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory', 'items-master'] })
      qc.invalidateQueries({ queryKey: ['inventory', 'posting-health'] })
      onClose()
    },
    onError: (e: Error) => setErr(e.message || 'خطأ في الحفظ'),
  })

  const set = (k: keyof EditForm, v: string) => setForm(f => ({ ...f, [k]: v }))

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

        <div className="grid grid-cols-2 gap-4">
          {/* PPG */}
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

          {/* IPG */}
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

        <div className="grid grid-cols-2 gap-4">
          {/* Standard cost */}
          <div>
            <label className="label">التكلفة المعيارية (ج.م / وحدة)</label>
            <input type="number" className="input" min="0" step="0.01" placeholder="0.00"
              value={form.standard_cost} onChange={e => set('standard_cost', e.target.value)} />
            <p className="text-xs text-slate-400 mt-1">للتقارير والمقارنة مع الفعلي</p>
          </div>

          {/* Reorder threshold */}
          <div>
            <label className="label">حد إعادة الطلب</label>
            <input type="number" className="input" min="0" step="0.001" placeholder="0"
              value={form.reorder_threshold} onChange={e => set('reorder_threshold', e.target.value)} />
            <p className="text-xs text-slate-400 mt-1">تنبيه عند الوصول لهذا الرصيد</p>
          </div>
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

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ItemMasterPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { canWrite } = usePermission()
  const [search, setSearch] = useState('')
  const [filterPpg, setFilterPpg] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'missing' | 'ok'>(() => {
    const risk = searchParams.get('risk')
    return risk === 'no_ppg' || risk === 'no_ipg' ? 'missing' : 'all'
  })
  const [editItem, setEditItem] = useState<ItemMaster | null>(null)
  const [expandedCode, setExpandedCode] = useState<number | null>(null)
  const riskFilter = searchParams.get('risk')

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['inventory', 'items-master'],
    queryFn:  inventoryApi.itemsMaster,
    staleTime: 60_000,
  })

  const { data: healthData } = useQuery({
    queryKey: ['inventory', 'posting-health'],
    queryFn:  inventoryApi.postingHealth,
    staleTime: 60_000,
  })

  const allPpg = useMemo(() => {
    const set = new Set<string>()
    items.forEach(i => { if (i.prod_posting_group_code) set.add(i.prod_posting_group_code) })
    return Array.from(set).sort()
  }, [items])

  const filtered = useMemo(() => {
    return items.filter(i => {
      if (search && !i.name.toLowerCase().includes(search.toLowerCase()) &&
          !String(i.code).includes(search)) return false
      if (filterPpg && i.prod_posting_group_code !== filterPpg) return false
      if (filterStatus === 'missing' && i.prod_posting_group_code && i.inv_posting_group_code) return false
      if (filterStatus === 'ok' && (!i.prod_posting_group_code || !i.inv_posting_group_code)) return false
      if (riskFilter === 'no_standard_cost' && (i.standard_cost ?? 0) > 0) return false
      if (riskFilter === 'no_ppg' && !!i.prod_posting_group_code) return false
      if (riskFilter === 'no_ipg' && !!i.inv_posting_group_code) return false
      if (riskFilter === 'below_reorder' && ((i.reorder_threshold ?? 0) <= 0 || (i.total_qty ?? 0) > (i.reorder_threshold ?? 0))) return false
      return true
    })
  }, [items, search, filterPpg, filterStatus, riskFilter])

  const missingCount = items.filter(i => !i.prod_posting_group_code || !i.inv_posting_group_code).length
  const health = healthData?.summary

  return (
    <div className="space-y-5 pb-10">

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Package size={22} className="text-slate-400" />
            سجل الأصناف الموحد
          </h1>
          <p className="text-sm text-slate-400 mt-1">إدارة الأصناف مع الإعداد المحاسبي المركزي</p>
        </div>
      </div>

      {/* Health summary bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-100 rounded-xl flex items-center justify-center text-brand-600">
            <Package size={18} />
          </div>
          <div>
            <p className="text-xs text-slate-400">إجمالي الأصناف</p>
            <p className="text-xl font-bold text-slate-800">{items.length}</p>
          </div>
        </div>
        <div className={`card p-4 flex items-center gap-3 ${missingCount > 0 ? 'border-amber-200 bg-amber-50' : ''}`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${missingCount > 0 ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'}`}>
            {missingCount > 0 ? <AlertTriangle size={18} /> : <CheckCircle size={18} />}
          </div>
          <div>
            <p className="text-xs text-slate-400">أصناف بدون مجموعة ترحيل</p>
            <p className={`text-xl font-bold ${missingCount > 0 ? 'text-amber-700' : 'text-green-700'}`}>{missingCount}</p>
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
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            className="input pr-9 w-full"
            placeholder="بحث بالاسم أو الكود..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              onClick={() => setSearch('')}>
              <X size={14} />
            </button>
          )}
        </div>

        <select className="input w-40" value={filterPpg} onChange={e => setFilterPpg(e.target.value)}>
          <option value="">كل مجموعات PPG</option>
          {allPpg.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        <div className="flex gap-1">
          {(['all', 'ok', 'missing'] as const).map(s => (
            <button key={s}
              onClick={() => setFilterStatus(s)}
              className={`btn text-xs px-3 ${filterStatus === s ? 'btn-primary' : 'btn-secondary'}`}>
              {s === 'all' ? 'الكل' : s === 'ok' ? '✓ مكتملة' : '⚠ ناقصة'}
            </button>
          ))}
        </div>

        <span className="text-sm text-slate-400 ml-auto">{filtered.length} صنف</span>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-16 text-center text-slate-400 animate-pulse">جاري التحميل...</div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center text-slate-400">
            <Package size={40} className="mx-auto mb-3 opacity-20" />
            لا توجد نتائج
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['الصنف', 'الوحدة', 'مجموعة PPG', 'مجموعة IPG', 'الرصيد', 'القيمة', 'تكلفة معيارية', ''].map(h => (
                    <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(item => {
                  const hasIssue = !item.prod_posting_group_code || !item.inv_posting_group_code
                  const isExpanded = expandedCode === item.code
                  return (
                    <>
                      <tr
                        key={item.code}
                        className={`hover:bg-slate-50 transition-colors ${hasIssue ? 'bg-amber-50/50' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {hasIssue && <AlertTriangle size={13} className="text-amber-500 shrink-0" />}
                            <button
                              className="font-medium text-brand-700 hover:underline flex items-center gap-1"
                              onClick={() => navigate(`/inventory/item/${item.code}`)}
                            >
                              {item.name}
                              <ExternalLink size={11} className="opacity-40" />
                            </button>
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">كود: {item.code} · {item.category_name ?? '—'}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{item.unit ?? '—'}</td>
                        <td className="px-4 py-3">
                          <GroupBadge code={item.prod_posting_group_code} type="PPG" />
                        </td>
                        <td className="px-4 py-3">
                          <GroupBadge code={item.inv_posting_group_code} type="IPG" />
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-700">
                          {NUM(item.total_qty)} {item.unit ?? ''}
                        </td>
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
                                onClick={() => setEditItem(item)}
                              >
                                <Edit2 size={14} />
                              </button>
                            )}
                            <button
                              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                              title="تفاصيل"
                              onClick={() => setExpandedCode(isExpanded ? null : item.code)}
                            >
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${item.code}-exp`} className="bg-slate-50/70">
                          <td colSpan={8} className="px-6 py-3">
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
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editItem && (
        <AccountingEditModal item={editItem} onClose={() => setEditItem(null)} />
      )}
    </div>
  )
}
