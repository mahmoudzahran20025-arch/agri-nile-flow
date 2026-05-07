import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Leaf, TrendingUp, Package, Wheat, AlertTriangle, CheckCircle,
  Target, Edit3, X, ChevronDown, ChevronUp, Minus, ClipboardList, Loader2,
} from 'lucide-react'
import { inventoryApi, configApi, budgetsApi, operationsApi } from '../../api/client'

// ─── Formatters ───────────────────────────────────────────────

function egp(n: number | null | undefined) {
  if (n == null || n === 0) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}
function num(n: number | null | undefined, dp = 2) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: dp }).format(n)
}

// ─── Types ────────────────────────────────────────────────────

interface FieldCost {
  id:                 number
  code:               string
  field_name:         string
  area_feddan:        number
  crop_type:          string | null
  season_id:          number | null
  season_name:        string | null
  total_consumed:     number   // inventory issues only (legacy column kept for compat)
  total_added:        number
  items_consumed:     number
  labor_cost:         number
  equipment_cost:     number
  cash_cost:          number
  total_cost:         number   // inv + labor + equipment + cash
  cost_per_feddan:    number | null
  budget_id:          number | null
  budget_per_feddan:  number | null
  variance_pct:       number | null
}

// ─── Variance helpers ─────────────────────────────────────────

type BudgetStatus = 'over_budget' | 'warning' | 'on_track' | 'no_budget'

function getBudgetStatus(row: FieldCost): BudgetStatus {
  if (row.budget_per_feddan == null) return 'no_budget'
  if (row.variance_pct == null)      return 'no_budget'
  if (row.variance_pct > 15)         return 'over_budget'
  if (row.variance_pct > 0)          return 'warning'
  return 'on_track'
}

const STATUS_CONFIG: Record<BudgetStatus, { label: string; bg: string; text: string; border: string }> = {
  over_budget: { label: 'تجاوز الحد',       bg: 'bg-red-100',    text: 'text-red-700',   border: 'border-red-200' },
  warning:     { label: 'قرب الحد',          bg: 'bg-amber-100',  text: 'text-amber-700', border: 'border-amber-200' },
  on_track:    { label: 'ضمن الميزانية',     bg: 'bg-green-100',  text: 'text-green-700', border: 'border-green-200' },
  no_budget:   { label: 'بدون ميزانية',      bg: 'bg-slate-100',  text: 'text-slate-500', border: 'border-slate-200' },
}

// ─── Variance badge ───────────────────────────────────────────

function VarianceBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-slate-300 text-xs">—</span>
  const abs  = Math.abs(pct)
  const over = pct > 0
  const Icon = over ? ChevronUp : (pct < 0 ? ChevronDown : Minus)
  const cls  = pct > 15 ? 'text-red-600' : pct > 0 ? 'text-amber-600' : 'text-green-600'
  return (
    <span className={`flex items-center gap-0.5 font-bold text-sm ${cls}`}>
      <Icon size={14} />
      {num(abs, 1)}%
    </span>
  )
}

// ─── Inline Budget Editor ─────────────────────────────────────

interface BudgetEditorProps {
  row:        FieldCost
  onSave:     (fieldId: number, seasonId: number, value: number, existingBudgetId: number | null) => void
  onDelete:   (budgetId: number) => void
  saving:     boolean
}

function BudgetEditor({ row, onSave, onDelete, saving }: BudgetEditorProps) {
  const [editing, setEditing] = useState(false)
  const [value,   setValue]   = useState(String(row.budget_per_feddan ?? ''))

  if (!row.season_id) {
    return <span className="text-slate-300 text-xs">لا موسم</span>
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1 group">
        {row.budget_per_feddan != null ? (
          <>
            <span className="font-medium text-slate-700">{egp(row.budget_per_feddan)}</span>
            <button
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-slate-400 hover:text-brand-600 rounded"
              onClick={() => { setValue(String(row.budget_per_feddan)); setEditing(true) }}
              title="تعديل"
            >
              <Edit3 size={12} />
            </button>
          </>
        ) : (
          <button
            onClick={() => { setValue(''); setEditing(true) }}
            className="flex items-center gap-1 text-xs text-brand-500 hover:text-brand-700 font-medium
                       border border-dashed border-brand-200 hover:border-brand-400 rounded-md px-2 py-0.5 transition-all"
          >
            <Target size={11} />
            ضبط
          </button>
        )}
      </div>
    )
  }

  const handleSave = () => {
    const v = Number(value)
    if (!value || isNaN(v) || v < 0) return
    onSave(row.id, row.season_id!, v, row.budget_id)
    setEditing(false)
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        type="number" min="0" step="any"
        className="input text-sm py-1 w-28 text-center"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
      />
      <button
        disabled={saving}
        onClick={handleSave}
        className="p-1 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50 transition-colors"
        title="حفظ"
      >
        <CheckCircle size={13} />
      </button>
      {row.budget_id != null && (
        <button
          onClick={() => { onDelete(row.budget_id!); setEditing(false) }}
          className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
          title="حذف الميزانية"
        >
          <X size={13} />
        </button>
      )}
      <button
        onClick={() => setEditing(false)}
        className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
      >
        <X size={13} />
      </button>
    </div>
  )
}

// ─── Alert Strip ──────────────────────────────────────────────

function AlertStrip({ overBudget }: { overBudget: FieldCost[] }) {
  if (overBudget.length === 0) return null
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-red-100 rounded-lg shrink-0">
          <AlertTriangle size={16} className="text-red-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-red-700 mb-2">
            {overBudget.length} {overBudget.length === 1 ? 'حقل تجاوز' : 'حقول تجاوزت'} الميزانية بأكثر من 15%
          </p>
          <div className="flex flex-wrap gap-2">
            {overBudget.map(r => (
              <span key={r.id}
                className="flex items-center gap-1.5 bg-white border border-red-200 rounded-full px-3 py-1 text-xs font-medium text-red-700 shadow-sm">
                <Leaf size={10} />
                {r.field_name}
                <span className="text-red-400 font-bold">
                  +{num(r.variance_pct, 1)}%
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────

export default function CostByFieldPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const seasonId = searchParams.get('season_id') ?? ''

  const setSeasonFilter = (nextSeasonId: string) => {
    const next = new URLSearchParams(searchParams)
    if (nextSeasonId) {
      next.set('season_id', nextSeasonId)
    } else {
      next.delete('season_id')
    }
    setSearchParams(next, { replace: true })
  }

  // ── Data ──────────────────────────────────────────────────────
  const { data: seasons = [] } = useQuery({
    queryKey: ['config', 'seasons'],
    queryFn:  configApi.seasons as () => Promise<{ id: number; name: string; status: string }[]>,
    staleTime: 120_000,
  })

  const seasonOptions = (seasons as { id: number; name: string; status: string }[])
  const activeSeason = seasonOptions.find(s => s.status === 'active')

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['inventory', 'cost-by-field', seasonId],
    queryFn:  () => inventoryApi.costByField(seasonId ? Number(seasonId) : undefined) as Promise<FieldCost[]>,
  })

  // ── Drill-down state ─────────────────────────────────────────
  const [drillRow, setDrillRow] = useState<FieldCost | null>(null)

  const { data: drillOrders = [], isFetching: drillLoading } = useQuery({
    queryKey: ['operations', 'by-field', drillRow?.id, seasonId],
    queryFn:  () => operationsApi.ordersByField(drillRow!.id, seasonId ? Number(seasonId) : undefined),
    enabled:  !!drillRow,
  })

  // ── Budget mutations ──────────────────────────────────────────
  const { mutate: upsertBudget, isPending: saving } = useMutation({
    mutationFn: (v: { field_id: number; season_id: number; budget_per_feddan: number }) =>
      budgetsApi.upsert(v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory', 'cost-by-field'] }),
  })

  const { mutate: deleteBudget } = useMutation({
    mutationFn: (id: number) => budgetsApi.remove(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['inventory', 'cost-by-field'] }),
  })

  // ── KPIs ──────────────────────────────────────────────────────
  const totalCost        = rows.reduce((s, r) => s + (r.total_cost ?? r.total_consumed), 0)
  const totalArea        = rows.reduce((s, r) => s + r.area_feddan, 0)
  const avgCostPerFeddan = totalArea > 0 ? totalCost / totalArea : 0

  const withBudget   = rows.filter(r => r.budget_per_feddan != null)
  const overBudget   = rows.filter(r => getBudgetStatus(r) === 'over_budget')
  const warningCount = rows.filter(r => getBudgetStatus(r) === 'warning').length
  const onTrackCount = rows.filter(r => getBudgetStatus(r) === 'on_track').length

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-brand-100 rounded-xl">
            <Wheat size={20} className="text-brand-700" />
          </div>
          <div>
            <h1 className="page-title">تكلفة الإنتاج بالفدان</h1>
            <p className="text-sm text-slate-400">تحليل التكلفة الفعلية مقابل الميزانية المستهدفة</p>
          </div>
        </div>

        {/* Season filter */}
        <div className="flex items-center gap-2">
          <Leaf size={14} className="text-brand-500" />
          <select
            className="input w-52 text-sm"
            value={seasonId}
            onChange={e => setSeasonFilter(e.target.value)}
          >
            <option value="">كل المواسم</option>
            {seasonOptions.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}{s.status === 'active' ? ' ✓' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
              seasonId === ''
                ? 'bg-slate-100 border-slate-300 text-slate-700'
                : 'bg-white border-slate-200 text-slate-500 hover:text-slate-700'
            }`}
            onClick={() => setSeasonFilter('')}
          >
            الكل
          </button>
          {activeSeason && (
            <button
              type="button"
              className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                seasonId === String(activeSeason.id)
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                  : 'bg-white border-emerald-200 text-emerald-600 hover:bg-emerald-50'
              }`}
              onClick={() => setSeasonFilter(String(activeSeason.id))}
            >
              الموسم النشط
            </button>
          )}
        </div>
      </div>

      {/* Alert strip */}
      <AlertStrip overBudget={overBudget} />

      {/* KPI strip */}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total area */}
          <div className="card p-4">
            <p className="text-xs text-slate-500 font-medium mb-1">إجمالي المساحة</p>
            <p className="text-2xl font-bold text-slate-800">{num(totalArea, 1)}</p>
            <p className="text-xs text-slate-400 mt-0.5">فدان • {rows.length} حقل</p>
          </div>

          {/* Total cost (all types) */}
          <div className="card p-4">
            <p className="text-xs text-slate-500 font-medium mb-1">إجمالي التكاليف الكلية</p>
            <p className="text-xl font-bold text-red-600">{egp(totalCost)}</p>
            <p className="text-xs text-slate-400 mt-0.5">مخزون + عمالة + معدات + نقدي</p>
          </div>

          {/* Avg cost / feddan */}
          <div className="card p-4 bg-brand-50 border border-brand-100">
            <p className="text-xs text-brand-600 font-medium mb-1">متوسط تكلفة الفدان</p>
            <p className="text-xl font-bold text-brand-700">{egp(avgCostPerFeddan)}</p>
            <p className="text-xs text-brand-400 mt-0.5">ج.م / فدان — كل الحقول</p>
          </div>

          {/* Budget coverage */}
          <div className="card p-4">
            <p className="text-xs text-slate-500 font-medium mb-1">الميزانيات المُعيَّنة</p>
            <div className="flex items-end gap-2 mt-0.5">
              <p className="text-2xl font-bold text-slate-800">{withBudget.length}</p>
              <p className="text-sm text-slate-400 mb-0.5">/ {rows.length}</p>
            </div>
            <div className="flex gap-2 mt-1.5 flex-wrap">
              {overBudget.length > 0 && (
                <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5 font-medium">
                  {overBudget.length} تجاوز
                </span>
              )}
              {warningCount > 0 && (
                <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-medium">
                  {warningCount} تحذير
                </span>
              )}
              {onTrackCount > 0 && (
                <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-medium">
                  {onTrackCount} سليم
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="card p-8 text-center text-slate-400">جاري التحميل...</div>
      ) : rows.length === 0 ? (
        <div className="card p-16 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Wheat size={32} className="text-slate-300" />
          </div>
          <p className="text-slate-500 font-medium">لا توجد حقول مرتبطة بحركات مخزنية</p>
          <p className="text-slate-400 text-sm mt-1">
            ربّط حركات الصرف بالحقول عند إضافة حركة مخزنية جديدة
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {[
                  'الحقل', 'المساحة (فدان)', 'الموسم / المحصول',
                  'التكاليف الكلية', 'تكلفة الفدان',
                  'الميزانية / فدان', 'الانحراف', 'الحالة',
                ].map(h => (
                  <th key={h}
                    className="px-4 py-3 text-xs font-semibold text-slate-500 text-right uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(row => {
                const status    = getBudgetStatus(row)
                const statusCfg = STATUS_CONFIG[status]
                const rowAlert  = status === 'over_budget'

                return (
                  <tr key={row.id}
                    onClick={() => setDrillRow(row)}
                    className={`cursor-pointer transition-colors ${rowAlert ? 'bg-red-50/50 hover:bg-red-50' : 'hover:bg-slate-50'}`}
                  >
                    {/* Field */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0
                          ${rowAlert ? 'bg-red-100' : 'bg-brand-100'}`}>
                          <Leaf size={13} className={rowAlert ? 'text-red-600' : 'text-brand-600'} />
                        </div>
                        <div>
                          <p className="font-semibold text-slate-800">{row.field_name}</p>
                          <p className="text-xs text-slate-400">{row.code}</p>
                        </div>
                      </div>
                    </td>

                    {/* Area */}
                    <td className="px-4 py-3 font-medium text-slate-700 whitespace-nowrap">
                      {num(row.area_feddan, 1)} فدان
                    </td>

                    {/* Season / crop */}
                    <td className="px-4 py-3">
                      <p className="text-slate-600 text-xs">{row.season_name ?? <span className="text-slate-300">—</span>}</p>
                      {row.crop_type && <p className="text-slate-400 text-xs mt-0.5">{row.crop_type}</p>}
                    </td>

                    {/* Cost breakdown */}
                    <td className="px-4 py-3">
                      <div className="space-y-0.5">
                        <p className="font-semibold text-red-600 text-sm">
                          {(row.total_cost ?? row.total_consumed) > 0
                            ? egp(row.total_cost ?? row.total_consumed)
                            : <span className="text-slate-300">—</span>}
                        </p>
                        {row.total_consumed  > 0 && (
                          <span className="flex items-center gap-1 text-violet-600 text-xs">
                            <Package size={10} />{row.items_consumed} صنف · {egp(row.total_consumed)}
                          </span>
                        )}
                        {row.labor_cost     > 0 && <p className="text-xs text-blue-600">عمالة: {egp(row.labor_cost)}</p>}
                        {row.equipment_cost > 0 && <p className="text-xs text-purple-600">معدات: {egp(row.equipment_cost)}</p>}
                        {row.cash_cost      > 0 && <p className="text-xs text-sky-600">نقدي: {egp(row.cash_cost)}</p>}
                      </div>
                    </td>

                    {/* Cost per feddan */}
                    <td className="px-4 py-3">
                      {row.cost_per_feddan != null && row.cost_per_feddan > 0 ? (
                        <div className="flex items-center gap-1">
                          <TrendingUp size={12} className={rowAlert ? 'text-red-500' : 'text-brand-500'} />
                          <span className={`font-bold ${rowAlert ? 'text-red-700' : 'text-brand-700'}`}>
                            {egp(row.cost_per_feddan)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>

                    {/* Budget — inline editable */}
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <BudgetEditor
                        row={row}
                        saving={saving}
                        onSave={(fieldId, seasonId, value) =>
                          upsertBudget({ field_id: fieldId, season_id: seasonId, budget_per_feddan: value })
                        }
                        onDelete={budgetId => deleteBudget(budgetId)}
                      />
                    </td>

                    {/* Variance */}
                    <td className="px-4 py-3">
                      <VarianceBadge pct={row.variance_pct} />
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full border
                        ${statusCfg.bg} ${statusCfg.text} ${statusCfg.border}`}>
                        {status === 'over_budget' && <AlertTriangle size={11} className="ml-1" />}
                        {status === 'on_track'    && <CheckCircle   size={11} className="ml-1" />}
                        {statusCfg.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Legend */}
          <div className="bg-slate-50 border-t border-slate-200 px-4 py-3 flex items-center gap-5 text-xs text-slate-500 flex-wrap">
            <span className="font-semibold">المفتاح:</span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-green-400 inline-block"></span>
              ضمن الميزانية (variance ≤ 0%)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block"></span>
              قرب الحد (0% → 15%)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block"></span>
              تجاوز الحد (&gt; 15%)
            </span>
            <span className="mr-auto text-slate-400 italic">
              اضغط على صف للاطلاع على تفاصيل أوامر العمل
            </span>
          </div>
        </div>
      )}

      {/* ── Work Order Drill-Down Drawer ─────────────────────── */}
      {drillRow && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div className="flex-1 bg-black/30" onClick={() => setDrillRow(null)} />

          {/* Panel */}
          <div className="w-full max-w-md bg-white shadow-2xl flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <p className="font-bold text-slate-800 text-base flex items-center gap-2">
                  <ClipboardList size={16} className="text-brand-600" />
                  {drillRow.field_name}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {drillRow.code} · {drillRow.season_name ?? 'كل المواسم'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    const qs = new URLSearchParams({ field_id: String(drillRow.id) })
                    if (seasonId) qs.set('season_id', seasonId)
                    navigate(`/inventory/movements?${qs.toString()}`)
                  }}
                  className="text-xs text-brand-600 underline hover:opacity-75"
                >
                  حركات المخزون
                </button>
                <button onClick={() => setDrillRow(null)} className="p-1 rounded hover:bg-slate-100 text-slate-500">
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Cost summary */}
            <div className="grid grid-cols-2 gap-3 px-5 py-3 bg-slate-50 border-b border-slate-100 text-xs">
              <div>
                <p className="text-slate-400">إجمالي التكاليف</p>
                <p className="font-bold text-red-600 text-sm">{egp(drillRow.total_cost ?? drillRow.total_consumed)}</p>
              </div>
              <div>
                <p className="text-slate-400">تكلفة الفدان</p>
                <p className="font-bold text-brand-700 text-sm">{egp(drillRow.cost_per_feddan)}</p>
              </div>
              {drillRow.total_consumed > 0 && (
                <div><p className="text-slate-400">مخزون</p><p className="font-semibold text-violet-700">{egp(drillRow.total_consumed)}</p></div>
              )}
              {drillRow.labor_cost > 0 && (
                <div><p className="text-slate-400">عمالة</p><p className="font-semibold text-blue-600">{egp(drillRow.labor_cost)}</p></div>
              )}
              {drillRow.equipment_cost > 0 && (
                <div><p className="text-slate-400">معدات</p><p className="font-semibold text-purple-600">{egp(drillRow.equipment_cost)}</p></div>
              )}
              {drillRow.cash_cost > 0 && (
                <div><p className="text-slate-400">نقدي مباشر</p><p className="font-semibold text-sky-600">{egp(drillRow.cash_cost)}</p></div>
              )}
            </div>

            {/* Work orders list */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                أوامر العمل ({drillOrders.length})
              </p>

              {drillLoading ? (
                <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-slate-400" /></div>
              ) : drillOrders.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-8">لا توجد أوامر عمل مرتبطة بهذا الحقل</p>
              ) : (
                <div className="space-y-2">
                  {drillOrders.map(wo => (
                    <div
                      key={wo.id}
                      className="border border-slate-200 rounded-xl px-4 py-3 hover:border-brand-300 cursor-pointer transition-colors"
                      onClick={() => navigate(`/operations?id=${wo.id}`)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-800 text-sm truncate">{wo.name}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {wo.operation_type} · {wo.planned_date}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-red-600 text-sm">{egp(wo.total_cost)}</p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                            wo.status === 'costed' ? 'bg-emerald-100 text-emerald-700'
                            : wo.status === 'done'   ? 'bg-blue-100 text-blue-700'
                            : 'bg-slate-100 text-slate-500'
                          }`}>{wo.status}</span>
                        </div>
                      </div>
                      {(wo.inv_cost > 0 || wo.labor_cost > 0 || wo.equipment_cost > 0) && (
                        <div className="flex gap-3 mt-2 text-[10px] text-slate-500">
                          {wo.inv_cost      > 0 && <span>مخزون: {egp(wo.inv_cost)}</span>}
                          {wo.labor_cost    > 0 && <span>عمالة: {egp(wo.labor_cost)}</span>}
                          {wo.equipment_cost > 0 && <span>معدات: {egp(wo.equipment_cost)}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
