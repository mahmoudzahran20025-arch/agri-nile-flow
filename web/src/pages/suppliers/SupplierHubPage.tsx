import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Users, Clock, Scale, Tractor, CheckCircle2, AlertCircle, Link2 } from 'lucide-react'
import SupplierListPage   from './SupplierListPage'
import APAgingPage        from '../treasury/APAgingPage'
import SuppliersBalancePage from '../reports/SuppliersBalancePage'
import { reportsApi } from '../../api/client'

// ── Equipment tab ─────────────────────────────────────────────
function EquipmentTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['supplier-payments-equipment'],
    queryFn:  () => reportsApi.supplierPayments(),
  })

  const rows = (data?.data as Array<{
    id: number; transaction_date: string; supplier_name: string | null
    document_type: string | null; equipment: string | null; unit: string | null
    quantity: number | null; unit_price: number | null; amount: number
    expense_category: string | null; notes: string | null
    journal_entry_id: number | null; gl_posted: number | null
  }> ?? []).filter(r => r.equipment)

  function egp(n: number | null) {
    if (n == null) return '—'
    return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
  }

  // Group summary by equipment type
  const byEquipment = rows.reduce<Record<string, { cnt: number; total: number }>>((acc, r) => {
    const key = r.equipment!.trim()
    if (!acc[key]) acc[key] = { cnt: 0, total: 0 }
    acc[key].cnt++
    acc[key].total += r.amount ?? 0
    return acc
  }, {})

  if (isLoading) return (
    <div className="flex items-center justify-center h-40 text-slate-400 text-sm">جار التحميل…</div>
  )

  return (
    <div className="space-y-6 p-4" dir="rtl">
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
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-700">سجل عمليات المعدات ({rows.length})</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-[12px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                <th className="px-3 py-2.5 text-right">التاريخ</th>
                <th className="px-3 py-2.5 text-right">المورد</th>
                <th className="px-3 py-2.5 text-right">المستند</th>
                <th className="px-3 py-2.5 text-right">المعدة</th>
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
                  <td className="px-3 py-2 text-slate-500 text-[11px]">{r.expense_category ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{r.unit?.trim() ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-right text-slate-700">{r.quantity ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-right text-slate-600">{r.unit_price != null ? egp(r.unit_price) : '—'}</td>
                  <td className="px-3 py-2 text-center">
                    {r.journal_entry_id ? (
                      r.gl_posted === 1 ? (
                        <a
                          href={`/gl/entries/${r.journal_entry_id}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold hover:bg-emerald-100 transition-colors"
                          title={`قيد #${r.journal_entry_id}`}
                        >
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
                  <td colSpan={10} className="px-3 py-8 text-center text-slate-400">لا توجد بيانات معدات</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
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
