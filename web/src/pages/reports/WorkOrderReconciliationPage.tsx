import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, ClipboardList, ChevronDown, ChevronUp, AlertTriangle, CheckCircle } from 'lucide-react'
import { cropCyclesApi, type CropCycle } from '../../api/crop-cycles'

const EGP = (n: number) =>
  new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(n)

const CATEGORY_AR: Record<string, string> = {
  materials: 'مستلزمات', labor: 'عمالة', equipment: 'معدات', overhead: 'مصروفات عامة',
  depreciation: 'استهلاك', irrigation: 'ري', land_rent: 'إيجار أرض', fuel: 'وقود',
  maintenance: 'صيانة', contractor: 'مقاولات', transport: 'نقل', other: 'أخرى',
}

export default function WorkOrderReconciliationPage() {
  const [selectedCycleId, setSelectedCycle] = useState<string>('')
  const [expandedWO, setExpandedWO] = useState<number | null>(null)

  const { data: cyclesData } = useQuery({
    queryKey: ['crop-cycles-list'],
    queryFn:  () => cropCyclesApi.list(),
  })

  const { data, isLoading, isError } = useQuery({
    queryKey: ['wo-reconciliation', selectedCycleId],
    queryFn:  () => cropCyclesApi.workOrderReconciliation(Number(selectedCycleId)),
    enabled:  Boolean(selectedCycleId),
  })

  const cycles = (cyclesData ?? []) as CropCycle[]

  return (
    <div className="p-6 max-w-5xl mx-auto" dir="rtl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
          <ClipboardList size={20} className="text-violet-700" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">مطابقة أوامر العمل</h1>
          <p className="text-sm text-slate-500">مقارنة التكاليف المخططة بالفعلية لكل أمر عمل</p>
        </div>
      </div>

      {/* Cycle selector */}
      <div className="mb-6">
        <select
          className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/30 min-w-[280px]"
          value={selectedCycleId}
          onChange={e => { setSelectedCycle(e.target.value); setExpandedWO(null) }}
        >
          <option value="">اختر دورة زراعية...</option>
          {cycles.map(c => (
            <option key={c.id} value={c.id}>{c.crop_name} — {c.field_name} ({c.season_name})</option>
          ))}
        </select>
      </div>

      {!selectedCycleId && (
        <div className="text-center py-16 text-slate-400">
          <ClipboardList size={32} className="mx-auto mb-3 opacity-30" />
          <p>اختر دورة زراعية لعرض مطابقة أوامر العمل</p>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="animate-spin text-[#0F2D5C]" size={28} />
        </div>
      )}

      {isError && (
        <div className="text-center py-8 text-rose-500 text-sm">حدث خطأ في تحميل البيانات</div>
      )}

      {data && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <p className="text-xs text-slate-400 mb-1">إجمالي المخطط</p>
              <p className="text-xl font-bold text-slate-800">{EGP(data.summary.total_planned)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <p className="text-xs text-slate-400 mb-1">إجمالي الفعلي</p>
              <p className="text-xl font-bold text-slate-800">{EGP(data.summary.total_actual)}</p>
            </div>
            <div className={`bg-white rounded-2xl border shadow-sm p-5 ${
              data.summary.total_variance > 0 ? 'border-rose-200' : 'border-emerald-200'
            }`}>
              <p className="text-xs text-slate-400 mb-1">الفرق</p>
              <p className={`text-xl font-bold ${data.summary.total_variance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                {data.summary.total_variance >= 0 ? '+' : ''}{EGP(data.summary.total_variance)}
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <p className="text-xs text-slate-400 mb-1">تكاليف غير مُسنَدة</p>
              <p className={`text-xl font-bold ${data.summary.unattributed_cost > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                {EGP(data.summary.unattributed_cost)}
              </p>
            </div>
          </div>

          {/* Work Orders Table */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-700">تفاصيل أوامر العمل ({data.summary.work_order_count})</h2>
            </div>
            {data.work_orders.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm">لا توجد أوامر عمل مرتبطة بهذه الدورة</div>
            ) : (
              <div className="divide-y divide-slate-50">
                {data.work_orders.map(wo => {
                  const isOver = wo.variance > 0
                  const isExpanded = expandedWO === wo.id
                  return (
                    <div key={wo.id}>
                      <button
                        className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50/50 transition-colors text-right"
                        onClick={() => setExpandedWO(isExpanded ? null : wo.id)}
                      >
                        <div className="flex items-center gap-3">
                          {isOver
                            ? <AlertTriangle size={16} className="text-rose-400 shrink-0" />
                            : <CheckCircle  size={16} className="text-emerald-400 shrink-0" />}
                          <div className="text-right">
                            <p className="text-sm font-medium text-slate-800">{wo.title}</p>
                            <p className="text-xs text-slate-400 font-mono">#{wo.id}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <p className="text-xs text-slate-400">مخطط</p>
                            <p className="text-sm font-mono">{EGP(wo.planned_cost)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-slate-400">فعلي</p>
                            <p className="text-sm font-mono">{EGP(wo.actual_cost)}</p>
                          </div>
                          <div className="text-right w-24">
                            <p className="text-xs text-slate-400">الفرق</p>
                            <p className={`text-sm font-semibold font-mono ${isOver ? 'text-rose-600' : 'text-emerald-600'}`}>
                              {wo.variance >= 0 ? '+' : ''}{EGP(wo.variance)}
                            </p>
                          </div>
                          {isExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                        </div>
                      </button>

                      {isExpanded && wo.lines.length > 0 && (
                        <div className="px-6 pb-4 bg-slate-50/50">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-slate-400">
                                <th className="text-right py-2 font-medium">الفئة</th>
                                <th className="text-right py-2 font-medium">مدين</th>
                                <th className="text-right py-2 font-medium">دائن</th>
                                <th className="text-right py-2 font-medium">الرصيد</th>
                              </tr>
                            </thead>
                            <tbody>
                              {wo.lines.map((line, idx) => (
                                <tr key={idx} className="border-t border-slate-100">
                                  <td className="py-1.5 text-slate-600">{CATEGORY_AR[line.cost_category] ?? line.cost_category}</td>
                                  <td className="py-1.5 font-mono text-slate-700">{EGP(line.debit)}</td>
                                  <td className="py-1.5 font-mono text-slate-500">{EGP(line.credit)}</td>
                                  <td className="py-1.5 font-mono font-medium text-slate-800">{EGP(line.balance)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Unattributed */}
          {data.unattributed.length > 0 && (
            <div className="bg-amber-50 rounded-2xl border border-amber-200 p-6">
              <h2 className="text-base font-bold text-amber-800 mb-4 flex items-center gap-2">
                <AlertTriangle size={16} /> تكاليف غير مُسنَدة لأوامر عمل
              </h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-amber-600 text-xs">
                    <th className="text-right py-1.5 font-medium">الفئة</th>
                    <th className="text-right py-1.5 font-medium">مدين</th>
                    <th className="text-right py-1.5 font-medium">دائن</th>
                    <th className="text-right py-1.5 font-medium">الرصيد</th>
                  </tr>
                </thead>
                <tbody>
                  {data.unattributed.map((row, idx) => (
                    <tr key={idx} className="border-t border-amber-100">
                      <td className="py-2 text-amber-900">{CATEGORY_AR[row.cost_category] ?? row.cost_category}</td>
                      <td className="py-2 font-mono text-amber-900">{EGP(row.total_debit)}</td>
                      <td className="py-2 font-mono text-amber-700">{EGP(row.total_credit)}</td>
                      <td className="py-2 font-mono font-bold text-amber-900">{EGP(row.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
