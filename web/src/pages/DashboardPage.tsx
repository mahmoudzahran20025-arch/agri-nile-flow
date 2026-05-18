import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Banknote,
  BarChart3,
  Bell,
  Clock,
  Leaf,
  Package,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { dashboardApi, glApi, treasuryApi, reportsApi } from '../api/client'
import type { IntegrityCheck } from '../api/client'
import { hrApi } from '../api/hr'
import type {
  CropCostRow,
  InventoryAlertRow,
  MonthlyCashflowRow,
  RecentTransactionRow,
} from '../api/dashboard'
import { useSeasonId, useAbility, useAppStore } from '../store/appStore'
import type { DashboardStats } from '../types'
import { CommandBar, type CommandAction } from '../components/shell/CommandBar'
import { KpiStrip, type KpiItem } from '../components/ui/KpiStrip'
import KPICard from '../components/ui/KPICard'
import SectionCard from '../components/ui/SectionCard'

function startOfYear() {
  return '2025-01-01'
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function egp(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 0,
  }).format(n)
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
}

function monthLabel(row: MonthlyCashflowRow) {
  return new Date(row.year, row.month - 1).toLocaleDateString('en-US', {
    month: 'short',
    year: '2-digit',
  })
}

function calcTrend(curr?: number, prev?: number) {
  if (curr == null || prev == null || prev === 0) return undefined
  return ((curr - prev) / Math.abs(prev)) * 100
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-[13px] text-slate-400 text-center py-10">{text}</p>
}

export default function DashboardPage() {
  const seasonId = useSeasonId()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { role } = useAppStore()
  const isAdmin = role === 'super_admin' || role === 'company_admin' || role === 'accountant'

  const canReadFinance = useAbility('treasury', 'read')
  const canReadReports = useAbility('reports', 'read')
  const canReadInventory = useAbility('inventory', 'read')

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => dashboardApi.stats() as Promise<DashboardStats>,
  })

  const { data: cashflow = [] } = useQuery({
    queryKey: ['dashboard', 'cashflow'],
    queryFn: () => dashboardApi.monthlyCashflow(6) as Promise<MonthlyCashflowRow[]>,
  })

  const { data: byCrop = [] } = useQuery({
    queryKey: ['dashboard', 'crop', seasonId],
    queryFn: () => dashboardApi.costByCrop(seasonId) as Promise<CropCostRow[]>,
  })

  const { data: recent = [] } = useQuery({
    queryKey: ['dashboard', 'recent'],
    queryFn: () => dashboardApi.recentTransactions(12) as Promise<RecentTransactionRow[]>,
  })

  const { data: alerts = [] } = useQuery({
    queryKey: ['dashboard', 'alerts'],
    queryFn: () => dashboardApi.inventoryAlerts() as Promise<InventoryAlertRow[]>,
  })

  const { data: incomeData } = useQuery({
    queryKey: ['dashboard', 'income-statement'],
    queryFn: () => glApi.incomeStatement(startOfYear(), todayStr()) as Promise<{
      revenue: { code: string; name: string; amount: number }[]
      expenses: { code: string; name: string; amount: number }[]
      net_income: number
    }>,
  })

  const { data: payrollRuns = [] } = useQuery({
    queryKey: ['hr-payroll'],
    queryFn: () => hrApi.getPayrollRuns(),
    enabled: canReadFinance,
  })

  const { data: draftTxPage } = useQuery({
    queryKey: ['dashboard', 'draft-tx'],
    queryFn: () => treasuryApi.list({ status: 'draft', size: 1 }),
    enabled: canReadFinance,
  })

  const { data: seasonPnL } = useQuery({
    queryKey: ['reports', 'season-pnl', seasonId],
    queryFn: () => reportsApi.seasonPnL(seasonId!),
    enabled: !!seasonId && canReadReports,
    staleTime: 300_000,
  })

  const { data: budgetData } = useQuery({
    queryKey: ['reports', 'budget-vs-actual', seasonId],
    queryFn: () => reportsApi.budgetVsActual(seasonId!),
    enabled: !!seasonId && canReadReports,
    staleTime: 300_000,
  })

  const { data: glHealth } = useQuery({
    queryKey: ['gl-integrity', 'dashboard'],
    queryFn: glApi.integrityCheck,
    enabled: isAdmin,
    staleTime: 120_000,
  })

  const { data: glEventsSummary } = useQuery({
    queryKey: ['gl-events-summary'],
    queryFn: () => glApi.eventsSummary(),
    enabled: isAdmin,
    staleTime: 60_000,
  })
  const glErrorCount = glEventsSummary?.error?.unacknowledged ?? 0

  const glChecks = (glHealth?.checks ?? []) as IntegrityCheck[]
  const glScore = glHealth?.score ?? null
  const glBlockers = glChecks.filter((check) => !check.ok && check.blocker).length
  const glWarnings = glChecks.filter((check) => !check.ok && !check.blocker).length

  const pendingPayrolls = payrollRuns.filter((run) => run.status === 'approved').length
  const draftTxCount = (draftTxPage as { total?: number } | undefined)?.total ?? 0

  const totalRevenue = incomeData?.revenue.reduce((sum, row) => sum + (row.amount ?? 0), 0) ?? 0
  const totalExpenses = incomeData?.expenses.reduce((sum, row) => sum + (row.amount ?? 0), 0) ?? 0
  const netIncome = incomeData?.net_income ?? (totalRevenue - totalExpenses)

  const cfCurrent = cashflow[cashflow.length - 1]
  const cfPrevious = cashflow[cashflow.length - 2]
  const cashInTrend = calcTrend(cfCurrent?.cash_in, cfPrevious?.cash_in)
  const cashOutTrend = calcTrend(cfCurrent?.cash_out, cfPrevious?.cash_out)

  const refreshDashboard = () => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['reports'] }),
      queryClient.invalidateQueries({ queryKey: ['gl-integrity'] }),
      queryClient.invalidateQueries({ queryKey: ['hr-payroll'] }),
    ])
  }

  const actions: CommandAction[] = [
    { id: 'refresh', label: 'تحديث', icon: <RefreshCw />, variant: 'secondary', onClick: refreshDashboard },
    { id: 'reports', label: 'التقارير', icon: <BarChart3 />, variant: 'ghost', onClick: () => navigate('/reports/charts') },
    { id: 'treasury', label: 'الخزينة', icon: <Banknote />, variant: 'ghost', onClick: () => navigate('/treasury') },
  ]

  const kpiItems: KpiItem[] = [
    {
      id: 'cash',
      label: 'رصيد الخزينة',
      value: canReadFinance ? (statsLoading ? '…' : egp(stats?.cash_balance ?? 0)) : '—',
      delta: cashInTrend != null ? `${cashInTrend >= 0 ? '+' : ''}${cashInTrend.toFixed(1)}%` : undefined,
      variant: 'success',
    },
    {
      id: 'payable',
      label: 'إجمالي المديونية',
      value: canReadFinance ? (statsLoading ? '…' : egp(Math.abs(stats?.net_payable ?? 0))) : '—',
      delta: cashOutTrend != null ? `${cashOutTrend >= 0 ? '+' : ''}${cashOutTrend.toFixed(1)}%` : undefined,
      variant: 'warning',
    },
    {
      id: 'inventory',
      label: 'قيمة المخزون',
      value: canReadInventory ? (statsLoading ? '…' : egp(stats?.inventory_value ?? 0)) : '—',
    },
    {
      id: 'net-income',
      label: 'صافي الربح',
      value: canReadReports ? egp(netIncome) : '—',
      variant: netIncome >= 0 ? 'success' : 'warning',
    },
  ]

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]" dir="rtl">
      <div className="px-6 py-5 flex items-center justify-between shrink-0 bg-white border-b border-slate-200">
        <div>
          <h1 className="text-[18px] font-bold text-[#0F2D5C]">لوحة التحكم</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">
            نظرة تشغيلية ومالية موحدة عبر الخزينة والمخزون والتقارير
          </p>
        </div>
        <div className="text-[12px] text-slate-400 text-left">
          {new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </div>
      </div>

      <CommandBar actions={actions} />
      <KpiStrip items={kpiItems} />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {isAdmin && glScore !== null && (
          <SectionCard
            title="صحة النظام المالي"
            subtitle={
              glBlockers > 0
                ? `${glBlockers} مشكلة حاجبة تحتاج معالجة فورية`
                : glWarnings > 0
                ? `${glWarnings} تحذير يحتاج مراجعة`
                : 'جميع الفحوصات ناجحة والنظام مستقر'
            }
            icon={glBlockers > 0 ? <ShieldAlert size={18} /> : <ShieldCheck size={18} />}
            action={<button type="button" onClick={() => navigate('/audit/integrity')} className="text-[12px] font-semibold text-[#0F2D5C] hover:underline">فتح مركز التدقيق</button>}
            badge={
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                glScore >= 80
                  ? 'bg-[#1D9E75]/15 text-[#1D9E75]'
                  : glScore >= 50
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-red-100 text-red-700'
              }`}>
                {glScore}%
              </span>
            }
            className={
              glBlockers > 0
                ? 'border-red-200 bg-red-50/40'
                : glWarnings > 0
                ? 'border-amber-200 bg-amber-50/40'
                : 'border-emerald-200 bg-emerald-50/40'
            }
          >
            <div className="flex flex-wrap gap-2">
              {glChecks.map((check) => (
                <button
                  key={check.key}
                  type="button"
                  onClick={() => navigate(check.action_url)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                    check.ok
                      ? 'bg-white text-slate-400 border-slate-200'
                      : check.blocker
                      ? 'bg-red-100 text-red-700 border-red-200 hover:bg-red-200'
                      : 'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200'
                  }`}
                >
                  {check.label}
                </button>
              ))}
            </div>
          </SectionCard>
        )}

        {canReadReports && seasonId && seasonPnL?.season && (
          <SectionCard
            title="صحة الموسم الزراعي"
            subtitle={seasonPnL.season.name}
            icon={<Leaf size={18} />}
            badge={<span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${seasonPnL.season.status === 'open' ? 'bg-[#1D9E75]/15 text-[#1D9E75]' : 'bg-slate-100 text-slate-500'}`}>{seasonPnL.season.status === 'open' ? 'مفتوح' : 'مغلق'}</span>}
            action={
              <div className="flex gap-2 flex-wrap">
                <button type="button" onClick={() => navigate('/reports/season-pnl')} className="text-[12px] font-semibold text-[#0F2D5C] hover:underline">أرباح وخسائر</button>
                <button type="button" onClick={() => navigate('/reports/budget-vs-actual')} className="text-[12px] font-semibold text-[#0F2D5C] hover:underline">الميزانية</button>
              </div>
            }
            className="border-[#0F2D5C]/10 bg-gradient-to-br from-[#0F2D5C]/[0.03] to-[#1D9E75]/[0.05]"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <KPICard title="الإيرادات" value={seasonPnL.revenue.contracts_value} icon={TrendingUp} color="green" format="currency" subtitle={`${seasonPnL.revenue.contracts_count} عقد`} />
              <KPICard title="التكاليف" value={seasonPnL.costs.total} icon={TrendingDown} color="red" format="currency" subtitle={seasonPnL.total_area > 0 ? `${egp(seasonPnL.costs.total / seasonPnL.total_area)} / فدان` : '—'} invertTrend />
              <KPICard title="صافي الربح" value={Math.abs(seasonPnL.net_margin)} icon={seasonPnL.net_margin >= 0 ? TrendingUp : TrendingDown} color={seasonPnL.net_margin >= 0 ? 'green' : 'red'} format="currency" subtitle={seasonPnL.margin_pct != null ? `${seasonPnL.margin_pct}%` : '—'} />
            </div>

            {budgetData?.totals && budgetData.totals.budget > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2 text-[12px]">
                  <span className="text-slate-500 font-medium">استهلاك الميزانية الحقلية</span>
                  <span className={`font-bold ${(budgetData.totals.utilization_pct ?? 0) > 100 ? 'text-red-600' : (budgetData.totals.utilization_pct ?? 0) > 80 ? 'text-amber-600' : 'text-[#1D9E75]'}`}>
                    {budgetData.totals.utilization_pct?.toFixed(1) ?? '—'}%
                  </span>
                </div>
                <div className="bg-slate-100 rounded-full h-2.5 overflow-hidden">
                  <div
                    className={`${(budgetData.totals.utilization_pct ?? 0) > 100 ? 'bg-red-500' : (budgetData.totals.utilization_pct ?? 0) > 80 ? 'bg-amber-400' : 'bg-[#1D9E75]'} h-full rounded-full transition-all`}
                    style={{ width: `${Math.min(budgetData.totals.utilization_pct ?? 0, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-slate-400 mt-2">
                  <span>{egp(budgetData.totals.actual)} فعلي</span>
                  <span>{egp(budgetData.totals.budget)} ميزانية</span>
                </div>
              </div>
            )}
          </SectionCard>
        )}

        {canReadReports && (
          <SectionCard title="الملخص المالي منذ بداية العام" subtitle={`${new Date().getFullYear()}`} icon={<BarChart3 size={18} />}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <KPICard title="إجمالي الإيرادات" value={totalRevenue} icon={TrendingUp} color="green" format="currency" subtitle="منذ بداية العام" />
              <KPICard title="إجمالي المصروفات" value={totalExpenses} icon={TrendingDown} color="red" format="currency" subtitle="منذ بداية العام" invertTrend />
              <KPICard title="صافي الربح / الخسارة" value={Math.abs(netIncome)} icon={netIncome >= 0 ? TrendingUp : TrendingDown} color={netIncome >= 0 ? 'green' : 'red'} format="currency" subtitle={netIncome < 0 ? 'خسارة' : 'ربح صافي'} />
            </div>
          </SectionCard>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <SectionCard title="التدفق النقدي" subtitle="آخر 6 أشهر" icon={<Banknote size={18} />} className="lg:col-span-2">
            {cashflow.length > 0 ? (
              <div className="space-y-3">
                {cashflow.map((row) => {
                  const max = Math.max(...cashflow.map((item) => Math.max(item.cash_in, item.cash_out)), 1)
                  return (
                    <div key={`${row.year}-${row.month}`} className="flex items-center gap-3 text-[13px]">
                      <span className="text-slate-500 w-16 shrink-0">{monthLabel(row)}</span>
                      <div className="flex-1 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <ArrowDown size={12} className="text-[#1D9E75] shrink-0" />
                          <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                            <div className="bg-[#1D9E75] h-full rounded-full" style={{ width: `${(row.cash_in / max) * 100}%` }} />
                          </div>
                          <span className="text-[11px] text-[#1D9E75] w-24 text-left">{egp(row.cash_in)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <ArrowUp size={12} className="text-red-500 shrink-0" />
                          <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                            <div className="bg-red-500 h-full rounded-full" style={{ width: `${(row.cash_out / max) * 100}%` }} />
                          </div>
                          <span className="text-[11px] text-red-600 w-24 text-left">{egp(row.cash_out)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <EmptyState text="لا توجد بيانات للتدفق النقدي" />
            )}
          </SectionCard>

          <SectionCard title="التكلفة حسب المحصول" subtitle="أعلى المحاصيل تكلفة" icon={<Leaf size={18} />}>
            {byCrop.length > 0 ? (
              <div className="space-y-3">
                {byCrop.slice(0, 6).map((row, index) => {
                  const max = byCrop[0]?.total_cost ?? 1
                  const pct = Math.round((row.total_cost / max) * 100)
                  const colors = ['bg-[#0F2D5C]', 'bg-blue-500', 'bg-amber-500', 'bg-emerald-500', 'bg-rose-500', 'bg-violet-500']
                  return (
                    <div key={`${row.crop ?? 'unknown'}-${index}`} className="space-y-1.5">
                      <div className="flex justify-between text-[12px] gap-3">
                        <span className="font-medium text-slate-700 truncate">{row.crop ?? 'غير محدد'}</span>
                        <span className="text-slate-500 shrink-0">{egp(row.total_cost)}</span>
                      </div>
                      <div className="bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div className={`${colors[index % colors.length]} h-full rounded-full`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <EmptyState text="لا توجد بيانات للمحاصيل" />
            )}
          </SectionCard>
        </div>

        {canReadFinance && (pendingPayrolls > 0 || draftTxCount > 0 || glErrorCount > 0) && (
          <SectionCard title="إجراءات معلقة" subtitle="العناصر التي تحتاج متابعة تشغيلية" icon={<Bell size={18} />}>
            <div className="space-y-2.5">
              {pendingPayrolls > 0 && (
                <button
                  type="button"
                  onClick={() => navigate('/hr/payroll')}
                  className="w-full flex items-center gap-3 py-3 px-3 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 transition-colors text-right"
                >
                  <div className="w-9 h-9 rounded-lg bg-amber-200 flex items-center justify-center shrink-0">
                    <Banknote size={16} className="text-amber-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-amber-800">{pendingPayrolls} مسيرات رواتب بانتظار الصرف</p>
                    <p className="text-[11px] text-amber-700 mt-0.5">يلزم صرف الرواتب لإغلاق المسيرة وترحيل القيد</p>
                  </div>
                  <ArrowRight size={14} className="text-amber-500 shrink-0" />
                </button>
              )}
              {draftTxCount > 0 && (
                <button
                  type="button"
                  onClick={() => navigate('/treasury')}
                  className="w-full flex items-center gap-3 py-3 px-3 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors text-right"
                >
                  <div className="w-9 h-9 rounded-lg bg-blue-200 flex items-center justify-center shrink-0">
                    <Clock size={16} className="text-blue-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-blue-800">{draftTxCount} معاملات نقدية في المسودة</p>
                    <p className="text-[11px] text-blue-700 mt-0.5">يلزم الترحيل لتحديث رصيد الخزينة والدفتر</p>
                  </div>
                  <ArrowRight size={14} className="text-blue-500 shrink-0" />
                </button>
              )}
              {glErrorCount > 0 && (
                <button
                  type="button"
                  onClick={() => navigate('/gl/batch-posting')}
                  className="w-full flex items-center gap-3 py-3 px-3 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 transition-colors text-right"
                >
                  <div className="w-9 h-9 rounded-lg bg-red-200 flex items-center justify-center shrink-0">
                    <AlertTriangle size={16} className="text-red-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-red-800">{glErrorCount} أحداث ترحيل فاشلة بانتظار الإقرار</p>
                    <p className="text-[11px] text-red-700 mt-0.5">قد تؤثر على دقة الدفتر العام — راجع مركز الترحيل</p>
                  </div>
                  <ArrowRight size={14} className="text-red-500 shrink-0" />
                </button>
              )}
            </div>
          </SectionCard>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SectionCard title="آخر المعاملات" subtitle="أحدث ما تم تسجيله في الأنظمة الفرعية" icon={<Clock size={18} />}>
            {recent.length > 0 ? (
              <div className="space-y-2">
                {recent.map((tx) => (
                  <div key={`${tx.ledger}-${tx.id}`} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${tx.type === 'د' ? 'bg-[#1D9E75]/15 text-[#1D9E75]' : 'bg-red-100 text-red-600'}`}>
                      {tx.type === 'د' ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-slate-700 truncate">{tx.description}</p>
                      <p className="text-[11px] text-slate-400">{shortDate(tx.date)} · {tx.ledger === 'cash' ? 'خزينة' : 'موردين'}</p>
                    </div>
                    <span className={`text-[12px] font-semibold shrink-0 ${tx.type === 'د' ? 'text-[#1D9E75]' : 'text-red-600'}`}>
                      {egp(tx.amount)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="لا توجد معاملات حديثة" />
            )}
          </SectionCard>

          <SectionCard
            title="تنبيهات المخزون"
            subtitle="الأصناف التي وصلت إلى حد إعادة الطلب"
            icon={<AlertTriangle size={18} />}
            badge={alerts.length > 0 ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{alerts.length} صنف</span> : undefined}
          >
            {alerts.length > 0 ? (
              <div className="space-y-1">
                {alerts.map((item) => (
                  <button
                    key={`${item.code}-${item.warehouse}`}
                    type="button"
                    onClick={() => navigate(`/inventory/item/${item.code}`)}
                    className="w-full flex items-center gap-3 py-2 px-2 rounded-lg border-b border-slate-100 last:border-0 hover:bg-amber-50 transition-colors text-right"
                  >
                    <div className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-slate-700 truncate">{item.name}</p>
                      <p className="text-[11px] text-slate-400">{item.warehouse}</p>
                    </div>
                    <span className="text-[12px] font-bold text-amber-600 shrink-0">
                      {item.balance_qty} {item.unit ?? ''}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-10">
                <Package size={32} className="text-[#1D9E75]/40 mx-auto mb-2" />
                <p className="text-[13px] text-slate-400">كل المخزون في مستويات جيدة</p>
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
