import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts'
import {
  Users, Clock, CalendarCheck, Wallet, Target,
  FileWarning, TrendingUp, CheckCircle2, XCircle,
  AlertCircle, Loader2, ChevronRight,
} from 'lucide-react'
import { hrApi } from '../../api/hr'

// ── Arabic month labels ──────────────────────────────────────
const MONTH_AR: Record<string, string> = {
  '01': 'يناير', '02': 'فبراير', '03': 'مارس',    '04': 'إبريل',
  '05': 'مايو',  '06': 'يونيو',  '07': 'يوليو',   '08': 'أغسطس',
  '09': 'سبتمبر','10': 'أكتوبر','11': 'نوفمبر',  '12': 'ديسمبر',
}
function fmtMonth(ym: string) {
  const [, m] = ym.split('-')
  return MONTH_AR[m] ?? ym
}
function fmtCurrency(n: number) {
  return new Intl.NumberFormat('ar-EG').format(Math.round(n))
}

// ── KPI card ─────────────────────────────────────────────────
interface KpiProps {
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
  color?: string   // Tailwind bg class for icon bg
  onClick?: () => void
  alert?: boolean
}
function KpiCard({ icon, label, value, sub, color = 'bg-brand-100', onClick, alert }: KpiProps) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-4 p-4 bg-white rounded-xl shadow-sm border text-right w-full
        transition-all hover:shadow-md active:scale-[0.98]
        ${alert ? 'border-amber-400' : 'border-gray-100'}
        ${onClick ? 'cursor-pointer' : 'cursor-default'}
      `}
    >
      <div className={`${color} rounded-xl p-3 shrink-0`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-2xl font-bold text-gray-800">{value}</p>
        <p className="text-sm text-gray-500 truncate">{label}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
      {onClick && <ChevronRight size={16} className="text-gray-300 shrink-0 rotate-180" />}
    </button>
  )
}

// ── Attendance donut stat ─────────────────────────────────────
function AttendanceStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`text-2xl font-bold ${color}`}>{value}</span>
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  )
}

// ── Task status badge ─────────────────────────────────────────
function TaskBadge({ label, value, bg, text }: { label: string; value: number; bg: string; text: string }) {
  return (
    <div className={`${bg} ${text} rounded-lg px-3 py-2 text-center`}>
      <p className="text-xl font-bold">{value}</p>
      <p className="text-xs">{label}</p>
    </div>
  )
}

// ── Custom recharts tooltip ───────────────────────────────────
function AttendTooltip({ active, payload, label }: {
  active?: boolean; payload?: {value: number; name: string; color: string}[]; label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow text-sm text-right">
      <p className="font-semibold text-gray-700 mb-1">{fmtMonth(label ?? '')}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: {p.value}</p>
      ))}
    </div>
  )
}

function PayrollTooltip({ active, payload, label }: {
  active?: boolean; payload?: {value: number; name: string; color: string}[]; label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow text-sm text-right">
      <p className="font-semibold text-gray-700 mb-1">{fmtMonth(label ?? '')}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: {fmtCurrency(p.value)} ج.م</p>
      ))}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════
// Page Component
// ═════════════════════════════════════════════════════════════
export default function HrDashboardPage() {
  const navigate = useNavigate()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['hr-dashboard'],
    queryFn:  () => hrApi.getDashboard(),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <Loader2 className="animate-spin" size={36} />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-3">
        <XCircle size={40} className="text-red-400" />
        <p>تعذر تحميل البيانات</p>
        <button onClick={() => refetch()} className="text-brand-600 text-sm underline">إعادة المحاولة</button>
      </div>
    )
  }

  const d = data

  // Attendance % for today
  const attendPct = d.total_employees > 0
    ? Math.round((d.today_attendance.present / d.total_employees) * 100)
    : 0

  // Today date label
  const todayLabel = new Date(d.today).toLocaleDateString('ar-EG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })

  // Attendance chart data — add Arabic month names
  const attendChartData = d.monthly_attendance.map(r => ({
    ...r, label: fmtMonth(r.month),
  }))

  // Payroll chart data
  const payrollChartData = d.payroll_trend.map(r => ({
    ...r, label: fmtMonth(r.month),
  }))

  const taskDone    = d.today_tasks.arrived + d.today_tasks.outside
  const taskTotal   = d.today_tasks.total
  const taskDonePct = taskTotal > 0 ? Math.round((taskDone / taskTotal) * 100) : 0

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto" dir="rtl">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">لوحة تحكم الموارد البشرية</h1>
          <p className="text-sm text-gray-500 mt-0.5">{todayLabel}</p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 text-sm text-brand-600 hover:text-brand-700 transition-colors"
        >
          <TrendingUp size={16} />
          تحديث البيانات
        </button>
      </div>

      {/* ── Alert banner (expiring docs or pending actions) ── */}
      {(d.expiring_documents > 0 || d.pending_leaves > 0 || d.pending_advances > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-3">
          <AlertCircle size={20} className="text-amber-500 shrink-0" />
          <p className="text-sm text-amber-800">
            {[
              d.pending_leaves > 0      && `${d.pending_leaves} طلب إجازة معلق`,
              d.pending_advances > 0    && `${d.pending_advances} طلب سلفة معلق`,
              d.expiring_documents > 0  && `${d.expiring_documents} مستند ينتهي خلال 30 يوم`,
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
      )}

      {/* ── Top KPI Cards ──────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          icon={<Users size={22} className="text-blue-600" />}
          color="bg-blue-50"
          label="إجمالي الموظفين"
          value={d.total_employees}
          sub="موظف نشط"
          onClick={() => navigate('/hr')}
        />
        <KpiCard
          icon={<Clock size={22} className="text-emerald-600" />}
          color="bg-emerald-50"
          label="حضور اليوم"
          value={`${attendPct}%`}
          sub={`${d.today_attendance.present} من ${d.total_employees}`}
          onClick={() => navigate('/hr/attendance')}
        />
        <KpiCard
          icon={<CalendarCheck size={22} className="text-violet-600" />}
          color="bg-violet-50"
          label="طلبات الإجازة"
          value={d.pending_leaves}
          sub="بانتظار الاعتماد"
          onClick={() => navigate('/hr/leaves')}
          alert={d.pending_leaves > 0}
        />
        <KpiCard
          icon={<Wallet size={22} className="text-orange-600" />}
          color="bg-orange-50"
          label="طلبات السلف"
          value={d.pending_advances}
          sub="بانتظار الاعتماد"
          onClick={() => navigate('/hr/leaves')}
          alert={d.pending_advances > 0}
        />
        <KpiCard
          icon={<Target size={22} className="text-teal-600" />}
          color="bg-teal-50"
          label="مهام اليوم"
          value={taskTotal > 0 ? `${taskDonePct}%` : '—'}
          sub={taskTotal > 0 ? `${taskDone}/${taskTotal} منجزة` : 'لا توجد مهام'}
          onClick={() => navigate('/hr/location-tasks')}
        />
        <KpiCard
          icon={<FileWarning size={22} className="text-red-500" />}
          color="bg-red-50"
          label="مستندات تنتهي"
          value={d.expiring_documents}
          sub="خلال 30 يوم"
          onClick={() => navigate('/documents')}
          alert={d.expiring_documents > 0}
        />
      </div>

      {/* ── Mid row: Today's Attendance + Today's Tasks ────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Attendance breakdown */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-700">تفاصيل حضور اليوم</h2>
            <button
              onClick={() => navigate('/hr/attendance')}
              className="text-xs text-brand-600 hover:underline flex items-center gap-1"
            >
              عرض كل الحضور <ChevronRight size={12} className="rotate-180" />
            </button>
          </div>
          {d.today_attendance.total === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm">
              لم يُسجَّل حضور لهذا اليوم بعد
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4 mt-2">
              <AttendanceStat
                label="حضور"
                value={d.today_attendance.present}
                color="text-emerald-600"
              />
              <AttendanceStat
                label="غياب"
                value={d.today_attendance.absent}
                color="text-red-500"
              />
              <AttendanceStat
                label="تأخير"
                value={d.today_attendance.late}
                color="text-amber-500"
              />
              <AttendanceStat
                label="مريض"
                value={d.today_attendance.sick}
                color="text-blue-500"
              />
              <AttendanceStat
                label="إجازة"
                value={d.today_attendance.on_leave}
                color="text-violet-500"
              />
              <AttendanceStat
                label="إجمالي مسجّل"
                value={d.today_attendance.total}
                color="text-gray-600"
              />
            </div>
          )}

          {/* Progress bar */}
          {d.total_employees > 0 && (
            <div className="mt-5">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>نسبة الحضور</span>
                <span>{attendPct}%</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${attendPct}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Today's Location Tasks */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-700">مهام الزيارات — اليوم</h2>
            <button
              onClick={() => navigate('/hr/location-tasks')}
              className="text-xs text-brand-600 hover:underline flex items-center gap-1"
            >
              إدارة المهام <ChevronRight size={12} className="rotate-180" />
            </button>
          </div>
          {d.today_tasks.total === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm">
              لا توجد مهام مجدولة لهذا اليوم
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <TaskBadge label="معلقة"  value={d.today_tasks.pending} bg="bg-amber-50"   text="text-amber-700" />
                <TaskBadge label="وصل"    value={d.today_tasks.arrived} bg="bg-emerald-50" text="text-emerald-700" />
                <TaskBadge label="خارج"   value={d.today_tasks.outside} bg="bg-blue-50"    text="text-blue-700" />
                <TaskBadge label="فائتة"  value={d.today_tasks.missed}  bg="bg-red-50"     text="text-red-700" />
              </div>
              <div className="mt-2">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>الإنجاز</span>
                  <span>{taskDonePct}%</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${taskDonePct >= 80 ? 'bg-emerald-500' : taskDonePct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                    style={{ width: `${taskDonePct}%` }}
                  />
                </div>
              </div>
            </>
          )}

          {/* Quick actions */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => navigate('/hr/leaves')}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs bg-violet-50 text-violet-700 rounded-lg py-2 hover:bg-violet-100 transition-colors"
            >
              <CalendarCheck size={13} />
              {d.pending_leaves > 0 ? `${d.pending_leaves} إجازة معلقة` : 'الإجازات'}
            </button>
            <button
              onClick={() => navigate('/hr/payroll')}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs bg-orange-50 text-orange-700 rounded-lg py-2 hover:bg-orange-100 transition-colors"
            >
              <Wallet size={13} />
              مسيرات الرواتب
            </button>
          </div>
        </div>
      </div>

      {/* ── Charts Row ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Monthly Attendance Trend */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-700 mb-4">اتجاه الحضور — آخر 6 أشهر</h2>
          {attendChartData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
              لا توجد بيانات حضور بعد
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={attendChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                />
                <Tooltip content={<AttendTooltip />} />
                <Legend
                  formatter={v => v === 'present_days' ? 'أيام حضور' : 'أيام غياب'}
                  wrapperStyle={{ fontSize: 11, direction: 'rtl' }}
                />
                <Bar dataKey="present_days" name="present_days" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="absent_days"  name="absent_days"  fill="#f87171" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Payroll Trend */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-700 mb-4">مسيرات الرواتب — آخر 6 مسيرات</h2>
          {payrollChartData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
              لا توجد مسيرات رواتب معتمدة بعد
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={payrollChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                  tickFormatter={v => `${Math.round(v / 1000)}k`}
                />
                <Tooltip content={<PayrollTooltip />} />
                <Legend
                  formatter={v =>
                    v === 'total_gross' ? 'إجمالي الرواتب' :
                    v === 'total_net'   ? 'صافي الرواتب'   : 'الاستقطاعات'
                  }
                  wrapperStyle={{ fontSize: 11, direction: 'rtl' }}
                />
                <Line
                  type="monotone" dataKey="total_gross" name="total_gross"
                  stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone" dataKey="total_net" name="total_net"
                  stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone" dataKey="total_deductions" name="total_deductions"
                  stroke="#f87171" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="4 2"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Quick Nav shortcuts ────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'قائمة الموظفين',      to: '/hr',                   icon: <Users size={18} /> },
          { label: 'تسجيل الحضور',         to: '/hr/attendance',        icon: <Clock size={18} /> },
          { label: 'الإجازات والسلف',      to: '/hr/leaves',             icon: <CalendarCheck size={18} /> },
          { label: 'مسيرات الرواتب',       to: '/hr/payroll',            icon: <Wallet size={18} /> },
        ].map(item => (
          <button
            key={item.to}
            onClick={() => navigate(item.to)}
            className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-100
                       shadow-sm hover:shadow-md hover:border-brand-200 transition-all text-right"
          >
            <span className="text-brand-600 shrink-0">{item.icon}</span>
            <span className="text-sm font-medium text-gray-700">{item.label}</span>
            <ChevronRight size={14} className="text-gray-300 mr-auto rotate-180" />
          </button>
        ))}
      </div>

      {/* ── Summary badges row ─────────────────────────────── */}
      <div className="flex items-center gap-4 flex-wrap text-xs text-gray-400">
        <span className="flex items-center gap-1"><CheckCircle2 size={12} className="text-emerald-400" /> البيانات مُحدَّثة تلقائياً كل دقيقتين</span>
        <span>آخر تحديث: {new Date().toLocaleTimeString('ar-EG')}</span>
      </div>

    </div>
  )
}
