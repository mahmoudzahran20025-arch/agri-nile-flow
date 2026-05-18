import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart2, TrendingUp, ShoppingBag, RotateCcw, Loader2 } from 'lucide-react'
import { salesApi, type SalesAnalytics } from '../../api/sales'

const EGP = (n: number) =>
  new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)

const NUM = (n: number) =>
  new Intl.NumberFormat('ar-EG').format(Math.round(n * 100) / 100)

function KpiCard({ label, value, sub, icon, color }: {
  label: string; value: string; sub?: string
  icon: React.ReactNode; color: string
}) {
  return (
    <div className={`rounded-xl border p-4 flex items-start gap-3 ${color}`}>
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>
        <p className="text-xs font-medium text-slate-500 mb-0.5">{label}</p>
        <p className="text-xl font-bold text-slate-800">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function TrendBar({ label, revenue, maxRevenue }: { label: string; revenue: number; maxRevenue: number }) {
  const pct = maxRevenue > 0 ? Math.round((revenue / maxRevenue) * 100) : 0
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-24 shrink-0 text-xs text-slate-500 font-mono text-left">{label}</span>
      <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#0F2D5C] rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-28 shrink-0 text-right text-xs font-semibold text-slate-700">{EGP(revenue)}</span>
    </div>
  )
}

export default function SalesAnalyticsPage() {
  const [period, setPeriod] = useState<'daily' | 'monthly'>('daily')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 29)
    return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['sales-analytics', period, dateFrom, dateTo],
    queryFn:  () => salesApi.getAnalytics({ period, date_from: dateFrom, date_to: dateTo, top_n: 10 }),
    staleTime: 60_000,
  })

  const analytics = data as SalesAnalytics | undefined
  const trend     = analytics?.trend ?? []
  const topItems  = analytics?.top_items ?? []
  const returns   = analytics?.returns_trend ?? []
  const summary   = analytics?.summary

  const maxRevenue = Math.max(...trend.map(r => r.revenue), 1)

  // Build returns map for sparkline overlay
  const returnsMap = Object.fromEntries(returns.map(r => [r.period_label, r.return_total]))

  return (
    <div className="space-y-6 p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <BarChart2 size={22} className="text-[#0F2D5C]" />
          <h1 className="text-xl font-bold text-slate-800">تحليلات المبيعات</h1>
          {isFetching && <Loader2 size={16} className="animate-spin text-slate-400" />}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Period toggle */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
            {(['daily', 'monthly'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  period === p ? 'bg-[#0F2D5C] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {p === 'daily' ? 'يومي' : 'شهري'}
              </button>
            ))}
          </div>
          {/* Date range */}
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C]" />
          <span className="text-slate-400 text-sm">←</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C]" />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={28} className="animate-spin text-slate-300" />
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="إجمالي الإيراد"
              value={EGP(summary?.total_revenue ?? 0)}
              sub={`${NUM(summary?.total_orders ?? 0)} أمر`}
              icon={<TrendingUp size={18} className="text-emerald-600" />}
              color="border-emerald-100 bg-emerald-50/40"
            />
            <KpiCard
              label="صافي الإيراد"
              value={EGP(summary?.net_revenue ?? 0)}
              sub={`بعد خصم المرتجعات`}
              icon={<ShoppingBag size={18} className="text-blue-600" />}
              color="border-blue-100 bg-blue-50/40"
            />
            <KpiCard
              label="متوسط قيمة الأمر"
              value={EGP(summary?.avg_order_value ?? 0)}
              icon={<BarChart2 size={18} className="text-violet-600" />}
              color="border-violet-100 bg-violet-50/40"
            />
            <KpiCard
              label="إجمالي المرتجعات"
              value={EGP(summary?.total_returns ?? 0)}
              icon={<RotateCcw size={18} className="text-rose-500" />}
              color="border-rose-100 bg-rose-50/40"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Revenue trend */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp size={16} className="text-[#0F2D5C]" />
                <h2 className="text-sm font-bold text-slate-700">مسار الإيراد</h2>
              </div>
              {trend.length === 0 ? (
                <p className="text-center text-slate-400 text-sm py-8">لا توجد بيانات في هذا النطاق</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {trend.map(row => (
                    <div key={row.period_label}>
                      <TrendBar label={row.period_label} revenue={row.revenue} maxRevenue={maxRevenue} />
                      {returnsMap[row.period_label] > 0 && (
                        <div className="flex items-center gap-3 text-xs text-rose-500 mr-28 mt-0.5">
                          <RotateCcw size={9} />
                          مرتجع: {EGP(returnsMap[row.period_label])}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top items */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center gap-2 mb-4">
                <ShoppingBag size={16} className="text-[#0F2D5C]" />
                <h2 className="text-sm font-bold text-slate-700">أكثر الأصناف مبيعاً</h2>
              </div>
              {topItems.length === 0 ? (
                <p className="text-center text-slate-400 text-sm py-8">لا توجد بيانات</p>
              ) : (
                <div className="space-y-3">
                  {topItems.map((item, idx) => (
                    <div key={item.item_code} className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-xs flex items-center justify-center font-bold shrink-0">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-700 truncate">
                          {item.item_name ?? `#${item.item_code}`}
                        </p>
                        <p className="text-xs text-slate-400">
                          {NUM(item.total_qty)} {item.unit ?? ''} · {item.order_count} أمر
                        </p>
                      </div>
                      <span className="text-xs font-bold text-slate-800 shrink-0">{EGP(item.total_revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Returns detail */}
          {returns.length > 0 && (
            <div className="bg-white rounded-xl border border-rose-100 p-5">
              <div className="flex items-center gap-2 mb-4">
                <RotateCcw size={16} className="text-rose-500" />
                <h2 className="text-sm font-bold text-slate-700">مسار المرتجعات</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500">الفترة</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500">عدد المرتجعات</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500">إجمالي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returns.map(r => (
                      <tr key={r.period_label} className="border-b border-slate-50 hover:bg-rose-50/30">
                        <td className="px-3 py-2 font-mono text-xs text-slate-600">{r.period_label}</td>
                        <td className="px-3 py-2 text-center text-slate-600">{r.return_count}</td>
                        <td className="px-3 py-2 text-left font-semibold text-rose-600">{EGP(r.return_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
