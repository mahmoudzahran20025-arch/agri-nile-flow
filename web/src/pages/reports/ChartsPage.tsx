import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ComposedChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Line,
} from 'recharts'
import { BarChart3, TrendingUp, Package, Users } from 'lucide-react'
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

const PALETTE = ['#1d7f4f','#2d9d6a','#3bba84','#f59e0b','#ef4444','#6366f1','#ec4899','#14b8a6','#f97316','#a855f7']

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
function ChartSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-5">
        <span className="text-brand-600">{icon}</span>
        <h2 className="font-bold text-slate-800">{title}</h2>
      </div>
      {children}
    </div>
  )
}

export default function ChartsPage() {
  const seasonId = useSeasonId()
  const [cashflowMonths, setCashflowMonths] = useState(12)

  // ─── Data queries ──────────────────────────────────────────
  const { data: cashflow = [] } = useQuery({
    queryKey: ['dashboard', 'cashflow', cashflowMonths],
    queryFn: () => dashboardApi.monthlyCashflow(cashflowMonths) as Promise<{ year: number; month: number; cash_in: number; cash_out: number }[]>,
  })

  const { data: byCrop = [] } = useQuery({
    queryKey: ['dashboard', 'crop', seasonId],
    queryFn: () => dashboardApi.costByCrop(seasonId) as Promise<{ crop: string | null; total_cost: number }[]>,
  })

  const { data: balancesRaw = null } = useQuery({
    queryKey: ['inventory', 'balances', null],
    queryFn: () => inventoryApi.balances() as Promise<{ warehouse: string; item_name: string; balance_qty: number; balance_value: number }[]>,
  })

  const { data: suppliersRaw = null } = useQuery({
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

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <BarChart3 size={22} className="text-slate-400" />
          التقارير المرئية
        </h1>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500">فترة التدفق النقدي:</label>
          {[6, 12, 24].map(m => (
            <button
              key={m}
              onClick={() => setCashflowMonths(m)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors
                ${cashflowMonths === m
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {m} شهر
            </button>
          ))}
        </div>
      </div>

      {/* ── Chart 1: Monthly Cashflow — Area ─── */}
      <ChartSection title="التدفق النقدي الشهري" icon={<TrendingUp size={18} />}>
        {cashflowChart.length > 0 ? (
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
              <Area type="monotone" dataKey="وارد"  stroke="#22c55e" fill="url(#gradIn)"  strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="صادر"  stroke="#ef4444" fill="url(#gradOut)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="صافي"  stroke="#6366f1" strokeWidth={2}       dot={false} strokeDasharray="4 2" />
            </ComposedChart>
          </ResponsiveContainer>
        ) : <p className="text-center text-slate-400 py-16 text-sm">لا توجد بيانات</p>}
      </ChartSection>

      {/* ── Charts 2+3: 2-column row ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Chart 2: Cost by Crop — Pie */}
        <ChartSection title="التكلفة حسب المحصول" icon={<BarChart3 size={18} />}>
          {cropChart.length > 0 ? (
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
                    (percent ?? 0) > 0.05 ? `${name ?? ''} (${((percent ?? 0) * 100).toFixed(0)}%)` : ''
                  }
                  labelLine={{ stroke: '#cbd5e1', strokeWidth: 1 }}
                >
                  {cropChart.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: unknown) => egpFull(v as number)} />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-center text-slate-400 py-16 text-sm">لا توجد بيانات</p>}
        </ChartSection>

        {/* Chart 3: Warehouse Value — Horizontal Bar */}
        <ChartSection title="قيمة المخزون حسب المخزن" icon={<Package size={18} />}>
          {warehouseChart.length > 0 ? (
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
                <Bar dataKey="value" name="القيمة" radius={[0, 4, 4, 0]}>
                  {warehouseChart.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-center text-slate-400 py-16 text-sm">لا توجد بيانات</p>}
        </ChartSection>
      </div>

      {/* ── Charts 4+5: 2-column row ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Chart 4: Top 10 Items by Value — Column Bar */}
        <ChartSection title="أعلى 10 أصناف قيمةً في المخزن" icon={<Package size={18} />}>
          {topItemsChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topItemsChart} margin={{ top: 5, right: 10, left: 10, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tickFormatter={egp} tick={{ fontSize: 11, fill: '#94a3b8' }} width={48} />
                <Tooltip formatter={(v: unknown) => egpFull(v as number)} />
                <Bar dataKey="value" name="القيمة" radius={[4, 4, 0, 0]}>
                  {topItemsChart.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-center text-slate-400 py-16 text-sm">لا توجد بيانات</p>}
        </ChartSection>

        {/* Chart 5: Top creditor suppliers — Horizontal Bar */}
        <ChartSection title="أكبر الموردين مديونيةً" icon={<Users size={18} />}>
          {topCreditors.length > 0 ? (
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
                <Bar dataKey="value" name="الرصيد" fill="#ef4444" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-center text-slate-400 py-16 text-sm">لا توجد بيانات</p>}
        </ChartSection>
      </div>
    </div>
  )
}
