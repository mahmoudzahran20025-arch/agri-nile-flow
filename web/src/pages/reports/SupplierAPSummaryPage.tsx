import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Download, Clock } from 'lucide-react'
import { reportsApi } from '../../api/reports'
import { TableSkeleton } from '../../components/ui/Skeleton'

const EGP = (n: number) =>
  new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)

const PCT = (n: number) => `${n.toFixed(1)}%`

type AgingRow = {
  supplier_code: number; supplier_name: string; supplier_activity: string | null
  open_invoice_count: number; open_amount: number; paid_amount: number
  net_ap_balance: number; oldest_due_date: string | null
  days_overdue_max: number | null; has_estimated_due_date: number
  current_amount: number; overdue_1_30: number
  overdue_31_60: number; overdue_61_90: number; overdue_gt_90: number
}

function AgingBar({ row }: { row: AgingRow }) {
  const total = row.net_ap_balance
  if (total <= 0) return null
  const segments = [
    { val: row.current_amount,  color: 'bg-emerald-400', label: 'جاري' },
    { val: row.overdue_1_30,    color: 'bg-amber-400',   label: '1-30' },
    { val: row.overdue_31_60,   color: 'bg-orange-400',  label: '31-60' },
    { val: row.overdue_61_90,   color: 'bg-red-400',     label: '61-90' },
    { val: row.overdue_gt_90,   color: 'bg-red-700',     label: '+90' },
  ].filter(s => s.val > 0)

  return (
    <div className="flex h-2 rounded-full overflow-hidden w-full min-w-[60px]">
      {segments.map(s => (
        <div
          key={s.label}
          className={`${s.color} h-full`}
          style={{ width: `${(s.val / total) * 100}%` }}
          title={`${s.label}: ${EGP(s.val)}`}
        />
      ))}
    </div>
  )
}

function OverdueBadge({ days }: { days: number | null }) {
  if (days == null || days <= 0) return <span className="text-xs text-emerald-600 font-medium">جاري</span>
  if (days <= 30)  return <span className="text-xs font-semibold text-amber-600">{days}d</span>
  if (days <= 60)  return <span className="text-xs font-semibold text-orange-600">{days}d</span>
  if (days <= 90)  return <span className="text-xs font-semibold text-red-500">{days}d</span>
  return <span className="flex items-center gap-1 text-xs font-bold text-red-700"><Clock size={11} />{days}d</span>
}

function exportCsv(rows: AgingRow[]) {
  const header = 'المورد,رصيد AP,جاري,1-30,31-60,61-90,+90,أقدم استحقاق,عدد الفواتير'
  const lines = rows.map(r =>
    [
      r.supplier_name, r.net_ap_balance, r.current_amount,
      r.overdue_1_30, r.overdue_31_60, r.overdue_61_90, r.overdue_gt_90,
      r.oldest_due_date ?? '', r.open_invoice_count,
    ].join(',')
  )
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `supplier-ap-aging-${new Date().toISOString().slice(0, 10)}.csv`
  a.click(); URL.revokeObjectURL(url)
}

export default function SupplierAPSummaryPage() {
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [serviceClass, setServiceClass] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['supplier-ap-summary', overdueOnly, serviceClass],
    queryFn:  () => reportsApi.supplierApSummary({
      overdue_only: overdueOnly || undefined,
      service_class: serviceClass || undefined,
    }),
  })

  const suppliers = data?.data?.suppliers ?? []
  const summary   = data?.data?.summary
  const byClass   = data?.data?.by_service_class ?? []

  const buckets = summary?.aging_buckets

  return (
    <div className="space-y-6 p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">ملخص الذمم الدائنة للموردين</h1>
          <p className="text-sm text-slate-500 mt-1">تقادم الفواتير المفتوحة وتوزيعها على الموردين</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {suppliers.length > 0 && (
            <button
              onClick={() => exportCsv(suppliers)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <Download size={13} /> تصدير CSV
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={e => setOverdueOnly(e.target.checked)}
            className="rounded border-slate-300 text-brand-600"
          />
          المتأخرون فقط
        </label>
        <select
          value={serviceClass}
          onChange={e => setServiceClass(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <option value="">كل فئات الخدمة</option>
          {[...new Set(byClass.map(b => b.service_group))].map(g => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </div>

      {isLoading && <TableSkeleton rows={6} cols={8} />}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          تعذّر تحميل البيانات
        </div>
      )}

      {/* Summary KPI cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'إجمالي AP المفتوح', value: EGP(summary.total_open_ap) },
            { label: 'مبالغ جارية', value: EGP(summary.current_amount) },
            { label: 'مبالغ متأخرة', value: EGP(summary.total_overdue) },
            { label: 'نسبة التأخر', value: PCT(summary.overdue_pct) },
          ].map(kpi => (
            <div key={kpi.label} className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">{kpi.label}</p>
              <p className="mt-1 text-lg font-bold text-slate-800">{kpi.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Aging buckets bar */}
      {buckets && summary && summary.total_open_ap > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">توزيع التقادم</h2>
          <div className="flex h-4 rounded-lg overflow-hidden mb-3">
            {[
              { val: buckets.current,      color: 'bg-emerald-400', label: 'جاري' },
              { val: buckets.overdue_1_30,  color: 'bg-amber-400',   label: '1-30' },
              { val: buckets.overdue_31_60, color: 'bg-orange-400',  label: '31-60' },
              { val: buckets.overdue_61_90, color: 'bg-red-400',     label: '61-90' },
              { val: buckets.overdue_gt_90, color: 'bg-red-700',     label: '+90' },
            ].filter(s => s.val > 0).map(s => (
              <div
                key={s.label}
                className={`${s.color} h-full`}
                style={{ width: `${(s.val / summary.total_open_ap) * 100}%` }}
                title={`${s.label}: ${EGP(s.val)}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-slate-600">
            {[
              { val: buckets.current,      color: 'bg-emerald-400', label: 'جاري' },
              { val: buckets.overdue_1_30,  color: 'bg-amber-400',   label: '1-30 يوم' },
              { val: buckets.overdue_31_60, color: 'bg-orange-400',  label: '31-60 يوم' },
              { val: buckets.overdue_61_90, color: 'bg-red-400',     label: '61-90 يوم' },
              { val: buckets.overdue_gt_90, color: 'bg-red-700',     label: '+90 يوم' },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-1.5">
                <div className={`w-2.5 h-2.5 rounded-sm ${s.color}`} />
                <span>{s.label}: <strong>{EGP(s.val)}</strong></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Estimated due date warning */}
      {summary && summary.estimated_due_date_count > 0 && (
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <span>{summary._note}</span>
        </div>
      )}

      {/* Per-supplier aging table */}
      {suppliers.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm text-right">
            <thead className="border-b border-slate-100 bg-slate-50">
              <tr>
                {['المورد', 'رصيد AP', 'جاري', '1-30', '31-60', '61-90', '+90', 'أقدم استحقاق', 'توزيع', 'تأخر أقصى'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {suppliers.map(r => (
                <tr key={r.supplier_code} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {r.supplier_name}
                    {r.supplier_activity && (
                      <span className="block text-[11px] text-slate-400">{r.supplier_activity}</span>
                    )}
                    {r.has_estimated_due_date ? (
                      <span className="text-[10px] text-amber-600">~ تقديري</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold text-slate-800">{EGP(r.net_ap_balance)}</td>
                  <td className="px-4 py-3 font-mono text-emerald-700">{r.current_amount > 0 ? EGP(r.current_amount) : '—'}</td>
                  <td className="px-4 py-3 font-mono text-amber-600">{r.overdue_1_30 > 0 ? EGP(r.overdue_1_30) : '—'}</td>
                  <td className="px-4 py-3 font-mono text-orange-600">{r.overdue_31_60 > 0 ? EGP(r.overdue_31_60) : '—'}</td>
                  <td className="px-4 py-3 font-mono text-red-500">{r.overdue_61_90 > 0 ? EGP(r.overdue_61_90) : '—'}</td>
                  <td className="px-4 py-3 font-mono text-red-700 font-semibold">{r.overdue_gt_90 > 0 ? EGP(r.overdue_gt_90) : '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{r.oldest_due_date ?? '—'}</td>
                  <td className="px-4 py-3 min-w-[80px]"><AgingBar row={r} /></td>
                  <td className="px-4 py-3"><OverdueBadge days={r.days_overdue_max} /></td>
                </tr>
              ))}
            </tbody>
            {summary && (
              <tfoot className="border-t border-slate-200 bg-slate-50">
                <tr className="font-semibold text-slate-700">
                  <td className="px-4 py-3">الإجمالي ({summary.supplier_count} مورد)</td>
                  <td className="px-4 py-3 font-mono">{EGP(summary.total_open_ap)}</td>
                  <td className="px-4 py-3 font-mono text-emerald-700">{EGP(buckets?.current ?? 0)}</td>
                  <td className="px-4 py-3 font-mono text-amber-600">{EGP(buckets?.overdue_1_30 ?? 0)}</td>
                  <td className="px-4 py-3 font-mono text-orange-600">{EGP(buckets?.overdue_31_60 ?? 0)}</td>
                  <td className="px-4 py-3 font-mono text-red-500">{EGP(buckets?.overdue_61_90 ?? 0)}</td>
                  <td className="px-4 py-3 font-mono text-red-700">{EGP(buckets?.overdue_gt_90 ?? 0)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* By service class breakdown */}
      {byClass.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">تفصيل حسب فئة الخدمة</h2>
          </div>
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {['فئة الخدمة', 'المجموعة', 'عدد الموردين', 'إجمالي مفوتر', 'إجمالي مدفوع', 'عدد الفواتير'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {byClass.map(b => (
                <tr key={b.service_type_code} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{b.service_type_name_ar}</td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">{b.service_group}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-600">{b.supplier_count}</td>
                  <td className="px-4 py-3 font-mono font-semibold text-slate-800">{EGP(b.open_invoiced)}</td>
                  <td className="px-4 py-3 font-mono text-emerald-700">{EGP(b.total_paid)}</td>
                  <td className="px-4 py-3 font-mono text-slate-600">{b.invoice_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && suppliers.length === 0 && !error && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-400">
          لا توجد فواتير مفتوحة مطابقة للفلتر المحدد
        </div>
      )}
    </div>
  )
}
