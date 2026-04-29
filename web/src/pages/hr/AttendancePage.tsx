import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Calendar, Users, CheckCircle, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { hrApi } from '../../api/hr'
import type { AttendanceSummary } from '../../api/hr'
import { CommandBar, type CommandAction } from '../../components/shell/CommandBar'
import { KpiStrip, type KpiItem } from '../../components/ui/KpiStrip'
import SectionCard from '../../components/ui/SectionCard'

const STATUSES = [
  { value: 'present',  label: 'حاضر',    color: 'bg-emerald-500' },
  { value: 'absent',   label: 'غائب',    color: 'bg-red-500' },
  { value: 'late',     label: 'متأخر',   color: 'bg-yellow-500' },
  { value: 'sick',     label: 'مريض',    color: 'bg-orange-500' },
  { value: 'leave',    label: 'إجازة',   color: 'bg-blue-500' },
  { value: 'half_day', label: 'نصف يوم', color: 'bg-purple-500' },
  { value: 'holiday',  label: 'عطلة',    color: 'bg-gray-400' },
]

export default function AttendancePage() {
  const qc = useQueryClient()
  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  // For bulk entry
  const [selectedDate, setSelectedDate] = useState(now.toISOString().slice(0, 10))
  const [bulkRecords, setBulkRecords]   = useState<Record<number, string>>({})
  const [savingBulk, setSavingBulk]     = useState(false)

  const { data: summaryRes, isLoading } = useQuery({
    queryKey: ['hr-attendance-summary', year, month],
    queryFn: () => hrApi.getAttendanceSummary(year, month),
  })

  const { data: empRes } = useQuery({
    queryKey: ['employees'],
    queryFn: () => import('../../api/client').then(m => m.unwrap(m.api.get<{id:number; name:string}[]>('/employees'))),
  })

  const bulkMut = useMutation({
    mutationFn: ({ date, records }: { date: string; records: {employee_id:number; status:'present'|'absent'|'late'|'sick'|'leave'|'half_day'|'holiday'}[] }) =>
      hrApi.bulkAttendance(date, records),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-attendance-summary'] })
      setBulkRecords({})
    },
  })

  const summary: AttendanceSummary[] = summaryRes ?? []
  const employees: {id:number; name:string}[] = empRes ?? []

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1) } else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(y => y + 1) } else setMonth(m => m + 1)
  }

  const handleSaveBulk = async () => {
    const records = Object.entries(bulkRecords)
      .filter(([, status]) => status)
      .map(([empId, status]) => ({ employee_id: Number(empId), status } as { employee_id: number; status: 'present' | 'absent' | 'late' | 'sick' | 'leave' | 'half_day' | 'holiday' }))
    if (!records.length) return
    setSavingBulk(true)
    await bulkMut.mutateAsync({ date: selectedDate, records })
    setSavingBulk(false)
  }

  const totalPresent = summary.reduce((s, r) => s + r.present_days, 0)
  const totalAbsent  = summary.reduce((s, r) => s + r.absent_days, 0)
  const totalOT      = summary.reduce((s, r) => s + r.total_overtime, 0)
  const attendanceRate = summary.length > 0
    ? Math.round(summary.reduce((s, r) => s + r.present_days / Math.max(1, r.present_days + r.absent_days + r.late_days), 0) / summary.length * 100)
    : 0

  const kpis: KpiItem[] = [
    { id: 'present', label: 'أيام الحضور', value: totalPresent, variant: 'success' },
    { id: 'absent',  label: 'أيام الغياب', value: totalAbsent, variant: totalAbsent > 0 ? 'warning' : 'default' },
    { id: 'ot',      label: 'ساعات إضافية', value: totalOT.toFixed(1) },
    { id: 'rate',    label: 'معدل الحضور', value: attendanceRate + '%', progress: attendanceRate, variant: attendanceRate >= 80 ? 'success' : 'warning' },
  ]

  const actions: CommandAction[] = [
    { id: 'refresh', label: 'تحديث', icon: <RefreshCw size={14} />, variant: 'secondary', onClick: () => qc.invalidateQueries({ queryKey: ['hr-attendance-summary'] }) },
  ]

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <CommandBar actions={actions}
        rightSlot={
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="p-1 text-slate-400 hover:text-slate-700 rounded">
              <ChevronRight size={18} />
            </button>
            <span className="text-sm font-semibold text-slate-700 min-w-[130px] text-center">{monthLabel}</span>
            <button onClick={nextMonth} className="p-1 text-slate-400 hover:text-slate-700 rounded">
              <ChevronLeft size={18} />
            </button>
          </div>
        }
      />
      <KpiStrip items={kpis} />

      <div className="flex-1 overflow-auto p-6 space-y-5" dir="rtl">

        {/* Bulk Attendance Entry */}
        <SectionCard title="تسجيل حضور يومي" icon={<Users size={16} />}>
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-slate-600 shrink-0">التاريخ:</label>
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]"
              />
            </div>

            {/* Status legend */}
            <div className="flex flex-wrap gap-2 pb-2">
              {STATUSES.map(s => (
                <span key={s.value} className="flex items-center gap-1 text-xs text-slate-600">
                  <span className={`w-2 h-2 rounded-full ${s.color}`} />
                  {s.label}
                </span>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[400px]">
                <thead>
                  <tr className="border-b bg-slate-50">
                    <th className="text-right py-2 px-3 text-slate-600 font-medium">الموظف</th>
                    <th className="text-right py-2 px-3 text-slate-600 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {employees.map(emp => (
                    <tr key={emp.id} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-medium text-slate-800">{emp.name}</td>
                      <td className="py-2 px-3">
                        <select
                          value={bulkRecords[emp.id] ?? 'present'}
                          onChange={e => setBulkRecords(r => ({ ...r, [emp.id]: e.target.value }))}
                          className="border rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]"
                        >
                          {STATUSES.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {employees.length > 0 && (
              <button
                onClick={handleSaveBulk}
                disabled={savingBulk || bulkMut.isPending}
                className="w-full bg-[#0F2D5C] text-white rounded-lg py-2.5 text-sm hover:bg-[#153D7A] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <CheckCircle size={16} />
                {savingBulk ? 'جاري الحفظ...' : `حفظ حضور ${selectedDate}`}
              </button>
            )}
          </div>
        </SectionCard>

        {/* Monthly Summary Table */}
        <SectionCard
          title={`ملخص ${monthLabel}`}
          icon={<Calendar size={16} />}
          badge={<span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{summary.length} موظف</span>}
        >
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-12 bg-slate-100 animate-pulse rounded" />)}
            </div>
          ) : summary.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <Calendar size={32} className="mx-auto mb-2 opacity-30" />
              <p>لا توجد سجلات حضور لهذا الشهر</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    {['الموظف','حضور','غياب','متأخر','مريض','إجازة','OT (ساعة)','تأخير (دقيقة)'].map(h => (
                      <th key={h} className="text-right py-3 px-4 text-slate-600 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {summary.map(row => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-medium text-slate-800">{row.name}</td>
                      <td className="py-3 px-4">
                        <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-xs font-semibold">
                          {row.present_days}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {row.absent_days > 0 ? (
                          <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-semibold">
                            {row.absent_days}
                          </span>
                        ) : <span className="text-slate-400">0</span>}
                      </td>
                      <td className="py-3 px-4">
                        {row.late_days > 0 ? (
                          <span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded text-xs">{row.late_days}</span>
                        ) : <span className="text-slate-400">0</span>}
                      </td>
                      <td className="py-3 px-4 text-slate-600">{row.sick_days}</td>
                      <td className="py-3 px-4 text-slate-600">{row.leave_days}</td>
                      <td className="py-3 px-4">
                        {row.total_overtime > 0 ? (
                          <span className="text-blue-600 font-medium">{row.total_overtime.toFixed(1)}</span>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="py-3 px-4 text-slate-600">{row.total_late_min || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  )
}