import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertCircle,
  CalendarCheck,
  CheckCircle2,
  Clock,
  FileWarning,
  Loader2,
  RefreshCw,
  Target,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react'
import { hrApi } from '../../api/hr'
import { CommandBar, type CommandAction } from '../../components/shell/CommandBar'
import { KpiStrip, type KpiItem } from '../../components/ui/KpiStrip'
import SectionCard from '../../components/ui/SectionCard'

const MONTH_AR: Record<string, string> = {
  '01': 'يناير',
  '02': 'فبراير',
  '03': 'مارس',
  '04': 'إبريل',
  '05': 'مايو',
  '06': 'يونيو',
  '07': 'يوليو',
  '08': 'أغسطس',
  '09': 'سبتمبر',
  '10': 'أكتوبر',
  '11': 'نوفمبر',
  '12': 'ديسمبر',
}

function fmtMonth(ym: string) {
  const [, month] = ym.split('-')
  return MONTH_AR[month] ?? ym
}

function fmtCurrency(value: number) {
  return new Intl.NumberFormat('en-US').format(Math.round(value))
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex items-center justify-center h-48 text-[13px] text-slate-400">{text}</div>
}

function AttendTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 shadow text-sm text-right">
      <p className="font-semibold text-slate-700 mb-1">{fmtMonth(label ?? '')}</p>
      {payload.map((item) => (
        <p key={item.name} style={{ color: item.color }}>
          {item.name}: {item.value}
        </p>
      ))}
    </div>
  )
}

function PayrollTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 shadow text-sm text-right">
      <p className="font-semibold text-slate-700 mb-1">{fmtMonth(label ?? '')}</p>
      {payload.map((item) => (
        <p key={item.name} style={{ color: item.color }}>
          {item.name}: {fmtCurrency(item.value)} ج.م
        </p>
      ))}
    </div>
  )
}

export default function HrDashboardPage() {
  const navigate = useNavigate()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['hr-dashboard'],
    queryFn: () => hrApi.getDashboard(),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="animate-spin" size={36} />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3" dir="rtl">
        <XCircle size={40} className="text-red-400" />
        <p>تعذر تحميل بيانات الموارد البشرية</p>
        <button type="button" onClick={() => refetch()} className="text-[#0F2D5C] text-sm underline">
          إعادة المحاولة
        </button>
      </div>
    )
  }

  const attendancePercent = data.total_employees > 0
    ? Math.round((data.today_attendance.present / data.total_employees) * 100)
    : 0
  const totalPendingApprovals = data.pending_leaves + data.pending_advances
  const taskDone = data.today_tasks.arrived + data.today_tasks.outside
  const taskTotal = data.today_tasks.total
  const taskDonePercent = taskTotal > 0 ? Math.round((taskDone / taskTotal) * 100) : 0

  const todayLabel = new Date(data.today).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const attendanceChartData = data.monthly_attendance.map((row) => ({
    ...row,
    label: fmtMonth(row.month),
  }))

  const payrollChartData = data.payroll_trend.map((row) => ({
    ...row,
    label: fmtMonth(row.month),
  }))

  const actions: CommandAction[] = [
    {
      id: 'refresh',
      label: 'تحديث',
      icon: <RefreshCw />,
      variant: 'secondary',
      onClick: () => refetch(),
    },
    {
      id: 'employees',
      label: 'الموظفون',
      icon: <Users />,
      variant: 'ghost',
      onClick: () => navigate('/hr'),
    },
    {
      id: 'attendance',
      label: 'الحضور',
      icon: <Clock />,
      variant: 'ghost',
      onClick: () => navigate('/hr/attendance'),
    },
    {
      id: 'payroll',
      label: 'الرواتب',
      icon: <Wallet />,
      variant: 'ghost',
      onClick: () => navigate('/hr/payroll'),
    },
  ]

  const kpiItems: KpiItem[] = [
    {
      id: 'employees',
      label: 'إجمالي الموظفين',
      value: data.total_employees,
    },
    {
      id: 'attendance',
      label: 'نسبة حضور اليوم',
      value: `${attendancePercent}%`,
      delta: `${data.today_attendance.present} حاضر`,
      variant: 'success',
    },
    {
      id: 'approvals',
      label: 'اعتمادات معلقة',
      value: totalPendingApprovals,
      delta: `${data.pending_leaves} إجازات · ${data.pending_advances} سلف`,
      variant: totalPendingApprovals > 0 ? 'warning' : 'success',
    },
    {
      id: 'documents',
      label: 'مستندات تنتهي قريباً',
      value: data.expiring_documents,
      delta: 'خلال 30 يوم',
      variant: data.expiring_documents > 0 ? 'warning' : 'success',
    },
  ]

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]" dir="rtl">
      <div className="px-6 py-5 flex items-center justify-between shrink-0 bg-white border-b border-slate-200">
        <div>
          <h1 className="text-[18px] font-bold text-[#0F2D5C]">لوحة الموارد البشرية</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">{todayLabel}</p>
        </div>
        <div className="text-[12px] text-slate-400">تحديث تلقائي كل دقيقتين</div>
      </div>

      <CommandBar actions={actions} />
      <KpiStrip items={kpiItems} />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {(data.expiring_documents > 0 || data.pending_leaves > 0 || data.pending_advances > 0) && (
          <SectionCard
            title="تنبيهات تحتاج متابعة"
            subtitle="طلبات واعتمادات ومستندات قريبة الانتهاء"
            icon={<AlertCircle size={18} />}
            className="border-amber-200 bg-amber-50/60"
          >
            <div className="flex flex-wrap gap-2 text-[12px]">
              {data.pending_leaves > 0 && (
                <button type="button" onClick={() => navigate('/hr/leaves')} className="px-3 py-1.5 rounded-full bg-white border border-amber-200 text-amber-800 hover:bg-amber-100">
                  {data.pending_leaves} طلب إجازة معلق
                </button>
              )}
              {data.pending_advances > 0 && (
                <button type="button" onClick={() => navigate('/hr/leaves')} className="px-3 py-1.5 rounded-full bg-white border border-amber-200 text-amber-800 hover:bg-amber-100">
                  {data.pending_advances} طلب سلفة معلق
                </button>
              )}
              {data.expiring_documents > 0 && (
                <button type="button" onClick={() => navigate('/documents')} className="px-3 py-1.5 rounded-full bg-white border border-amber-200 text-amber-800 hover:bg-amber-100">
                  {data.expiring_documents} مستند ينتهي خلال 30 يوم
                </button>
              )}
            </div>
          </SectionCard>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SectionCard
            title="الحضور اليومي"
            subtitle="ملخص حالات حضور اليوم"
            icon={<CalendarCheck size={18} />}
            action={<button type="button" onClick={() => navigate('/hr/attendance')} className="text-[12px] font-semibold text-[#0F2D5C] hover:underline">عرض سجل الحضور</button>}
          >
            {data.today_attendance.total === 0 ? (
              <EmptyState text="لم يتم تسجيل حضور لهذا اليوم بعد" />
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { label: 'حضور', value: data.today_attendance.present, tone: 'text-emerald-600 bg-emerald-50' },
                    { label: 'غياب', value: data.today_attendance.absent, tone: 'text-red-600 bg-red-50' },
                    { label: 'تأخير', value: data.today_attendance.late, tone: 'text-amber-600 bg-amber-50' },
                    { label: 'مريض', value: data.today_attendance.sick, tone: 'text-blue-600 bg-blue-50' },
                    { label: 'إجازة', value: data.today_attendance.on_leave, tone: 'text-violet-600 bg-violet-50' },
                    { label: 'إجمالي مسجل', value: data.today_attendance.total, tone: 'text-slate-700 bg-slate-100' },
                  ].map((item) => (
                    <div key={item.label} className={`rounded-xl px-4 py-3 ${item.tone}`}>
                      <div className="text-[22px] font-bold leading-none">{item.value}</div>
                      <div className="text-[12px] mt-1">{item.label}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <div className="flex items-center justify-between text-[12px] text-slate-500 mb-1.5">
                    <span>نسبة الحضور</span>
                    <span>{attendancePercent}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-[#1D9E75]" style={{ width: `${attendancePercent}%` }} />
                  </div>
                </div>
              </>
            )}
          </SectionCard>

          <SectionCard
            title="مهام الزيارات اليوم"
            subtitle="متابعة تنفيذ المهام الميدانية"
            icon={<Target size={18} />}
            action={<button type="button" onClick={() => navigate('/hr/location-tasks')} className="text-[12px] font-semibold text-[#0F2D5C] hover:underline">إدارة المهام</button>}
          >
            {taskTotal === 0 ? (
              <EmptyState text="لا توجد مهام مجدولة لهذا اليوم" />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {[
                    { label: 'معلقة', value: data.today_tasks.pending, tone: 'text-amber-700 bg-amber-50' },
                    { label: 'وصل', value: data.today_tasks.arrived, tone: 'text-emerald-700 bg-emerald-50' },
                    { label: 'خارج', value: data.today_tasks.outside, tone: 'text-blue-700 bg-blue-50' },
                    { label: 'فائتة', value: data.today_tasks.missed, tone: 'text-red-700 bg-red-50' },
                  ].map((item) => (
                    <div key={item.label} className={`rounded-xl px-4 py-3 ${item.tone}`}>
                      <div className="text-[22px] font-bold leading-none">{item.value}</div>
                      <div className="text-[12px] mt-1">{item.label}</div>
                    </div>
                  ))}
                </div>
                <div className="mb-4">
                  <div className="flex items-center justify-between text-[12px] text-slate-500 mb-1.5">
                    <span>نسبة الإنجاز</span>
                    <span>{taskDonePercent}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${taskDonePercent >= 80 ? 'bg-[#1D9E75]' : taskDonePercent >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                      style={{ width: `${taskDonePercent}%` }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button type="button" onClick={() => navigate('/hr/leaves')} className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-3 text-[12px] font-semibold text-violet-700 hover:bg-violet-100">
                    {data.pending_leaves > 0 ? `${data.pending_leaves} إجازة معلقة` : 'إدارة الإجازات'}
                  </button>
                  <button type="button" onClick={() => navigate('/hr/payroll')} className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-3 text-[12px] font-semibold text-orange-700 hover:bg-orange-100">
                    متابعة مسيرات الرواتب
                  </button>
                </div>
              </>
            )}
          </SectionCard>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SectionCard title="اتجاه الحضور" subtitle="آخر 6 أشهر" icon={<Clock size={18} />}>
            {attendanceChartData.length === 0 ? (
              <EmptyState text="لا توجد بيانات حضور بعد" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={attendanceChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip content={<AttendTooltip />} />
                  <Legend formatter={(value) => (value === 'present_days' ? 'أيام حضور' : 'أيام غياب')} wrapperStyle={{ fontSize: 11, direction: 'rtl' }} />
                  <Bar dataKey="present_days" name="present_days" fill="#1D9E75" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="absent_days" name="absent_days" fill="#f87171" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </SectionCard>

          <SectionCard title="مسيرات الرواتب" subtitle="آخر 6 مسيرات" icon={<Wallet size={18} />}>
            {payrollChartData.length === 0 ? (
              <EmptyState text="لا توجد مسيرات رواتب معتمدة بعد" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={payrollChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                    tickFormatter={(value) => `${Math.round(value / 1000)}k`}
                  />
                  <Tooltip content={<PayrollTooltip />} />
                  <Legend
                    formatter={(value) =>
                      value === 'total_gross'
                        ? 'إجمالي الرواتب'
                        : value === 'total_net'
                        ? 'صافي الرواتب'
                        : 'الاستقطاعات'
                    }
                    wrapperStyle={{ fontSize: 11, direction: 'rtl' }}
                  />
                  <Line type="monotone" dataKey="total_gross" name="total_gross" stroke="#0F2D5C" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="total_net" name="total_net" stroke="#1D9E75" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="total_deductions" name="total_deductions" stroke="#f87171" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </SectionCard>
        </div>

        <SectionCard title="وصول سريع" subtitle="أكثر المسارات استخداماً في الموارد البشرية" icon={<Users size={18} />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {[
              { label: 'قائمة الموظفين', to: '/hr', icon: <Users size={16} /> },
              { label: 'تسجيل الحضور', to: '/hr/attendance', icon: <Clock size={16} /> },
              { label: 'الإجازات والسلف', to: '/hr/leaves', icon: <CalendarCheck size={16} /> },
              { label: 'مسيرات الرواتب', to: '/hr/payroll', icon: <Wallet size={16} /> },
            ].map((item) => (
              <button
                key={item.to}
                type="button"
                onClick={() => navigate(item.to)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-right hover:border-[#0F2D5C]/30 hover:bg-slate-50 transition-colors"
              >
                <div className="w-9 h-9 rounded-lg bg-[#0F2D5C]/10 text-[#0F2D5C] flex items-center justify-center mb-3">
                  {item.icon}
                </div>
                <div className="text-[13px] font-semibold text-slate-700">{item.label}</div>
              </button>
            ))}
          </div>
        </SectionCard>

        <div className="flex items-center gap-4 flex-wrap text-[12px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 size={12} className="text-[#1D9E75]" />
            البيانات محدثة تلقائياً كل دقيقتين
          </span>
          <span className="flex items-center gap-1.5">
            <FileWarning size={12} className={data.expiring_documents > 0 ? 'text-amber-500' : 'text-slate-300'} />
            {data.expiring_documents > 0 ? `${data.expiring_documents} مستندات تحتاج متابعة` : 'لا توجد مستندات حرجة حالياً'}
          </span>
        </div>
      </div>
    </div>
  )
}
