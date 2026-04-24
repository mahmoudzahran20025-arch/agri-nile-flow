import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Banknote, TrendingDown, Package, Users,
  AlertTriangle, Clock, ArrowUp, ArrowDown,
  TrendingUp, BarChart3,
} from 'lucide-react'
import { dashboardApi, glApi } from '../api/client'
import { useSeasonId, useAbility } from '../store/appStore'
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
  const seasonId = useSeasonId()
  const navigate = useNavigate()

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
