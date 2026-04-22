import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ComposedChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Line,
} from 'recharts'
import { BarChart3, TrendingUp, Package, Users, TrendingDown, RefreshCw, Banknote, Leaf } from 'lucide-react'
import { dashboardApi, suppliersApi, inventoryApi } from '../../api/client'
import { useSeasonId } from '../../store/appStore'

// ─── Formatters ────────────────────────────────────────────────
function egp(n: number) {
  if (Math.abs(n) >= 1_000_000)
    return (n / 1_000_000).toFixed(1) + 'م'
  if (Math.abs(n) >= 1_000)
    return (n / 1_000).toFixed(0) + 'ك'
  return n.toFixed(0)
}

function egpFull(n: number) {
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}

const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

// Balanced palette – starts with blue/amber, no adjacent greens
const PALETTE = ['#3b82f6','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#f97316','#ec4899','#84cc16','#6b7280','#10b981']

// ─── Custom Tooltip ─────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-sm min-w-[140px]">
      {label && <p className="font-semibold text-slate-700 mb-2 text-xs">{label}</p>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: p.color }} />
            <span className="text-slate-500">{p.name}</span>
          </span>
          <span className="font-bold text-slate-800">{egpFull(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Section wrapper ────────────────────────────────────────────
function ChartSection({
  title, icon, children, badge,
}: {
  title: string; icon: React.ReactNode; children: React.ReactNode; badge?: string
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-50">
        <div className="flex items-center gap-2.5">
          <span className="p-1.5 bg-brand-50 rounded-lg text-brand-600">{icon}</span>
          <h2 className="font-bold text-slate-800 text-sm">{title}</h2>
        </div>
        {badge && <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{badge}</span>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function EmptyChart({ message = 'لا توجد بيانات كافية' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-52 text-slate-300">
      <BarChart3 size={40} strokeWidth={1} className="mb-3" />
      <p className="text-sm font-medium text-slate-400">{message}</p>
      <p className="text-xs text-slate-300 mt-1">أضف بيانات لظهور الرسم البياني</p>
    </div>
  )
}

function LoadingChart() {
  return (
    <div className="flex items-center justify-center h-52 text-slate-300">
      <RefreshCw size={24} className="animate-spin" />
    </div>
  )
}

function KpiCard({
  label, value, sub, icon, color,
}: { label: string; value: string; sub?: string; icon: React.ReactNode; color: string }) {
  return (
    <div className={`rounded-2xl border p-4 ${color}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium opacity-70 mb-1">{label}</p>
          <p className="text-lg font-bold leading-tight tabular-nums">{value}</p>
          {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
        </div>
        <div className="p-2 rounded-xl bg-white/40 flex-shrink-0">{icon}</div>
      </div>
    </div>
  )
}

export default function ChartsPage() {
  const seasonId = useSeasonId()
  const [cashflowMonths, setCashflowMonths] = useState(12)

  // ─── Data queries ──────────────────────────────────────────
  const { data: cashflow = [], isLoading: loadingCashflow } = useQuery({
    queryKey: ['dashboard', 'cashflow', cashflowMonths],
    queryFn: () => dashboardApi.monthlyCashflow(cashflowMonths) as Promise<{ year: number; month: number; cash_in: number; cash_out: number }[]>,
  })

  const { data: byCrop = [], isLoading: loadingCrop } = useQuery({
    queryKey: ['dashboard', 'crop', seasonId],
    queryFn: () => dashboardApi.costByCrop(seasonId) as Promise<{ crop: string | null; total_cost: number }[]>,
  })

  const { data: balancesRaw = null, isLoading: loadingBalances } = useQuery({
    queryKey: ['inventory', 'balances', null],
    queryFn: () => inventoryApi.balances() as Promise<{ warehouse: string; item_name: string; balance_qty: number; balance_value: number }[]>,
  })

  const { data: suppliersRaw = null, isLoading: loadingSuppliers } = useQuery({
    queryKey: ['suppliers', 1, ''],
    queryFn: () => suppliersApi.list({ page: 1, size: 200 }) as Promise<{ data: { code: number; name: string; current_balance: number }[] }>,
  })

  // ─── Data transforms ───────────────────────────────────────
  const cashflowChart = cashflow.map(r => ({
    label: `${MONTHS_AR[r.month - 1]} ${String(r.year).slice(2)}`,
    وارد:  r.cash_in,
    صادر:  r.cash_out,
    صافي:  r.cash_in - r.cash_out,
  }))

  const cropChart = (byCrop ?? [])
    .filter(r => r?.total_cost > 0)
    .slice(0, 8)
    .map(r => ({
      name:  r?.crop ?? 'غير محدد',
      value: r?.total_cost ?? 0,
    }))

  const warehouseChart = Object.entries(
    (balancesRaw && Array.isArray(balancesRaw) ? balancesRaw : []).reduce<Record<string, number>>((acc, b) => {
      if (!b) return acc
      const wh = b?.warehouse ?? 'غير محدد'
      acc[wh] = (acc[wh] ?? 0) + (b?.balance_value ?? 0)
      return acc
    }, {}),
  ).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)

  const topItems = (balancesRaw && Array.isArray(balancesRaw) ? balancesRaw : [])
    .reduce<Record<string, { name: string; qty: number; value: number }>>((acc, b) => {
      if (!b) return acc
      const k = b?.item_name ?? 'unknown'
      if (!acc[k]) acc[k] = { name: k, qty: 0, value: 0 }
      acc[k].qty   += (b?.balance_qty ?? 0)
      acc[k].value += (b?.balance_value ?? 0)
      return acc
    }, {})
  const topItemsChart = (topItems ? Object.values(topItems) : [])
    .filter(i => i != null)
    .sort((a, b) => (b?.value ?? 0) - (a?.value ?? 0))
    .slice(0, 10)
    .map(i => ({
      name: i?.name ? (i.name.length > 14 ? i.name.slice(0, 14) + '…' : i.name) : 'unknown',
      value: i?.value ?? 0,
    }))

  const suppliersData = (suppliersRaw?.data && Array.isArray(suppliersRaw.data)) ? suppliersRaw.data : []
  const topCreditors = (suppliersData ?? [])
    .filter(s => s && (s?.current_balance ?? 0) > 0)
    .sort((a, b) => (b?.current_balance ?? 0) - (a?.current_balance ?? 0))
    .slice(0, 8)
    .map(s => ({
      name: s?.name ? (s.name.length > 16 ? s.name.slice(0, 16) + '…' : s.name) : 'unknown',
      value: s?.current_balance ?? 0,
    }))

  const totalCashIn  = cashflow.reduce((s, r) => s + r.cash_in,  0)
  const totalCashOut = cashflow.reduce((s, r) => s + r.cash_out, 0)
  const netCashflow  = totalCashIn - totalCashOut
  const totalInventoryValue = (balancesRaw && Array.isArray(balancesRaw) ? balancesRaw : [])
    .reduce((s, b) => s + (b?.balance_value ?? 0), 0)
  const totalCreditors = suppliersData.reduce((s, r) => s + Math.max(0, r?.current_balance ?? 0), 0)

  return (
    <div className="space-y-5 pb-10" dir="rtl">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <BarChart3 size={22} className="text-brand-600" />
          التقارير المرئية
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400">فترة التدفق النقدي:</span>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {[6, 12, 24].map(m => (
              <button
                key={m}
                onClick={() => setCashflowMonths(m)}
                className={`px-3 py-1 text-xs rounded-md font-semibold transition-all ${
                  cashflowMonths === m
                    ? 'bg-white shadow text-brand-700'
                    : 'text-slate-500 hover:text-slate-700'}`}
              >
                {m} شهر
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="إجمالي الوارد"  value={egpFull(totalCashIn)}          sub={`${cashflowMonths} شهر`} icon={<TrendingUp  size={16} />} color="bg-emerald-50 border-emerald-100 text-emerald-800" />
        <KpiCard label="إجمالي الصادر" value={egpFull(totalCashOut)}         sub={`${cashflowMonths} شهر`} icon={<TrendingDown size={16} />} color="bg-red-50 border-red-100 text-red-800" />
        <KpiCard label="صافي التدفق"   value={egpFull(netCashflow)}          sub={netCashflow >= 0 ? 'فائض' : 'عجز'} icon={<Banknote size={16} />} color={netCashflow >= 0 ? 'bg-brand-50 border-brand-100 text-brand-800' : 'bg-orange-50 border-orange-100 text-orange-800'} />
        <KpiCard label="قيمة المخزون" value={egpFull(totalInventoryValue)} sub={`${(balancesRaw && Array.isArray(balancesRaw) ? balancesRaw : []).length} صنف`} icon={<Package size={16} />} color="bg-violet-50 border-violet-100 text-violet-800" />
      </div>

      {/* ── Chart 1: Monthly Cashflow — Area ─── */}
      <ChartSection title="التدفق النقدي الشهري" icon={<TrendingUp size={16} />} badge={`${cashflowMonths} شهر`}>
        {loadingCashflow ? <LoadingChart /> : cashflowChart.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={cashflowChart} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <defs>
                <linearGradient id="gradIn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="gradOut" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis tickFormatter={egp} tick={{ fontSize: 11, fill: '#94a3b8' }} width={48} />
              <Tooltip content={<ChartTooltip />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="وارد"  stroke="#10b981" fill="url(#gradIn)"  strokeWidth={2.5} dot={false} />
              <Area type="monotone" dataKey="صادر"  stroke="#ef4444" fill="url(#gradOut)" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="صافي"  stroke="#3b82f6" strokeWidth={2}       dot={false} strokeDasharray="5 3" />
            </ComposedChart>
          </ResponsiveContainer>
        ) : <EmptyChart message="لا توجد حركات خزينة مسجّلة" />}
      </ChartSection>

      {/* ── Charts 2+3: 2-column row ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Chart 2: Cost by Crop — Pie */}
        <ChartSection title="التكلفة حسب المحصول" icon={<Leaf size={16} />} badge={cropChart.length > 0 ? `${cropChart.length} محصول` : undefined}>
          {loadingCrop ? <LoadingChart /> : cropChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={cropChart}
                  cx="50%"
                  cy="50%"
                  innerRadius={65}
                  outerRadius={110}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                  label={({ name, percent }: { name?: string; percent?: number }) =>
                    (percent ?? 0) > 0.06 ? `${(name ?? '').slice(0,10)}${(name ?? '').length > 10 ? '…' : ''} ${((percent ?? 0) * 100).toFixed(0)}%` : ''
                  }
                  labelLine={{ stroke: '#e2e8f0', strokeWidth: 1 }}
                >
                  {cropChart.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: unknown) => egpFull(v as number)} />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyChart message="لا توجد تكاليف محاصيل للموسم" />}
        </ChartSection>

        {/* Chart 3: Warehouse Value — Horizontal Bar */}
        <ChartSection title="قيمة المخزون حسب المخزن" icon={<Package size={16} />} badge={warehouseChart.length > 0 ? `${warehouseChart.length} مخزن` : undefined}>
          {loadingBalances ? <LoadingChart /> : warehouseChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={warehouseChart}
                layout="vertical"
                margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tickFormatter={egp} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip formatter={(v: unknown) => egpFull(v as number)} />
                <Bar dataKey="value" name="القيمة" radius={[0, 6, 6, 0]}>
                  {warehouseChart.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart message="لا توجد أرصدة مخزنية" />}
        </ChartSection>
      </div>

      {/* ── Charts 4+5: 2-column row ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Chart 4: Top 10 Items by Value — Column Bar */}
        <ChartSection title="أعلى 10 أصناف قيمةً" icon={<Package size={16} />} badge="المخزون">
          {loadingBalances ? <LoadingChart /> : topItemsChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topItemsChart} margin={{ top: 5, right: 10, left: 10, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tickFormatter={egp} tick={{ fontSize: 11, fill: '#94a3b8' }} width={48} />
                <Tooltip formatter={(v: unknown) => egpFull(v as number)} />
                <Bar dataKey="value" name="القيمة" radius={[6, 6, 0, 0]}>
                  {topItemsChart.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart message="لا توجد أصناف في المخزن" />}
        </ChartSection>

        {/* Chart 5: Top creditor suppliers — Horizontal Bar */}
        <ChartSection title="أكبر الموردين مديونيةً" icon={<Users size={16} />} badge={topCreditors.length > 0 ? egpFull(totalCreditors) : undefined}>
          {loadingSuppliers ? <LoadingChart /> : topCreditors.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={topCreditors}
                layout="vertical"
                margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tickFormatter={egp} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip formatter={(v: unknown) => egpFull(v as number)} />
                <Bar dataKey="value" name="الرصيد" radius={[0, 6, 6, 0]}>
                  {topCreditors.map((_, i) => (
                    <Cell key={i} fill={PALETTE[(i + 3) % PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart message="لا توجد ذمم موردين مستحقة" />}
        </ChartSection>
      </div>
    </div>
  )
}
