import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DollarSign, Play, CheckCircle, ChevronDown, ChevronUp, FileText } from 'lucide-react'
import { hrApi } from '../../api/hr'
import type { PayrollRun, PayrollItem } from '../../api/hr'

const MONTH_NAMES = [
  '','يناير','فبراير','مارس','إبريل','مايو','يونيو',
  'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'
]

const STATUS_MAP: Record<string, {label:string;color:string}> = {
  draft:     { label: 'مسودة',   color: 'bg-yellow-100 text-yellow-700' },
  approved:  { label: 'معتمدة', color: 'bg-emerald-100 text-emerald-700' },
  paid:      { label: 'مدفوعة', color: 'bg-blue-100 text-blue-700' },
  cancelled: { label: 'ملغاة',  color: 'bg-red-100 text-red-700' },
}

export default function PayrollPage() {
  const qc = useQueryClient()
  const now = new Date()
  const [runYear,  setRunYear]  = useState(now.getFullYear())
  const [runMonth, setRunMonth] = useState(now.getMonth() + 1)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const { data: runsRes } = useQuery({
    queryKey: ['hr-payroll'],
    queryFn: () => hrApi.getPayrollRuns(),
  })

  const { data: detailRes, isLoading: detailLoading } = useQuery({
    queryKey: ['hr-payroll-detail', expandedId],
    queryFn: () => hrApi.getPayrollRun(expandedId!),
    enabled: !!expandedId,
  })

  const runMut = useMutation({
    mutationFn: () => hrApi.runPayroll(runYear, runMonth),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-payroll'] }),
  })

  const approveMut = useMutation({
    mutationFn: (id: number) => hrApi.approvePayroll(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-payroll'] })
      qc.invalidateQueries({ queryKey: ['hr-payroll-detail'] })
    },
  })

  const runs: PayrollRun[] = runsRes ?? []
  const detail = detailRes

  const totalNetAll = runs.reduce((s, r) => s + r.total_net, 0)

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-green-100 rounded-lg">
          <DollarSign size={22} className="text-green-700" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">مسيرات الرواتب</h1>
          <p className="text-sm text-gray-500">{runs.length} مسيرة مسجلة</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-white border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-gray-900">{runs.length}</div>
          <div className="text-xs text-gray-500 mt-1">إجمالي المسيرات</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-emerald-700">{totalNetAll.toLocaleString()}</div>
          <div className="text-xs text-emerald-600 mt-1">إجمالي صافي الرواتب (ج.م)</div>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-yellow-700">
            {runs.filter(r => r.status === 'draft').length}
          </div>
          <div className="text-xs text-yellow-600 mt-1">مسيرات مسودة</div>
        </div>
      </div>

      {/* Run new payroll */}
      <div className="bg-white border rounded-xl p-5">
        <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <Play size={18} className="text-green-600" /> تشغيل مسيرة جديدة
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={runYear} onChange={e => setRunYear(Number(e.target.value))}
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
            {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select value={runMonth} onChange={e => setRunMonth(Number(e.target.value))}
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
            {MONTH_NAMES.slice(1).map((m, i) => (
              <option key={i+1} value={i+1}>{m}</option>
            ))}
          </select>
          <button
            onClick={() => runMut.mutate()}
            disabled={runMut.isPending}
            className="flex items-center gap-2 bg-green-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
          >
            <Play size={14} />
            {runMut.isPending ? 'جاري الحساب...' : `تشغيل ${MONTH_NAMES[runMonth]} ${runYear}`}
          </button>
        </div>
        {runMut.isSuccess && (
          <div className="mt-3 text-sm text-emerald-600 bg-emerald-50 rounded-lg px-4 py-2">
            ✓ تم إنشاء المسيرة — صافي الرواتب: {(runMut.data as {total_net:number})?.total_net.toLocaleString()} ج.م
          </div>
        )}
        {runMut.isError && (
          <div className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">
            {(runMut.error as Error)?.message}
          </div>
        )}
      </div>

      {/* Payroll runs list */}
      <div className="space-y-3">
        {runs.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <FileText size={36} className="mx-auto mb-2 opacity-30" />
            <p>لا توجد مسيرات رواتب بعد</p>
          </div>
        ) : runs.map(run => {
          const st = STATUS_MAP[run.status] ?? STATUS_MAP.draft
          const isExpanded = expandedId === run.id
          return (
            <div key={run.id} className="bg-white border rounded-xl overflow-hidden">
              {/* Run header */}
              <div
                className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50"
                onClick={() => setExpandedId(isExpanded ? null : run.id)}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">
                      {MONTH_NAMES[run.period_month]} {run.period_year}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                    {run.journal_entry_id && (
                      <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">GL ✓</span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                    <span>إجمالي: {run.total_gross.toLocaleString()} ج.م</span>
                    <span>خصومات: {run.total_deductions.toLocaleString()} ج.م</span>
                    <span className="font-semibold text-green-700">صافي: {run.total_net.toLocaleString()} ج.م</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {run.status === 'draft' && (
                    <button
                      onClick={e => { e.stopPropagation(); approveMut.mutate(run.id) }}
                      disabled={approveMut.isPending}
                      className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <CheckCircle size={14} /> اعتماد + قيد
                    </button>
                  )}
                  {isExpanded ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                </div>
              </div>

              {/* Expanded: items */}
              {isExpanded && (
                <div className="border-t bg-gray-50">
                  {detailLoading ? (
                    <div className="p-4 space-y-2">
                      {[1,2,3].map(i => <div key={i} className="h-10 bg-gray-200 animate-pulse rounded" />)}
                    </div>
                  ) : detail?.items?.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[900px]">
                        <thead className="border-b bg-white">
                          <tr>
                            {['الموظف','أيام عمل','غياب','OT','الراتب','بدلات','إجمالي','خصومات','صافي'].map(h => (
                              <th key={h} className="text-right py-2.5 px-3 text-xs font-medium text-gray-600">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {detail.items.map((item: PayrollItem) => (
                            <tr key={item.id} className="hover:bg-white">
                              <td className="py-2.5 px-3 font-medium text-gray-800">{item.employee_name}</td>
                              <td className="py-2.5 px-3 text-gray-600">{item.working_days}</td>
                              <td className="py-2.5 px-3">{item.absent_days > 0 ? <span className="text-red-600">{item.absent_days}</span> : '—'}</td>
                              <td className="py-2.5 px-3 text-blue-600">{item.overtime_hours > 0 ? `${item.overtime_hours}h` : '—'}</td>
                              <td className="py-2.5 px-3 text-gray-700">{item.base_salary.toLocaleString()}</td>
                              <td className="py-2.5 px-3 text-gray-700">{(item.housing_allow + item.transport_allow + item.other_allows).toLocaleString()}</td>
                              <td className="py-2.5 px-3 font-medium">{item.gross_salary.toLocaleString()}</td>
                              <td className="py-2.5 px-3 text-red-600">{(item.advance_deduct + item.social_insur + item.income_tax).toLocaleString()}</td>
                              <td className="py-2.5 px-3 font-bold text-emerald-700">{item.net_salary.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t bg-white">
                          <tr>
                            <td colSpan={8} className="py-2.5 px-3 font-semibold text-gray-700 text-left">الإجمالي</td>
                            <td className="py-2.5 px-3 font-bold text-emerald-700">
                              {detail.items.reduce((s: number, i: PayrollItem) => s + i.net_salary, 0).toLocaleString()} ج.م
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  ) : (
                    <div className="p-4 text-center text-gray-400 text-sm">لا توجد بنود</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
