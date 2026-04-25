import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Banknote, TrendingDown, Package, Users,
  AlertTriangle, Clock, ArrowUp, ArrowDown,
  TrendingUp, BarChart3, Bell, ChevronLeft,
  Leaf, Target, ShieldCheck, ShieldAlert, CheckCircle2, ArrowRight,
} from 'lucide-react'
import { dashboardApi, glApi, treasuryApi, reportsApi } from '../api/client'
import type { IntegrityCheck } from '../api/client'
import { hrApi } from '../api/hr'
import { useSeasonId, useAbility, useAppStore } from '../store/appStore'
import KPICard from '../components/ui/KPICard'
import type { DashboardStats } from '../types'

function startOfYear() {
  return `${new Date().getFullYear()}-01-01`
}
function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function egp(n: number) {
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}

function dateAr(iso: string) {
  return new Date(iso).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })
}

export default function DashboardPage() {
  const seasonId  = useSeasonId()
  const navigate  = useNavigate()
  const { role }  = useAppStore()
  const isAdmin   = role === 'super_admin' || role === 'company_admin' || role === 'accountant'

  const canReadFinance = useAbility('treasury', 'read')
  const canReadReports = useAbility('reports', 'read')
  const canReadInventory = useAbility('inventory', 'read')

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn:  () => dashboardApi.stats() as Promise<DashboardStats>,
  })

  const { data: cashflow } = useQuery({
    queryKey: ['dashboard', 'cashflow'],
    queryFn:  () => dashboardApi.monthlyCashflow(6) as Promise<{ year: number; month: number; cash_in: number; cash_out: number }[]>,
  })

  const { data: byCrop } = useQuery({
    queryKey: ['dashboard', 'crop', seasonId],
    queryFn:  () => dashboardApi.costByCrop(seasonId) as Promise<{ crop: string | null; total_cost: number }[]>,
  })

  const { data: recent } = useQuery({
    queryKey: ['dashboard', 'recent'],
    queryFn:  () => dashboardApi.recentTransactions(12) as Promise<{ ledger: string; id: number; date: string; description: string; amount: number; type: string }[]>,
  })

  const { data: alerts } = useQuery({
    queryKey: ['dashboard', 'alerts'],
    queryFn:  () => dashboardApi.inventoryAlerts() as Promise<{ name: string; balance_qty: number; unit: string; warehouse: string }[]>,
  })

  const { data: incomeData } = useQuery({
    queryKey: ['dashboard', 'income-statement'],
    queryFn:  () => glApi.incomeStatement(startOfYear(), todayStr()) as Promise<{
      revenue: { code: string; name: string; amount: number }[]
      expenses: { code: string; name: string; amount: number }[]
      net_income: number
    }>,
  })

  const { data: payrollRuns } = useQuery({
    queryKey: ['hr-payroll'],
    queryFn:  () => hrApi.getPayrollRuns(),
    enabled:  canReadFinance,
  })

  const { data: draftTxPage } = useQuery({
    queryKey: ['dashboard', 'draft-tx'],
    queryFn:  () => treasuryApi.list({ status: 'draft', size: 1 }),
    enabled:  canReadFinance,
  })

  const { data: seasonPnL } = useQuery({
    queryKey: ['reports', 'season-pnl', seasonId],
    queryFn:  () => reportsApi.seasonPnL(seasonId!),
    enabled:  !!seasonId && canReadReports,
    staleTime: 300_000,
  })

  const { data: budgetData } = useQuery({
    queryKey: ['reports', 'budget-vs-actual', seasonId],
    queryFn:  () => reportsApi.budgetVsActual(seasonId!),
    enabled:  !!seasonId && canReadReports,
    staleTime: 300_000,
  })

  const { data: glHealth } = useQuery({
    queryKey: ['gl-integrity', 'dashboard'],
    queryFn:  glApi.integrityCheck,
    enabled:  isAdmin,
    staleTime: 120_000,
  })
  const glChecks = (glHealth?.checks ?? []) as IntegrityCheck[]
  const glScore  = glHealth?.score ?? null
  const glBlockers = glChecks.filter(ch => !ch.ok && ch.blocker).length
  const glWarnings = glChecks.filter(ch => !ch.ok && !ch.blocker).length

  const pendingPayrolls = (payrollRuns ?? []).filter(r => r.status === 'approved').length
  const draftTxCount   = (draftTxPage as { total?: number } | undefined)?.total ?? 0

  const totalRevenue  = incomeData?.revenue?.reduce( (s: number, r: { amount: number }) => s + (r.amount ?? 0), 0) ?? 0
  const totalExpenses = incomeData?.expenses?.reduce((s: number, r: { amount: number }) => s + (r.amount ?? 0), 0) ?? 0
  const netIncome     = incomeData?.net_income ?? (totalRevenue - totalExpenses)

  // Month-over-month trends from cashflow (current vs previous month net)
  const cf = cashflow ?? []
  const cfCurrent  = cf[cf.length - 1]
  const cfPrevious = cf[cf.length - 2]
  function mpmTrend(curr: number | undefined, prev: number | undefined): number | undefined {
    if (curr == null || prev == null || prev === 0) return undefined
    return ((curr - prev) / Math.abs(prev)) * 100
  }
  const cashInTrend  = mpmTrend(cfCurrent?.cash_in,  cfPrevious?.cash_in)
  const cashOutTrend = mpmTrend(cfCurrent?.cash_out, cfPrevious?.cash_out)

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div className="page-header">
        <h1 className="page-title">لوحة التحكم</h1>
        <span className="text-sm text-slate-400">
          {new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </span>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {canReadFinance && (
          <>
            <KPICard
              title="رصيد الخزينة"
              value={statsLoading ? '…' : (stats?.cash_balance ?? 0)}
              icon={Banknote}
              color="green"
              format="currency"
              subtitle="آخر حركة مسجلة"
              trend={cashInTrend}
            />
            <KPICard
              title="إجمالي المديونية"
              value={statsLoading ? '…' : Math.abs(stats?.net_payable ?? 0)}
              icon={TrendingDown}
              color="red"
              format="currency"
              subtitle="ما يستحق للموردين"
              trend={cashOutTrend}
              invertTrend
            />
          </>
        )}
        
        {canReadInventory && (
          <KPICard
            title="قيمة المخزون"
            value={statsLoading ? '…' : (stats?.inventory_value ?? 0)}
            icon={Package}
            color="blue"
            format="currency"
            subtitle="إجمالي قيمة المخازن"
          />
        )}

        {canReadFinance && (
          <KPICard
            title="حقوق الشركاء"
            value={statsLoading ? '…' : (stats?.partners_equity ?? 0)}
            icon={Users}
            color="amber"
            format="currency"
            subtitle="رأس المال + الجاري"
          />
        )}
      </div>

      {/* ── GL Health Card (admin only) ──────────────────────── */}
      {isAdmin && glScore !== null && (
        <div
          className={`card p-5 border-2 cursor-pointer transition-all hover:shadow-md ${
            glBlockers > 0
              ? 'border-red-200 bg-red-50/40 hover:border-red-300'
              : glWarnings > 0
              ? 'border-amber-200 bg-amber-50/40 hover:border-amber-300'
              : 'border-emerald-200 bg-emerald-50/40 hover:border-emerald-300'
          }`}
          onClick={() => navigate('/audit/integrity')}
        >
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm shrink-0 ${
                glBlockers > 0 ? 'bg-red-500' : glWarnings > 0 ? 'bg-amber-500' : 'bg-emerald-600'
              }`}>
                {glBlockers > 0
                  ? <ShieldAlert size={22} className="text-white" />
                  : <ShieldCheck size={22} className="text-white" />
                }
              </div>
              <div>
                <h2 className="font-bold text-slate-800">صحة النظام المالي</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {glBlockers > 0
                    ? `${glBlockers} مشكلة حاجبة تحتاج معالجة فورية`
                    : glWarnings > 0
                    ? `${glWarnings} تحذير — يُنصح بالمراجعة`
                    : 'جميع الفحوصات ناجحة — النظام سليم'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* Score circle */}
              <div className={`text-center px-4 py-2 rounded-xl font-black text-2xl tabular-nums ${
                glScore >= 80 ? 'text-emerald-700 bg-emerald-100' :
                glScore >= 50 ? 'text-amber-700 bg-amber-100' :
                'text-red-700 bg-red-100'
              }`}>
                {glScore}%
              </div>
              {/* Mini checks preview */}
              <div className="hidden sm:flex gap-1 flex-wrap max-w-[200px]">
                {glChecks.slice(0, 7).map(ch => (
                  <span key={ch.key} className={`w-2.5 h-2.5 rounded-full ${ch.ok ? 'bg-emerald-500' : ch.blocker ? 'bg-red-500' : 'bg-amber-400'}`} title={ch.label} />
                ))}
              </div>
              <ArrowRight size={16} className="text-slate-400" />
            </div>
          </div>

          {/* Blocker pills */}
          {glBlockers > 0 && (
            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-red-200">
              {glChecks.filter(ch => !ch.ok && ch.blocker).map(ch => (
                <span key={ch.key} className="text-[11px] font-bold bg-red-100 text-red-700 border border-red-200 px-2.5 py-1 rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  {ch.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Onboarding Checklist (when setup incomplete) ─────── */}
      {isAdmin && glScore !== null && glScore < 100 && (
        <div className="card p-5 border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-slate-50/40">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 bg-indigo-100 rounded-lg flex items-center justify-center">
              <CheckCircle2 size={14} className="text-indigo-600" />
            </div>
            <h2 className="font-bold text-slate-800 text-sm">قائمة إعداد النظام</h2>
            <span className="mr-auto text-[11px] font-bold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full">
              {glChecks.filter(ch => ch.ok).length}/{glChecks.length} مكتمل
            </span>
          </div>
          <div className="space-y-2">
            {glChecks.map(ch => (
              <button
                key={ch.key}
                onClick={() => navigate(ch.action_url)}
                className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-right transition-colors group ${
                  ch.ok ? 'opacity-60 hover:opacity-80' : 'hover:bg-white/80'
                }`}
              >
                <span className="shrink-0">
                  {ch.ok
                    ? <CheckCircle2 size={16} className="text-emerald-500" />
                    : ch.blocker
                    ? <span className="w-4 h-4 rounded-full border-2 border-red-400 flex items-center justify-center"><span className="w-2 h-2 rounded-full bg-red-400" /></span>
                    : <span className="w-4 h-4 rounded-full border-2 border-amber-400" />
                  }
                </span>
                <span className={`flex-1 text-xs font-medium ${ch.ok ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                  {ch.label}
                </span>
                {!ch.ok && (
                  <ArrowRight size={12} className="text-slate-300 group-hover:text-indigo-500 shrink-0 transition-colors" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Active Season Health Widget ──────────────────────── */}
      {canReadReports && seasonId && seasonPnL?.season && (
        <div className="card p-5 border-brand-100 bg-gradient-to-br from-brand-50/60 to-emerald-50/40">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-brand-100 rounded-xl flex items-center justify-center">
                <Leaf size={16} className="text-brand-600" />
              </div>
              <div>
                <h2 className="font-bold text-slate-800 text-sm">صحة الموسم الزراعي</h2>
                <p className="text-xs text-slate-400">{seasonPnL.season.name}</p>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${
                seasonPnL.season.status === 'open'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 text-slate-500'
              }`}>
                {seasonPnL.season.status === 'open' ? 'مفتوح' : 'مغلق'}
              </span>
            </div>
            <div className="flex gap-2 text-xs">
              <button
                onClick={() => navigate('/reports/season-pnl')}
                className="flex items-center gap-1 text-brand-600 hover:text-brand-700 font-semibold bg-white border border-brand-200 hover:border-brand-300 px-3 py-1.5 rounded-lg transition-all"
              >
                <TrendingUp size={12} /> أرباح وخسائر
              </button>
              <button
                onClick={() => navigate('/reports/budget-vs-actual')}
                className="flex items-center gap-1 text-brand-600 hover:text-brand-700 font-semibold bg-white border border-brand-200 hover:border-brand-300 px-3 py-1.5 rounded-lg transition-all"
              >
                <Target size={12} /> الميزانية
              </button>
              <button
                onClick={() => navigate('/reports/season-readiness')}
                className="flex items-center gap-1 text-brand-600 hover:text-brand-700 font-semibold bg-white border border-brand-200 hover:border-brand-300 px-3 py-1.5 rounded-lg transition-all"
              >
                <ShieldCheck size={12} /> الجاهزية
              </button>
            </div>
          </div>

          {/* P&L mini-KPIs */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-white/80 rounded-xl p-3 text-center border border-emerald-100">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">الإيرادات</p>
              <p className="font-black text-emerald-700 tabular-nums">{egp(seasonPnL.revenue.contracts_value)}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{seasonPnL.revenue.contracts_count} عقد</p>
            </div>
            <div className="bg-white/80 rounded-xl p-3 text-center border border-red-100">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">التكاليف</p>
              <p className="font-black text-red-600 tabular-nums">{egp(seasonPnL.costs.total)}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {seasonPnL.total_area > 0 ? `${egp(seasonPnL.costs.total / seasonPnL.total_area)} / فدان` : '—'}
              </p>
            </div>
            <div className={`bg-white/80 rounded-xl p-3 text-center border ${
              seasonPnL.net_margin >= 0 ? 'border-brand-100' : 'border-red-100'
            }`}>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">صافي الربح</p>
              <p className={`font-black tabular-nums ${seasonPnL.net_margin >= 0 ? 'text-brand-700' : 'text-red-600'}`}>
                {egp(seasonPnL.net_margin)}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {seasonPnL.margin_pct != null ? `${seasonPnL.margin_pct}%` : '—'}
              </p>
            </div>
          </div>

          {/* Budget utilization bar */}
          {budgetData?.totals && budgetData.totals.budget > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Target size={12} className="text-slate-400" />
                  <p className="text-xs text-slate-500 font-medium">استهلاك الميزانية الحقلية</p>
                </div>
                <div className="flex items-center gap-2">
                  {budgetData.totals.over_budget_count > 0 && (
                    <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">
                      {budgetData.totals.over_budget_count} حقل تجاوز
                    </span>
                  )}
                  <span className={`text-xs font-black tabular-nums ${
                    (budgetData.totals.utilization_pct ?? 0) > 100 ? 'text-red-600'
                    : (budgetData.totals.utilization_pct ?? 0) > 80  ? 'text-amber-600'
                    : 'text-emerald-600'
                  }`}>
                    {budgetData.totals.utilization_pct?.toFixed(1) ?? '—'}%
                  </span>
                </div>
              </div>
              <div className="bg-slate-100 rounded-full h-2.5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ${
                    (budgetData.totals.utilization_pct ?? 0) > 100 ? 'bg-red-500'
                    : (budgetData.totals.utilization_pct ?? 0) > 80  ? 'bg-amber-400'
                    : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(budgetData.totals.utilization_pct ?? 0, 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                <span>{egp(budgetData.totals.actual)} فعلي</span>
                <span>{egp(budgetData.totals.budget)} ميزانية</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* GL Financial Summary — Year to Date */}
      {canReadReports && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={18} className="text-brand-600" />
            <h2 className="font-bold text-slate-800">الملخص المالي — منذ بداية العام</h2>
            <span className="text-xs text-slate-400 mr-auto">
              {new Date().getFullYear()}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Revenue */}
            <KPICard title="إجمالي الإيرادات" value={totalRevenue} icon={TrendingUp} color="green" format="currency" subtitle="منذ بداية العام" />
            {/* Expenses */}
            <KPICard title="إجمالي المصروفات" value={totalExpenses} icon={TrendingDown} color="red" format="currency" subtitle="منذ بداية العام" invertTrend />
            {/* Net Income */}
            <KPICard
              title="صافي الربح / الخسارة"
              value={Math.abs(netIncome)}
              icon={netIncome >= 0 ? TrendingUp : TrendingDown}
              color={netIncome >= 0 ? 'green' : 'red'}
              format="currency"
              subtitle={netIncome < 0 ? '(خسارة)' : 'ربح صافي'}
            />
          </div>
        </div>
      )}

      {/* Middle row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Monthly cashflow */}
        <div className="card p-5 lg:col-span-2">
          <h2 className="font-bold text-slate-800 mb-4">التدفق النقدي — آخر 6 أشهر</h2>
          {cashflow && cashflow.length > 0 ? (
            <div className="space-y-2">
              {cashflow.map(row => {
                const monthName = new Date(row.year, row.month - 1).toLocaleDateString('ar-EG', { month: 'short', year: '2-digit' })
                const max = Math.max(...cashflow.map(r => Math.max(r.cash_in, r.cash_out)), 1)
                return (
                  <div key={`${row.year}-${row.month}`} className="flex items-center gap-3 text-sm">
                    <span className="text-slate-500 w-14 text-left shrink-0">{monthName}</span>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <ArrowDown size={12} className="text-green-500 shrink-0" />
                        <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div className="bg-green-500 h-full rounded-full" style={{ width: `${(row.cash_in / max) * 100}%` }} />
                        </div>
                        <span className="text-xs text-green-700 w-20 text-left">{egp(row.cash_in)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <ArrowUp size={12} className="text-red-400 shrink-0" />
                        <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div className="bg-red-400 h-full rounded-full" style={{ width: `${(row.cash_out / max) * 100}%` }} />
                        </div>
                        <span className="text-xs text-red-600 w-20 text-left">{egp(row.cash_out)}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-slate-400 text-sm text-center py-8">لا توجد بيانات للتدفق النقدي</p>
          )}
        </div>

        {/* Cost by crop */}
        <div className="card p-5">
          <h2 className="font-bold text-slate-800 mb-4">التكلفة حسب المحصول</h2>
          {byCrop && byCrop.length > 0 ? (
            <div className="space-y-3">
              {byCrop.slice(0, 6).map((row, i) => {
                const max = byCrop[0]?.total_cost ?? 1
                const pct = Math.round((row.total_cost / max) * 100)
                const colors = ['bg-brand-500', 'bg-blue-500', 'bg-amber-500', 'bg-purple-500', 'bg-teal-500', 'bg-rose-500']
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-slate-700 truncate max-w-[120px]">{row.crop ?? 'غير محدد'}</span>
                      <span className="text-slate-500">{egp(row.total_cost)}</span>
                    </div>
                    <div className="bg-slate-100 rounded-full h-1.5 overflow-hidden">
                      <div className={`${colors[i % colors.length]} h-full rounded-full`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-slate-400 text-sm text-center py-8">لا توجد بيانات</p>
          )}
        </div>
      </div>

      {/* Pending Actions */}
      {canReadFinance && (pendingPayrolls > 0 || draftTxCount > 0) && (
        <div className="card p-5">
          <h2 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Bell size={16} className="text-amber-500" />
            إجراءات معلقة
            <span className="mr-auto bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded-full">
              {pendingPayrolls + draftTxCount}
            </span>
          </h2>
          <div className="space-y-2">
            {pendingPayrolls > 0 && (
              <button
                onClick={() => navigate('/hr/payroll')}
                className="w-full flex items-center gap-3 py-2.5 px-3 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 transition-colors text-right group"
              >
                <div className="w-8 h-8 rounded-lg bg-amber-200 flex items-center justify-center shrink-0">
                  <Banknote size={15} className="text-amber-700" />
                </div>
                <div className="flex-1 min-w-0 text-right">
                  <p className="text-sm font-semibold text-amber-800">
                    {pendingPayrolls} {pendingPayrolls === 1 ? 'مسيرة راتب معتمدة' : 'مسيرات رواتب معتمدة'} — بانتظار الصرف
                  </p>
                  <p className="text-xs text-amber-600">يلزم صرف الرواتب لإغلاق المسيرة وترحيل القيد</p>
                </div>
                <ChevronLeft size={16} className="text-amber-400 group-hover:text-amber-600 shrink-0" />
              </button>
            )}
            {draftTxCount > 0 && (
              <button
                onClick={() => navigate('/treasury')}
                className="w-full flex items-center gap-3 py-2.5 px-3 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors text-right group"
              >
                <div className="w-8 h-8 rounded-lg bg-blue-200 flex items-center justify-center shrink-0">
                  <Clock size={15} className="text-blue-700" />
                </div>
                <div className="flex-1 min-w-0 text-right">
                  <p className="text-sm font-semibold text-blue-800">
                    {draftTxCount} {draftTxCount === 1 ? 'معاملة نقدية' : 'معاملات نقدية'} في المسودة
                  </p>
                  <p className="text-xs text-blue-600">يلزم الترحيل لتحديث رصيد الخزينة والدفتر</p>
                </div>
                <ChevronLeft size={16} className="text-blue-400 group-hover:text-blue-600 shrink-0" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent transactions */}
        <div className="card p-5">
          <h2 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Clock size={16} className="text-slate-400" />
            آخر المعاملات
          </h2>
          {recent && recent.length > 0 ? (
            <div className="space-y-2">
              {recent.map((tx, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
                    ${tx.type === 'د' || tx.ledger === 'cash' && tx.type === 'د' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                    {tx.type === 'د' ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">{tx.description}</p>
                    <p className="text-xs text-slate-400">{dateAr(tx.date)} · {tx.ledger === 'cash' ? 'خزينة' : 'موردين'}</p>
                  </div>
                  <span className={`text-sm font-semibold shrink-0
                    ${tx.type === 'د' ? 'text-green-700' : 'text-red-600'}`}>
                    {egp(tx.amount)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-400 text-sm text-center py-8">لا توجد معاملات حديثة</p>
          )}
        </div>

        {/* Inventory alerts */}
        <div className="card p-5">
          <h2 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500" />
            تنبيهات المخزون
            {alerts && alerts.length > 0 && (
              <span className="mr-auto bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                {alerts.length} صنف
              </span>
            )}
          </h2>
          {alerts && alerts.length > 0 ? (
            <div className="space-y-1">
              {alerts.map((item, i) => (
                <button
                  key={i}
                  onClick={() => navigate(`/inventory/item/${(item as { item_code?: string }).item_code ?? String(i)}`)}
                  className="w-full flex items-center gap-3 py-2 px-2 rounded-lg border-b border-slate-100 last:border-0 hover:bg-amber-50 transition-colors text-right group"
                >
                  <div className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0 text-right">
                    <p className="text-sm font-medium text-slate-700 truncate group-hover:text-amber-700">{item.name}</p>
                    <p className="text-xs text-slate-400">{item.warehouse}</p>
                  </div>
                  <span className="text-sm font-bold text-amber-600 shrink-0">
                    {item.balance_qty} {item.unit}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Package size={32} className="text-green-300 mx-auto mb-2" />
              <p className="text-slate-400 text-sm">كل المخزون في مستويات جيدة</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
