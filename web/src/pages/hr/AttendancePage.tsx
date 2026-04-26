import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Calendar, Users, CheckCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import { hrApi } from '../../api/hr'
import type { AttendanceSummary } from '../../api/hr'

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

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-emerald-100 rounded-lg">
          <Calendar size={22} className="text-emerald-700" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">الحضور والانصراف</h1>
          <p className="text-sm text-gray-500">تسجيل وتقارير الحضور الشهرية</p>
        </div>
      </div>

      {/* Month navigator */}
      <div className="flex items-center justify-between bg-white border rounded-xl px-5 py-3">
        <button onClick={prevMonth} className="text-gray-400 hover:text-gray-700 p-1">
          <ChevronRight size={20} />
        </button>
        <span className="font-semibold text-gray-800">{monthLabel}</span>
        <button onClick={nextMonth} className="text-gray-400 hover:text-gray-700 p-1">
          <ChevronLeft size={20} />
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-emerald-700">{totalPresent}</div>
          <div className="text-xs text-emerald-600 mt-1">إجمالي أيام الحضور</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-red-700">{totalAbsent}</div>
          <div className="text-xs text-red-600 mt-1">إجمالي أيام الغياب</div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-blue-700">{totalOT.toFixed(1)}</div>
          <div className="text-xs text-blue-600 mt-1">ساعات إضافية</div>
        </div>
      </div>

      {/* Bulk Attendance Entry */}
      <div className="bg-white border rounded-xl">
        <div className="flex items-center gap-2 px-5 py-4 border-b">
          <Users size={18} className="text-emerald-600" />
          <h2 className="font-semibold text-gray-800">تسجيل حضور يومي</h2>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 shrink-0">التاريخ:</label>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Status legend */}
          <div className="flex flex-wrap gap-2 pb-2">
            {STATUSES.map(s => (
              <span key={s.value} className="flex items-center gap-1 text-xs text-gray-600">
                <span className={`w-2 h-2 rounded-full ${s.color}`} />
                {s.label}
              </span>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[400px]">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-right py-2 px-3 text-gray-600 font-medium">الموظف</th>
                  <th className="text-right py-2 px-3 text-gray-600 font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {employees.map(emp => (
                  <tr key={emp.id} className="hover:bg-gray-50">
                    <td className="py-2 px-3 font-medium text-gray-800">{emp.name}</td>
                    <td className="py-2 px-3">
                      <select
                        value={bulkRecords[emp.id] ?? 'present'}
                        onChange={e => setBulkRecords(r => ({ ...r, [emp.id]: e.target.value }))}
                        className="border rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
              className="w-full bg-emerald-600 text-white rounded-lg py-2.5 text-sm hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <CheckCircle size={16} />
              {savingBulk ? 'جاري الحفظ...' : `حفظ حضور ${selectedDate}`}
            </button>
          )}
        </div>
      </div>

      {/* Monthly Summary Table */}
      <div className="bg-white border rounded-xl">
        <div className="px-5 py-4 border-b">
          <h2 className="font-semibold text-gray-800">ملخص {monthLabel}</h2>
        </div>
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[1,2,3].map(i => <div key={i} className="h-12 bg-gray-100 animate-pulse rounded" />)}
          </div>
        ) : summary.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <Calendar size={32} className="mx-auto mb-2 opacity-30" />
            <p>لا توجد سجلات حضور لهذا الشهر</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['الموظف','حضور','غياب','متأخر','مريض','إجازة','OT (ساعة)','تأخير (دقيقة)'].map(h => (
                    <th key={h} className="text-right py-3 px-4 text-gray-600 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {summary.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium text-gray-800">{row.name}</td>
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
                      ) : <span className="text-gray-400">0</span>}
                    </td>
                    <td className="py-3 px-4">
                      {row.late_days > 0 ? (
                        <span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded text-xs">{row.late_days}</span>
                      ) : <span className="text-gray-400">0</span>}
                    </td>
                    <td className="py-3 px-4 text-gray-600">{row.sick_days}</td>
                    <td className="py-3 px-4 text-gray-600">{row.leave_days}</td>
                    <td className="py-3 px-4">
                      {row.total_overtime > 0 ? (
                        <span className="text-blue-600 font-medium">{row.total_overtime.toFixed(1)}</span>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="py-3 px-4 text-gray-600">{row.total_late_min || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
