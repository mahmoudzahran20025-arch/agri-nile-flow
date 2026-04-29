import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, CheckCircle, ChevronDown, ChevronUp, FileText, Banknote, X, Wheat, RefreshCw } from 'lucide-react'
import { hrApi } from '../../api/hr'
import type { PayrollRun, PayrollItem } from '../../api/hr'
import Modal from '../../components/ui/Modal'
import { configApi } from '../../api/client'
import type { Season } from '../../types'
import { CommandBar, type CommandAction } from '../../components/shell/CommandBar'
import { KpiStrip, type KpiItem } from '../../components/ui/KpiStrip'
import SectionCard from '../../components/ui/SectionCard'

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
  const [runYear,      setRunYear]      = useState(now.getFullYear())
  const [runMonth,     setRunMonth]     = useState(now.getMonth() + 1)
  const [runSeasonId,  setRunSeasonId]  = useState<number | ''>('')
  const [expandedId,   setExpandedId]   = useState<number | null>(null)
  const [payRunId,     setPayRunId]     = useState<number | null>(null)
  const [payDate,      setPayDate]      = useState(now.toISOString().slice(0, 10))
  const [payErr,       setPayErr]       = useState('')

  const { data: runsRes } = useQuery({
    queryKey: ['hr-payroll'],
    queryFn: () => hrApi.getPayrollRuns(),
  })

  const { data: seasons } = useQuery({
    queryKey: ['seasons'],
    queryFn: () => configApi.seasons() as Promise<Season[]>,
    staleTime: 300_000,
  })

  const { data: detailRes, isLoading: detailLoading } = useQuery({
    queryKey: ['hr-payroll-detail', expandedId],
    queryFn: () => hrApi.getPayrollRun(expandedId!),
    enabled: !!expandedId,
  })

  const runMut = useMutation({
    mutationFn: () => hrApi.runPayroll(runYear, runMonth, runSeasonId !== '' ? runSeasonId : null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-payroll'] }),
  })

  const approveMut = useMutation({
    mutationFn: (id: number) => hrApi.approvePayroll(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-payroll'] })
      qc.invalidateQueries({ queryKey: ['hr-payroll-detail'] })
    },
  })

  const payMut = useMutation({
    mutationFn: ({ id, date }: { id: number; date: string }) => hrApi.payPayroll(id, date),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-payroll'] })
      setPayRunId(null)
      setPayErr('')
    },
    onError: (e: Error) => setPayErr(e.message),
  })

  const runs: PayrollRun[] = runsRes ?? []
  const detail = detailRes

  const totalNetAll    = runs.reduce((s, r) => s + r.total_net, 0)
  const totalGrossAll  = runs.reduce((s, r) => s + r.total_gross, 0)
  const draftCount     = runs.filter(r => r.status === 'draft').length
  const paidCount      = runs.filter(r => r.status === 'paid').length

  const kpis: KpiItem[] = [
    { id: 'total', label: 'إجمالي المسيرات', value: runs.length },
    { id: 'net', label: 'صافي الرواتب الكلي', value: totalNetAll.toLocaleString() + ' ج.م', variant: 'success' },
    { id: 'gross', label: 'إجمالي الرواتب', value: totalGrossAll.toLocaleString() + ' ج.م' },
    { id: 'draft', label: 'مسودة / مدفوعة', value: `${draftCount} / ${paidCount}`, variant: draftCount > 0 ? 'warning' : 'default' },
  ]

  const actions: CommandAction[] = [
    { id: 'refresh', label: 'تحديث', icon: <RefreshCw size={14} />, variant: 'secondary', onClick: () => qc.invalidateQueries({ queryKey: ['hr-payroll'] }) },
  ]

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <CommandBar actions={actions}
        rightSlot={<span className="text-xs text-slate-500">{runs.length} مسيرة مسجلة</span>}
      />
      <KpiStrip items={kpis} />

      <div className="flex-1 overflow-auto p-6 space-y-5" dir="rtl">

        {/* Pay payroll modal */}
        <Modal open={!!payRunId} onClose={() => { setPayRunId(null); setPayErr('') }} title="صرف الرواتب">
          {payRunId && (() => {
            const run = runs.find(r => r.id === payRunId)
            return (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-blue-800">
                    {MONTH_NAMES[run?.period_month ?? 0]} {run?.period_year} — صافي: {run?.total_net.toLocaleString()} ج.م
                  </p>
                  <p className="text-xs text-blue-600 mt-1">سيتم إنشاء قيد محاسبي: DR مستحقات رواتب / CR خزينة</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ الصرف *</label>
                  <input
                    type="date"
                    value={payDate}
                    onChange={e => setPayDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {payErr && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{payErr}</p>}
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={() => { setPayRunId(null); setPayErr('') }}
                    className="flex items-center gap-1.5 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50"
                  >
                    <X size={14} /> إلغاء
                  </button>
                  <button
                    onClick={() => payRunId && payMut.mutate({ id: payRunId, date: payDate })}
                    disabled={payMut.isPending || !payDate}
                    className="flex items-center gap-1.5 bg-blue-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Banknote size={14} />
                    {payMut.isPending ? 'جاري الصرف...' : 'تأكيد الصرف'}
                  </button>
                </div>
              </div>
            )
          })()}
        </Modal>

        {/* Run new payroll */}
        <SectionCard title="تشغيل مسيرة جديدة" icon={<Play size={16} />}>
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <select value={runYear} onChange={e => setRunYear(Number(e.target.value))}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]">
                {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <select value={runMonth} onChange={e => setRunMonth(Number(e.target.value))}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]">
                {MONTH_NAMES.slice(1).map((m, i) => (
                  <option key={i+1} value={i+1}>{m}</option>
                ))}
              </select>
              {seasons && seasons.length > 0 && (
                <select
                  value={runSeasonId}
                  onChange={e => setRunSeasonId(e.target.value === '' ? '' : Number(e.target.value))}
                  className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]"
                >
                  <option value="">بدون موسم</option>
                  {seasons.filter(s => s.status === 'open').map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              )}
              <button
                onClick={() => runMut.mutate()}
                disabled={runMut.isPending}
                className="flex items-center gap-2 bg-[#0F2D5C] text-white px-5 py-2 rounded-lg text-sm hover:bg-[#153D7A] disabled:opacity-50"
              >
                <Play size={14} />
                {runMut.isPending ? 'جاري الحساب...' : `تشغيل ${MONTH_NAMES[runMonth]} ${runYear}`}
              </button>
            </div>
            {runMut.isSuccess && (
              <div className="text-sm text-emerald-600 bg-emerald-50 rounded-lg px-4 py-2">
                ✓ تم إنشاء المسيرة — صافي الرواتب: {(runMut.data as {total_net:number})?.total_net.toLocaleString()} ج.م
              </div>
            )}
            {runMut.isError && (
              <div className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">
                {(runMut.error as Error)?.message}
              </div>
            )}
          </div>
        </SectionCard>

        {/* Payroll runs list */}
        <SectionCard title="سجل المسيرات" icon={<FileText size={16} />} badge={<span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{runs.length}</span>}>
          {runs.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <FileText size={36} className="mx-auto mb-2 opacity-30" />
              <p>لا توجد مسيرات رواتب بعد</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {runs.map(run => {
                const st = STATUS_MAP[run.status] ?? STATUS_MAP.draft
                const isExpanded = expandedId === run.id
                return (
                  <div key={run.id} className="overflow-hidden">
                    {/* Run header */}
                    <div
                      className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-slate-50"
                      onClick={() => setExpandedId(isExpanded ? null : run.id)}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-900">
                            {MONTH_NAMES[run.period_month]} {run.period_year}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                          {run.journal_entry_id && (
                            <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">GL ✓</span>
                          )}
                          {run.season_id && seasons && (
                            <span className="flex items-center gap-1 text-xs bg-lime-50 text-lime-700 px-2 py-0.5 rounded-full">
                              <Wheat size={10} />
                              {seasons.find(s => s.id === run.season_id)?.name ?? `موسم #${run.season_id}`}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
                          <span>إجمالي: {run.total_gross.toLocaleString()} ج.م</span>
                          <span>خصومات: {run.total_deductions.toLocaleString()} ج.م</span>
                          <span className="font-semibold text-[#1D9E75]">صافي: {run.total_net.toLocaleString()} ج.م</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {run.status === 'draft' && (
                          <button
                            onClick={e => { e.stopPropagation(); approveMut.mutate(run.id) }}
                            disabled={approveMut.isPending}
                            className="flex items-center gap-1.5 bg-[#1D9E75] text-white px-3 py-1.5 rounded-lg text-xs hover:bg-emerald-700 disabled:opacity-50"
                          >
                            <CheckCircle size={14} /> اعتماد + قيد
                          </button>
                        )}
                        {run.status === 'approved' && (
                          <button
                            onClick={e => { e.stopPropagation(); setPayRunId(run.id); setPayErr('') }}
                            className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs hover:bg-blue-700"
                          >
                            <Banknote size={14} /> صرف رواتب
                          </button>
                        )}
                        {run.status === 'paid' && run.payment_date && (
                          <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                            صُرفت {run.payment_date}
                          </span>
                        )}
                        {isExpanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                      </div>
                    </div>

                    {/* Expanded: items */}
                    {isExpanded && (
                      <div className="border-t bg-slate-50">
                        {detailLoading ? (
                          <div className="p-4 space-y-2">
                            {[1,2,3].map(i => <div key={i} className="h-10 bg-slate-200 animate-pulse rounded" />)}
                          </div>
                        ) : detail?.items?.length ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm min-w-[900px]">
                              <thead className="border-b bg-white">
                                <tr>
                                  {['الموظف','أيام عمل','غياب','OT','الراتب','بدلات','إجمالي','خصومات','صافي'].map(h => (
                                    <th key={h} className="text-right py-2.5 px-3 text-xs font-medium text-slate-600">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {detail.items.map((item: PayrollItem) => (
                                  <tr key={item.id} className="hover:bg-white">
                                    <td className="py-2.5 px-3 font-medium text-slate-800">{item.employee_name}</td>
                                    <td className="py-2.5 px-3 text-slate-600">{item.working_days}</td>
                                    <td className="py-2.5 px-3">{item.absent_days > 0 ? <span className="text-red-600">{item.absent_days}</span> : '—'}</td>
                                    <td className="py-2.5 px-3 text-blue-600">{item.overtime_hours > 0 ? `${item.overtime_hours}h` : '—'}</td>
                                    <td className="py-2.5 px-3 text-slate-700">{item.base_salary.toLocaleString()}</td>
                                    <td className="py-2.5 px-3 text-slate-700">{(item.housing_allow + item.transport_allow + item.other_allows).toLocaleString()}</td>
                                    <td className="py-2.5 px-3 font-medium">{item.gross_salary.toLocaleString()}</td>
                                    <td className="py-2.5 px-3 text-red-600">{(item.advance_deduct + item.social_insur + item.income_tax).toLocaleString()}</td>
                                    <td className="py-2.5 px-3 font-bold text-[#1D9E75]">{item.net_salary.toLocaleString()}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot className="border-t bg-white">
                                <tr>
                                  <td colSpan={8} className="py-2.5 px-3 font-semibold text-slate-700 text-left">الإجمالي</td>
                                  <td className="py-2.5 px-3 font-bold text-[#1D9E75]">
                                    {detail.items.reduce((s: number, i: PayrollItem) => s + i.net_salary, 0).toLocaleString()} ج.م
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        ) : (
                          <div className="p-4 text-center text-slate-400 text-sm">لا توجد بنود</div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
