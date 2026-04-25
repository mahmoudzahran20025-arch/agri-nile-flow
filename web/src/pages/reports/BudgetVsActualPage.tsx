import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Target, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle2, XCircle, Loader2, RefreshCw,
  ChevronUp, ChevronDown, Wheat, MapPin, BarChart3,
} from 'lucide-react'
import { reportsApi, configApi } from '../../api/client'
import type { Season } from '../../types'

// ── Helpers ───────────────────────────────────────────────────
function egp(n: number) {
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}
function pct(n: number | null) {
  if (n == null) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
}

// ── Status config ──────────────────────────────────────────────
const STATUS_CFG = {
  on_track:    { label: 'في الميزانية',   bar: 'bg-emerald-500', text: 'text-emerald-700', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',  icon: <CheckCircle2 size={13} /> },
  at_risk:     { label: 'تحت المراقبة',   bar: 'bg-amber-400',   text: 'text-amber-700',   badge: 'bg-amber-50 text-amber-700 border-amber-200',         icon: <AlertTriangle size={13} /> },
  over_budget: { label: 'تجاوز الميزانية', bar: 'bg-red-500',     text: 'text-red-700',     badge: 'bg-red-50 text-red-700 border-red-200',               icon: <XCircle size={13} /> },
  no_budget:   { label: 'بدون ميزانية',   bar: 'bg-slate-200',   text: 'text-slate-400',   badge: 'bg-slate-50 text-slate-500 border-slate-200',          icon: <Target size={13} /> },
}

type RowData = {
  id: number; code: string; field_name: string; area_feddan: number; crop_type: string | null
  budget_per_feddan: number; budget_total: number
  inv_cost: number; labor_cost: number; cash_cost: number; actual_total: number; actual_per_feddan: number
  variance: number; variance_pct: number | null; utilization_pct: number | null
  status: 'on_track' | 'at_risk' | 'over_budget' | 'no_budget'
}

// ── Utilization bar ──────────────────────────────────────────
function UtilBar({ pct: p, status }: { pct: number | null; status: RowData['status'] }) {
  if (p == null) return <span className="text-slate-300 text-xs">—</span>
  const capped = Math.min(p, 120)
  const cfg = STATUS_CFG[status]
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden min-w-[60px]">
        <div
          className={`h-full rounded-full transition-all duration-700 ${cfg.bar}`}
          style={{ width: `${(capped / 120) * 100}%` }}
        />
      </div>
      <span className={`text-xs font-semibold tabular-nums w-12 text-right ${cfg.text}`}>{p.toFixed(0)}%</span>
    </div>
  )
}

// ── Field row ──────────────────────────────────────────────────
function FieldRow({ row }: { row: RowData }) {
  const navigate = useNavigate()
  const cfg = STATUS_CFG[row.status]
  const isOver = row.variance > 0

  return (
    <tr
      className="hover:bg-slate-50 cursor-pointer border-b border-slate-100 transition-colors"
      onClick={() => navigate(`/fields`)}
    >
      {/* Field */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
            <MapPin size={13} className="text-brand-500" />
          </div>
          <div>
            <p className="font-semibold text-slate-800 text-sm">{row.field_name}</p>
            <p className="text-xs text-slate-400">
              {row.area_feddan} فدان
              {row.crop_type && <> · {row.crop_type}</>}
            </p>
          </div>
        </div>
      </td>

      {/* Budget */}
      <td className="px-4 py-3 text-right">
        {row.budget_total > 0 ? (
          <>
            <p className="font-semibold text-slate-700 text-sm tabular-nums">{egp(row.budget_total)}</p>
            <p className="text-xs text-slate-400 tabular-nums">{egp(row.budget_per_feddan)} / فدان</p>
          </>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </td>

      {/* Actual */}
      <td className="px-4 py-3 text-right">
        <p className="font-semibold text-slate-700 text-sm tabular-nums">{egp(row.actual_total)}</p>
        <p className="text-[10px] text-slate-400 tabular-nums mt-0.5 space-x-1 rtl:space-x-reverse">
          {row.inv_cost > 0 && <span>مخزون {egp(row.inv_cost)}</span>}
          {row.labor_cost > 0 && <span>· عمالة {egp(row.labor_cost)}</span>}
          {row.cash_cost > 0 && <span>· نقدي {egp(row.cash_cost)}</span>}
        </p>
      </td>

      {/* Variance */}
      <td className="px-4 py-3 text-right">
        {row.budget_total > 0 ? (
          <div className="flex items-center justify-end gap-1">
            {isOver
              ? <TrendingUp size={13} className="text-red-500" />
              : <TrendingDown size={13} className="text-emerald-500" />
            }
            <span className={`font-bold text-sm tabular-nums ${isOver ? 'text-red-600' : 'text-emerald-600'}`}>
              {isOver ? '+' : ''}{egp(row.variance)}
            </span>
          </div>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </td>

      {/* Utilization */}
      <td className="px-4 py-3 min-w-[160px]">
        <UtilBar pct={row.utilization_pct} status={row.status} />
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full border ${cfg.badge}`}>
          {cfg.icon}
          {cfg.label}
        </span>
      </td>
    </tr>
  )
}

// ── Summary card ──────────────────────────────────────────────
function SumCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: 'green' | 'red' | 'blue' | 'slate' }) {
  const colors = {
    green: 'bg-emerald-50 border-emerald-100 text-emerald-700',
    red:   'bg-red-50 border-red-100 text-red-700',
    blue:  'bg-brand-50 border-brand-100 text-brand-700',
    slate: 'bg-slate-50 border-slate-100 text-slate-600',
  }
  return (
    <div className={`rounded-2xl border p-4 ${colors[color]}`}>
      <p className="text-xs font-medium opacity-70 mb-1">{label}</p>
      <p className="text-2xl font-black tabular-nums">{value}</p>
      {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────
type SortKey = 'field_name' | 'budget_total' | 'actual_total' | 'variance' | 'utilization_pct'
type SortDir = 'asc' | 'desc'

export default function BudgetVsActualPage() {
  const [seasonId, setSeasonId] = useState<number | null>(null)
  const [sortKey, setSortKey]   = useState<SortKey>('actual_total')
  const [sortDir, setSortDir]   = useState<SortDir>('desc')
  const [statusFilter, setStatusFilter] = useState<RowData['status'] | 'all'>('all')

  const { data: seasons = [] } = useQuery({
    queryKey: ['config', 'seasons'],
    queryFn:  configApi.seasons as () => Promise<Season[]>,
    staleTime: 120_000,
  })

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['reports', 'budget-vs-actual', seasonId],
    queryFn:  () => reportsApi.budgetVsActual(seasonId!),
    enabled:  !!seasonId,
    staleTime: 60_000,
  })

  const totals = data?.totals
  const rows   = data?.rows ?? []

  const sorted = useMemo(() => {
    let r = [...rows]
    if (statusFilter !== 'all') r = r.filter(row => row.status === statusFilter)
    r.sort((a, b) => {
      const av = a[sortKey] ?? 0
      const bv = b[sortKey] ?? 0
      const cmp = typeof av === 'string' ? (av as string).localeCompare(bv as string, 'ar') : Number(av) - Number(bv)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return r
  }, [rows, sortKey, sortDir, statusFilter])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ChevronDown size={12} className="text-slate-300" />
    return sortDir === 'asc' ? <ChevronUp size={12} className="text-brand-500" /> : <ChevronDown size={12} className="text-brand-500" />
  }

  const overallColor = totals?.variance != null
    ? (totals.variance > 0 ? 'red' : 'green')
    : 'slate'

  const counts = {
    on_track:    rows.filter(r => r.status === 'on_track').length,
    at_risk:     rows.filter(r => r.status === 'at_risk').length,
    over_budget: rows.filter(r => r.status === 'over_budget').length,
    no_budget:   rows.filter(r => r.status === 'no_budget').length,
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-brand-100 rounded-xl">
            <Target size={20} className="text-brand-600" />
          </div>
          <div>
            <h1 className="page-title">الميزانية مقابل الفعلي</h1>
            <p className="text-sm text-slate-400">متابعة تنفيذ ميزانية كل حقل خلال الموسم</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {seasonId && (
            <button onClick={() => refetch()} disabled={isFetching} className="btn-secondary gap-1.5">
              <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
              تحديث
            </button>
          )}
          <select
            className="input w-52 text-sm"
            value={seasonId ?? ''}
            onChange={e => setSeasonId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— اختر الموسم —</option>
            {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {/* Empty state */}
      {!seasonId && (
        <div className="card p-16 text-center">
          <div className="w-16 h-16 bg-brand-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <BarChart3 size={32} className="text-brand-300" />
          </div>
          <p className="text-slate-500 font-medium">اختر موسماً لعرض تقرير الميزانية</p>
          <p className="text-xs text-slate-400 mt-1">سيظهر مقارنة الميزانية المحددة بالتكلفة الفعلية لكل حقل</p>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="card p-12 flex flex-col items-center gap-3 text-slate-400">
          <Loader2 size={28} className="animate-spin text-brand-400" />
          <p className="text-sm">جاري حساب التكاليف...</p>
        </div>
      )}

      {data && totals && (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SumCard
              label="إجمالي الميزانية"
              value={egp(totals.budget)}
              sub={`${totals.budgeted_fields} حقل محدد له ميزانية`}
              color="blue"
            />
            <SumCard
              label="إجمالي الفعلي"
              value={egp(totals.actual)}
              sub="مخزون + عمالة حقلية"
              color="slate"
            />
            <SumCard
              label={totals.variance > 0 ? 'تجاوز الميزانية' : 'وفر في الميزانية'}
              value={`${totals.variance > 0 ? '+' : ''}${egp(totals.variance)}`}
              sub={totals.variance_pct != null ? pct(totals.variance_pct) : '—'}
              color={overallColor as 'green' | 'red'}
            />
            <SumCard
              label="تجاوز الحدود"
              value={`${totals.over_budget_count} حقل`}
              sub={`من أصل ${totals.budgeted_fields} حقل محدد`}
              color={totals.over_budget_count > 0 ? 'red' : 'green'}
            />
          </div>

          {/* Overall progress bar */}
          {totals.utilization_pct != null && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <BarChart3 size={16} className="text-brand-500" />
                  <p className="font-semibold text-slate-700 text-sm">إجمالي استهلاك الميزانية</p>
                </div>
                <span className={`text-lg font-black tabular-nums ${
                  totals.utilization_pct > 100 ? 'text-red-600'
                  : totals.utilization_pct > 80 ? 'text-amber-600'
                  : 'text-emerald-600'
                }`}>
                  {totals.utilization_pct.toFixed(1)}%
                </span>
              </div>
              <div className="bg-slate-100 rounded-full h-3 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ${
                    totals.utilization_pct > 100 ? 'bg-red-500'
                    : totals.utilization_pct > 80 ? 'bg-amber-400'
                    : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(totals.utilization_pct, 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-400 mt-1.5">
                <span>0%</span>
                <span className="text-amber-500 font-medium">80% (تحذير)</span>
                <span className="text-red-500 font-medium">100% (الحد)</span>
              </div>
            </div>
          )}

          {/* Status filter pills */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-slate-400 font-medium">فلتر:</span>
            {([
              { key: 'all',         label: `الكل (${rows.length})` },
              { key: 'on_track',    label: `في الميزانية (${counts.on_track})` },
              { key: 'at_risk',     label: `تحت المراقبة (${counts.at_risk})` },
              { key: 'over_budget', label: `تجاوز (${counts.over_budget})` },
              { key: 'no_budget',   label: `بدون ميزانية (${counts.no_budget})` },
            ] as const).map(f => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-all ${
                  statusFilter === f.key
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-brand-300'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="card overflow-hidden">
            <table className="w-full text-sm" dir="rtl">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th
                    className="px-4 py-3 text-right text-xs font-bold text-slate-500 cursor-pointer hover:text-brand-600 select-none"
                    onClick={() => toggleSort('field_name')}
                  >
                    <div className="flex items-center gap-1">الحقل <SortIcon k="field_name" /></div>
                  </th>
                  <th
                    className="px-4 py-3 text-right text-xs font-bold text-slate-500 cursor-pointer hover:text-brand-600 select-none"
                    onClick={() => toggleSort('budget_total')}
                  >
                    <div className="flex items-center justify-end gap-1"><SortIcon k="budget_total" /> الميزانية</div>
                  </th>
                  <th
                    className="px-4 py-3 text-right text-xs font-bold text-slate-500 cursor-pointer hover:text-brand-600 select-none"
                    onClick={() => toggleSort('actual_total')}
                  >
                    <div className="flex items-center justify-end gap-1"><SortIcon k="actual_total" /> الفعلي</div>
                  </th>
                  <th
                    className="px-4 py-3 text-right text-xs font-bold text-slate-500 cursor-pointer hover:text-brand-600 select-none"
                    onClick={() => toggleSort('variance')}
                  >
                    <div className="flex items-center justify-end gap-1"><SortIcon k="variance" /> الفرق</div>
                  </th>
                  <th
                    className="px-4 py-3 text-right text-xs font-bold text-slate-500 cursor-pointer hover:text-brand-600 select-none min-w-[180px]"
                    onClick={() => toggleSort('utilization_pct')}
                  >
                    <div className="flex items-center gap-1">الاستهلاك <SortIcon k="utilization_pct" /></div>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-slate-500">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                      <Wheat size={28} className="mx-auto mb-2 text-slate-200" />
                      <p>لا توجد حقول في هذا الموسم</p>
                    </td>
                  </tr>
                ) : (
                  sorted.map(row => <FieldRow key={row.id} row={row} />)
                )}
              </tbody>
            </table>
          </div>

          {/* Cost breakdown note */}
          <p className="text-xs text-slate-400 text-center pb-2">
            * التكلفة الفعلية تشمل: مواد المخزون المصروفة لكل حقل + تكلفة عمالة أوامر العمل.
            المصروفات النقدية ومديونيات الموردين على مستوى الموسم فقط (لا تُنسب لحقل بعينه).
          </p>
        </>
      )}
    </div>
  )
}
