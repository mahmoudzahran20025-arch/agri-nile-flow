import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Users, Clock, Scale, Tractor, CheckCircle2, AlertCircle, Link2,
  ChevronDown, ChevronRight, Play, Calendar, TrendingDown,
} from 'lucide-react'
import { useState } from 'react'
import SupplierListPage   from './SupplierListPage'
import APAgingPage        from '../treasury/APAgingPage'
import SuppliersBalancePage from '../reports/SuppliersBalancePage'
import { reportsApi } from '../../api/client'
import { assetsApi } from '../../api/assets'
import type { DepreciationScheduleRow } from '../../api/assets'
import { useToast } from '../../contexts/ToastContext'

// ── Depreciation Schedule sub-panel ──────────────────────────
function DepreciationPanel({ assetId, cost }: { assetId: number; cost: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['asset-schedule', assetId],
    queryFn:  () => assetsApi.schedule(assetId),
  })

  const schedule = (data as unknown as { schedule: DepreciationScheduleRow[] } | null)?.schedule ?? []
  const posted   = schedule.filter(r => r.status === 'posted')
  const pending  = schedule.filter(r => r.status === 'pending')
  const totalDep = posted.reduce((s, r) => s + r.amount, 0)
  const bookVal  = Math.max(0, cost - totalDep)

  function egp(n: number) {
    return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
  }

  if (isLoading) return <div className="py-3 text-center text-xs text-slate-400">جار التحميل…</div>

  return (
    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 space-y-3 text-xs">
      {/* Summary row */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-white border border-slate-200 py-2">
          <p className="text-slate-400 text-[11px]">إجمالي الإهلاك</p>
          <p className="font-bold text-red-600 tabular-nums">{egp(totalDep)}</p>
        </div>
        <div className="rounded-lg bg-white border border-slate-200 py-2">
          <p className="text-slate-400 text-[11px]">القيمة الدفترية</p>
          <p className="font-bold text-emerald-700 tabular-nums">{egp(bookVal)}</p>
        </div>
        <div className="rounded-lg bg-white border border-slate-200 py-2">
          <p className="text-slate-400 text-[11px]">دفعات معلّقة</p>
          <p className="font-bold text-amber-600 tabular-nums">{pending.length} شهر</p>
        </div>
      </div>
      {/* Last 6 months schedule */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-[11px]">
          <thead>
            <tr className="text-slate-400 font-semibold">
              <th className="text-right pb-1">الفترة</th>
              <th className="text-right pb-1">قيمة الإهلاك</th>
              <th className="text-right pb-1">الحالة</th>
              <th className="text-right pb-1">القيد</th>
            </tr>
          </thead>
          <tbody>
            {schedule.slice(-6).map(r => (
              <tr key={`${r.period_year}-${r.period_month}`}>
                <td className="py-0.5">{r.period_year}/{String(r.period_month).padStart(2,'0')}</td>
                <td className="tabular-nums">{egp(r.amount)}</td>
                <td>
                  {r.status === 'posted'
                    ? <span className="text-emerald-600 font-semibold">مرحّل ✓</span>
                    : <span className="text-amber-500">معلّق</span>}
                </td>
                <td>{r.journal_entry_id
                  ? <a href={`/gl/entries?id=${r.journal_entry_id}&trace=1`} className="text-blue-600 underline">#{r.journal_entry_id}</a>
                  : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Fixed Assets sub-tab ──────────────────────────────────────
function FixedAssetsPanel() {
  const [expanded, setExpanded] = useState<number | null>(null)
  const qc = useQueryClient()
  const { toast } = useToast()

  const { data: assets, isLoading } = useQuery({
    queryKey: ['fixed-assets'],
    queryFn:  assetsApi.list,
  })
  const assetList = assets ?? []

  const runDepreciation = useMutation({
    mutationFn: assetsApi.runDepreciation,
    onSuccess: (res) => {
      const r = res as unknown as { assets_processed?: number }
      toast(`تم ترحيل الاستهلاك — ${r.assets_processed ?? 0} أصل`, 'success')
      qc.invalidateQueries({ queryKey: ['fixed-assets'] })
      qc.invalidateQueries({ queryKey: ['asset-schedule'] })
    },
    onError: () => toast('حدث خطأ أثناء ترحيل الاستهلاك', 'error'),
  })

  function egp(n: number) {
    return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
  }

  const totalCost   = assetList.reduce((s, a) => s + a.cost, 0)
  const activeCount = assetList.filter(a => a.is_active === 1).length

  if (isLoading) return <div className="py-10 text-center text-slate-400 text-sm">جار التحميل…</div>

  return (
    <div className="space-y-4" dir="rtl">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-4 text-sm">
          <span className="text-slate-500">إجمالي الأصول: <strong>{activeCount}</strong></span>
          <span className="text-slate-500">إجمالي التكلفة: <strong className="text-brand-700">{egp(totalCost)}</strong></span>
        </div>
        <button
          onClick={() => runDepreciation.mutate()}
          disabled={runDepreciation.isPending || assetList.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors"
        >
          <Play size={13} />
          {runDepreciation.isPending ? 'جاري الترحيل…' : 'ترحيل الاستهلاك الشهري'}
        </button>
      </div>

      {/* Assets table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <table className="min-w-full text-[12px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
              <th className="w-8"></th>
              <th className="px-3 py-2.5 text-right">الأصل</th>
              <th className="px-3 py-2.5 text-right">الفئة</th>
              <th className="px-3 py-2.5 text-right">تاريخ الاقتناء</th>
              <th className="px-3 py-2.5 text-right">العمر الافتراضي</th>
              <th className="px-3 py-2.5 text-center">القيد المحاسبي</th>
              <th className="px-3 py-2.5 text-right">الحالة</th>
              <th className="px-3 py-2.5 text-left">التكلفة</th>
            </tr>
          </thead>
          <tbody>
            {assetList.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-slate-400">
                  لا توجد أصول ثابتة مسجّلة — سيتم إنشاؤها تلقائياً عند تسجيل فاتورة معدات
                </td>
              </tr>
            )}
            {assetList.map(asset => (
              <>
                <tr
                  key={asset.id}
                  className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                  onClick={() => setExpanded(expanded === asset.id ? null : asset.id)}
                >
                  <td className="px-2 py-2 text-slate-400">
                    {expanded === asset.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </td>
                  <td className="px-3 py-2 font-semibold text-slate-700">
                    <div className="flex items-center gap-2">
                      <TrendingDown size={12} className="text-amber-500" />
                      {asset.name}
                      <span className="font-mono text-[10px] text-slate-400">{asset.asset_code}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{asset.category}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">
                    <div className="flex items-center gap-1">
                      <Calendar size={11} className="text-slate-400" />
                      {asset.acquisition_date}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{asset.useful_life_months} شهر</td>
                  <td className="px-3 py-2 text-center">
                    {asset.journal_entry_id ? (
                      <a
                        href={`/gl/entries?id=${asset.journal_entry_id}&trace=1`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold hover:bg-emerald-100 transition-colors"
                        onClick={e => e.stopPropagation()}
                      >
                        <CheckCircle2 size={10} />
                        <span className="font-mono">{asset.journal_entry_id}</span>
                        <Link2 size={9} className="opacity-60" />
                      </a>
                    ) : (
                      <span className="text-slate-300 text-[11px]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {asset.is_active
                      ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold"><CheckCircle2 size={9} /> نشط</span>
                      : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[11px]">غير نشط</span>
                    }
                  </td>
                  <td className="px-3 py-2 tabular-nums font-bold text-brand-700 text-left">{egp(asset.cost)}</td>
                </tr>
                {expanded === asset.id && (
                  <tr key={`${asset.id}-sched`} className="bg-slate-50">
                    <td colSpan={8} className="p-0">
                      <DepreciationPanel assetId={asset.id} cost={asset.cost} />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Equipment tab ─────────────────────────────────────────────
function EquipmentTab() {
  const [subTab, setSubTab] = useState<'movements' | 'assets'>('movements')

  const { data, isLoading } = useQuery({
    queryKey: ['supplier-payments-equipment'],
    queryFn:  () => reportsApi.supplierPayments(),
    enabled:  subTab === 'movements',
  })

  const rows = (data?.data as Array<{
    id: number; transaction_date: string; supplier_name: string | null
    document_type: string | null; equipment: string | null; unit: string | null
    quantity: number | null; unit_price: number | null; amount: number
    expense_category: string | null; notes: string | null
    equipment_usage_mode: 'owned' | 'rental' | null
    journal_entry_id: number | null; gl_posted: number | null
  }> ?? []).filter(r => r.equipment)

  function egp(n: number | null) {
    if (n == null) return '—'
    return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
  }

  const byEquipment = rows.reduce<Record<string, { cnt: number; total: number }>>((acc, r) => {
    const key = r.equipment!.trim()
    if (!acc[key]) acc[key] = { cnt: 0, total: 0 }
    acc[key].cnt++
    acc[key].total += r.amount ?? 0
    return acc
  }, {})

  const byMode = rows.reduce<Record<string, { cnt: number; total: number; label: string }>>((acc, r) => {
    const key = r.equipment_usage_mode ?? 'unclassified'
    if (!acc[key]) {
      acc[key] = {
        cnt: 0,
        total: 0,
        label: key === 'owned' ? 'مملوك للشركة' : key === 'rental' ? 'إيجار / تشغيلي' : 'غير مصنف',
      }
    }
    acc[key].cnt++
    acc[key].total += r.amount ?? 0
    return acc
  }, {})

  return (
    <div className="space-y-5 p-4" dir="rtl">
      {/* Sub-tab bar */}
      <div className="flex gap-1 border-b border-slate-200">
        {([
          { id: 'movements', label: 'حركات المعدات', icon: <Tractor size={13} /> },
          { id: 'assets',    label: 'الأصول الثابتة',  icon: <TrendingDown size={13} /> },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-all
              ${subTab === t.id
                ? 'border-amber-500 text-amber-700'
                : 'border-transparent text-slate-400 hover:text-slate-600'}`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'assets' && <FixedAssetsPanel />}

      {subTab === 'movements' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {Object.entries(byMode).map(([mode, summary]) => (
              <div key={mode} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-[13px] font-bold text-slate-700">{summary.label}</p>
                <p className="text-xl font-black text-brand-700 mt-1 tabular-nums">{summary.cnt}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">عملية معدات</p>
                <p className="text-[12px] font-semibold text-emerald-700 mt-2">{egp(summary.total)}</p>
              </div>
            ))}
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {Object.entries(byEquipment).sort((a, b) => b[1].total - a[1].total).map(([eq, s]) => (
              <div key={eq} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-[13px] font-bold text-slate-700">{eq}</p>
                <p className="text-xl font-black text-brand-700 mt-1 tabular-nums">{s.cnt}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">عملية</p>
                <p className="text-[12px] font-semibold text-emerald-700 mt-2">{egp(s.total)}</p>
              </div>
            ))}
          </div>

          {/* Transactions table */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <span className="text-sm font-bold text-slate-700">سجل عمليات المعدات ({rows.length})</span>
            </div>
            {isLoading
              ? <div className="flex items-center justify-center h-40 text-slate-400 text-sm">جار التحميل…</div>
              : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-[12px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                      <th className="px-3 py-2.5 text-right">التاريخ</th>
                      <th className="px-3 py-2.5 text-right">المورد</th>
                      <th className="px-3 py-2.5 text-right">المستند</th>
                      <th className="px-3 py-2.5 text-right">المعدة</th>
                      <th className="px-3 py-2.5 text-right">الملكية</th>
                      <th className="px-3 py-2.5 text-right">الفئة</th>
                      <th className="px-3 py-2.5 text-right">الوحدة</th>
                      <th className="px-3 py-2.5 text-right">الكمية</th>
                      <th className="px-3 py-2.5 text-right">سعر الوحدة</th>
                      <th className="px-3 py-2.5 text-center">القيد</th>
                      <th className="px-3 py-2.5 text-left">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="px-3 py-2 text-slate-600 tabular-nums whitespace-nowrap">{r.transaction_date?.slice(0, 10) ?? '—'}</td>
                        <td className="px-3 py-2 text-slate-700 font-medium">{r.supplier_name ?? '—'}</td>
                        <td className="px-3 py-2 text-slate-500">{r.document_type ?? '—'}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-semibold">
                            <Tractor size={10} />
                            {r.equipment?.trim()}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[11px]">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 border font-semibold ${
                            r.equipment_usage_mode === 'owned'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : r.equipment_usage_mode === 'rental'
                                ? 'bg-sky-50 text-sky-700 border-sky-200'
                                : 'bg-slate-50 text-slate-500 border-slate-200'
                          }`}>
                            {r.equipment_usage_mode === 'owned' ? 'مملوك' : r.equipment_usage_mode === 'rental' ? 'إيجار' : 'غير محدد'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-500 text-[11px]">{r.expense_category ?? '—'}</td>
                        <td className="px-3 py-2 text-slate-500">{r.unit?.trim() ?? '—'}</td>
                        <td className="px-3 py-2 tabular-nums text-right text-slate-700">{r.quantity ?? '—'}</td>
                        <td className="px-3 py-2 tabular-nums text-right text-slate-600">{r.unit_price != null ? egp(r.unit_price) : '—'}</td>
                        <td className="px-3 py-2 text-center">
                          {r.journal_entry_id ? (
                            r.gl_posted === 1 ? (
                              <a href={`/gl/entries?id=${r.journal_entry_id}&trace=1`}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold hover:bg-emerald-100 transition-colors">
                                <CheckCircle2 size={10} />
                                <span className="font-mono">{r.journal_entry_id}</span>
                                <Link2 size={9} className="opacity-60" />
                              </a>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-semibold">
                                <AlertCircle size={10} />
                                مسودة
                              </span>
                            )
                          ) : (
                            <span className="text-slate-300 text-[11px]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-left font-bold text-brand-700">{egp(r.amount)}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={11} className="px-3 py-8 text-center text-slate-400">لا توجد بيانات معدات</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
type Tab = 'list' | 'aging' | 'balance' | 'equipment'

const TABS: { id: Tab; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'list',      icon: <Users   size={15} />, label: 'قائمة الموردين',   color: 'text-brand-600'  },
  { id: 'aging',     icon: <Clock   size={15} />, label: 'تحليل الأعمار',    color: 'text-red-600'    },
  { id: 'balance',   icon: <Scale   size={15} />, label: 'أرصدة ملخصة',      color: 'text-amber-600'  },
  { id: 'equipment', icon: <Tractor size={15} />, label: 'المعدات والميكنة',  color: 'text-orange-600' },
]

export default function SupplierHubPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab | null) ?? 'list'

  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true })

  const active = TABS.find(t => t.id === tab)!

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <span className={active.color}>{active.icon}</span>
          <div>
            <h1 className="page-title">الموردين والذمم الدائنة</h1>
            <p className="text-sm text-slate-500">قائمة الموردين · تحليل الأعمار · أرصدة ملخصة · المعدات والميكنة</p>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-end gap-1 border-b border-slate-200">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`
              flex items-center gap-2 px-5 py-2.5 text-sm font-bold border-b-2 -mb-px transition-all
              ${tab === t.id
                ? `border-current ${t.color}`
                : 'border-transparent text-slate-400 hover:text-slate-600 hover:border-slate-300'}
            `}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Content — suppress inner page headers */}
      <div className="[&_.page-header]:hidden [&_.page-title]:hidden">
        {tab === 'list'      && <SupplierListPage />}
        {tab === 'aging'     && <APAgingPage />}
        {tab === 'balance'   && <SuppliersBalancePage />}
        {tab === 'equipment' && <EquipmentTab />}
      </div>
    </div>
  )
}
