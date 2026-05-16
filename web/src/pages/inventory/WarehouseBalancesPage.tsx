import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Package, ChevronDown, ChevronUp, Plus, Download, ExternalLink, AlertTriangle, X, Wrench, ArrowRightLeft, Activity, ShieldCheck, Link2Off, Boxes, CircleDollarSign } from 'lucide-react'
import { inventoryApi, downloadCsv } from '../../api/client'

import { TableSkeleton } from '../../components/ui/Skeleton'
import type { } from '../../types'
import { usePermission } from '../../hooks/usePermission'

function egp(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}
function num(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)
}

export default function WarehouseBalancesPage() {
  const { canWrite } = usePermission()
  const navigate     = useNavigate()
  const [activeWarehouse,    setActiveWarehouse]    = useState<string | null>(null)
  const [expanded,           setExpanded]           = useState<Set<string>>(new Set())
  const [reorderDismissed,   setReorderDismissed]   = useState(false)

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn:  inventoryApi.warehouses,
  })

  const { data: reorderAlerts = [] } = useQuery({
    queryKey: ['inventory', 'reorder-alerts'],
    queryFn:  inventoryApi.reorderAlerts,
    staleTime: 120_000,
    refetchInterval: 300_000,
  })

  const { data: healthSummary } = useQuery({
    queryKey: ['inventory', 'health-summary'],
    queryFn: inventoryApi.healthSummary,
    staleTime: 120_000,
  })

  const { data: balancesResp, isLoading } = useQuery({
    queryKey: ['inventory', 'stock-balances', activeWarehouse],
    queryFn:  () => inventoryApi.balancesList({ warehouse: activeWarehouse ?? undefined, size: 2000 }),
  })
  const balances = balancesResp?.data

  // Group by warehouse
  type BalRow = NonNullable<typeof balances>[number]
  const grouped = (balances ?? []).reduce<Record<string, BalRow[]>>((acc, row) => {
    const wh = row.warehouse ?? 'غير محدد'
    if (!acc[wh]) acc[wh] = []
    acc[wh].push(row)
    return acc
  }, {})

  const toggleExpand = (wh: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(wh) ? next.delete(wh) : next.add(wh)
      return next
    })
  }

  const metrics = useMemo(() => {
    const rows = balances ?? []
    const whSet = new Set<string>()
    const itemSet = new Set<number>()
    let totalQty = 0
    let totalValue = 0
    let negativeRows = 0

    for (const r of rows) {
      whSet.add(r.warehouse ?? 'غير محدد')
      itemSet.add(r.item_code)
      totalQty += r.balance_qty ?? 0
      totalValue += r.balance_value ?? 0
      if ((r.balance_qty ?? 0) < 0) negativeRows += 1
    }

    return {
      warehouses: whSet.size,
      items: itemSet.size,
      totalQty,
      totalValue,
      negativeRows,
    }
  }, [balances])

  const postingSummary = healthSummary?.posting ?? {
    health_pct: 100,
    total_combos: 0,
    covered: 0,
    missing_setup: 0,
  }

  const movementSummary = healthSummary?.movement ?? {
    total: 0,
    unlinked_total: 0,
    unlinked_non_zero: 0,
    unlinked_zero: 0,
  }

  const itemRiskSummary = healthSummary?.item_risk ?? {
    active_items: 0,
    items_without_standard_cost: 0,
    items_without_ppg: 0,
    items_without_ipg: 0,
    items_without_reorder_threshold: 0,
    below_reorder_count: 0,
  }

  const stockRiskSummary = healthSummary?.stock_risk ?? {
    negative_balance_rows: metrics.negativeRows,
    negative_balance_items: 0,
  }

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">أرصدة المخازن</h1>
          <p className="text-xs text-slate-500 mt-1">لوحة الأرصدة الحالية حسب المخزن مع مؤشرات التكامل المحاسبي</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary gap-2"
            onClick={() => downloadCsv('/inventory/stock-balances', 'أرصدة_المخازن')}
          >
            <Download size={16} />تصدير CSV
          </button>
          {canWrite('inventory') && (
            <>
              <button
                className="btn-secondary gap-2"
                onClick={() => navigate('/inventory/workspace/new?type=TRANSFER_OUT')}
              >
                <ArrowRightLeft size={16} /> تحويل بين المخازن
              </button>
              <button className="btn-primary gap-2" onClick={() => navigate('/inventory/workspace/new')}>
                <Plus size={16} />
                حركة جديدة
              </button>
            </>
          )}
        </div>
      </div>

      {/* Inventory cockpit KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <button className="card p-4 text-right hover:border-brand-300 hover:bg-brand-50 transition-colors" onClick={() => navigate('/inventory/setup')}>
          <p className="text-xs text-slate-500 mb-1">المخازن النشطة</p>
          <p className="text-2xl font-bold text-slate-800">{metrics.warehouses}</p>
        </button>
        <button className="card p-4 text-right hover:border-emerald-300 hover:bg-emerald-50 transition-colors" onClick={() => navigate('/inventory/items')}>
          <p className="text-xs text-slate-500 mb-1">الأصناف الحالية</p>
          <p className="text-2xl font-bold text-slate-800">{metrics.items}</p>
        </button>
        <button className="card p-4 text-right hover:border-slate-300 hover:bg-slate-50 transition-colors" onClick={() => navigate('/inventory/movements')}>
          <p className="text-xs text-slate-500 mb-1">إجمالي الكمية</p>
          <p className="text-xl font-bold text-slate-800">{num(metrics.totalQty)}</p>
        </button>
        <button className="card p-4 text-right hover:border-brand-300 hover:bg-brand-50 transition-colors" onClick={() => navigate('/inventory/movements')}>
          <p className="text-xs text-slate-500 mb-1">قيمة المخزون</p>
          <p className="text-xl font-bold text-brand-700">{egp(metrics.totalValue)}</p>
        </button>
        <button className={`card p-4 text-right hover:border-red-300 hover:bg-red-50 transition-colors ${metrics.negativeRows > 0 ? 'border-red-200 bg-red-50' : ''}`} onClick={() => navigate('/inventory/movements?negative=1')}>
          <p className="text-xs text-slate-500 mb-1">أرصدة سالبة</p>
          <p className={`text-2xl font-bold ${metrics.negativeRows > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
            {metrics.negativeRows > 0 ? metrics.negativeRows : '✓ 0'}
          </p>
        </button>
      </div>

      {/* Master-data risk cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button className={`card p-4 text-right hover:border-amber-300 hover:bg-amber-50 transition-colors ${itemRiskSummary.items_without_standard_cost > 0 ? 'border-amber-200 bg-amber-50' : ''}`} onClick={() => navigate('/inventory/items?risk=no_standard_cost')}>
          <p className="text-xs text-slate-500 mb-1">بدون تكلفة معيارية</p>
          <p className={`text-xl font-bold ${itemRiskSummary.items_without_standard_cost > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
            {itemRiskSummary.items_without_standard_cost}
          </p>
        </button>
        <button className={`card p-4 text-right hover:border-red-300 hover:bg-red-50 transition-colors ${itemRiskSummary.items_without_ppg > 0 ? 'border-red-200 bg-red-50' : ''}`} onClick={() => navigate('/inventory/items?risk=no_ppg')}>
          <p className="text-xs text-slate-500 mb-1">أصناف بدون PPG</p>
          <p className={`text-xl font-bold ${itemRiskSummary.items_without_ppg > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
            {itemRiskSummary.items_without_ppg}
          </p>
        </button>
        <button className={`card p-4 text-right hover:border-red-300 hover:bg-red-50 transition-colors ${itemRiskSummary.items_without_ipg > 0 ? 'border-red-200 bg-red-50' : ''}`} onClick={() => navigate('/inventory/items?risk=no_ipg')}>
          <p className="text-xs text-slate-500 mb-1">أصناف بدون IPG</p>
          <p className={`text-xl font-bold ${itemRiskSummary.items_without_ipg > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
            {itemRiskSummary.items_without_ipg}
          </p>
        </button>
        <button className={`card p-4 text-right hover:border-amber-300 hover:bg-amber-50 transition-colors ${itemRiskSummary.below_reorder_count > 0 ? 'border-amber-200 bg-amber-50' : ''}`} onClick={() => navigate('/inventory/items?risk=below_reorder')}>
          <p className="text-xs text-slate-500 mb-1">أقل من حد إعادة الطلب</p>
          <p className={`text-xl font-bold ${itemRiskSummary.below_reorder_count > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
            {itemRiskSummary.below_reorder_count}
          </p>
        </button>
      </div>

      {/* Main module actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          onClick={() => navigate('/inventory/movements')}
          className="card p-4 text-right hover:border-brand-300 hover:bg-brand-50 transition-colors"
        >
          <div className="flex items-center gap-2 mb-2 text-brand-700 font-semibold">
            <Activity size={15} /> حركات المخزون
          </div>
          <p className="text-xs text-slate-500">إدارة الإضافة/الصرف والتحويلات مع الفلاتر</p>
        </button>
        <button
          onClick={() => navigate('/inventory/posting-health')}
          className="card p-4 text-right hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
        >
          <div className="flex items-center gap-2 mb-2 text-indigo-700 font-semibold">
            <ShieldCheck size={15} /> صحة الترحيل
          </div>
          <p className="text-xs text-slate-500">متابعة تغطية warehouse×PPG والفجوات المحاسبية</p>
        </button>
        <button
          onClick={() => navigate('/inventory/items')}
          className="card p-4 text-right hover:border-emerald-300 hover:bg-emerald-50 transition-colors"
        >
          <div className="flex items-center gap-2 mb-2 text-emerald-700 font-semibold">
            <Boxes size={15} /> دليل الأصناف
          </div>
          <p className="text-xs text-slate-500">ضبط المجموعات المحاسبية والتكلفة المعيارية</p>
        </button>
      </div>

      {/* Financial linkage health strip */}
      <div className={`rounded-xl border p-4 ${postingSummary.missing_setup > 0 || movementSummary.unlinked_non_zero > 0 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-bold text-slate-800">تكامل المخزون مع المالية (Posting)</p>
            <p className="text-xs text-slate-500 mt-0.5">
              تغطية الإعدادات: {postingSummary.covered}/{postingSummary.total_combos} ({postingSummary.health_pct}%)
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              إجمالي الحركات: {movementSummary.total}
            </p>
          </div>
          <button className="btn-secondary text-xs" onClick={() => navigate('/inventory/posting-health')}>
            فتح لوحة الصحة
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap text-xs">
          <button onClick={() => navigate('/inventory/posting-health')} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border ${postingSummary.missing_setup > 0 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
            <ShieldCheck size={12} /> بدون إعداد: {postingSummary.missing_setup}
          </button>
          <button onClick={() => navigate('/inventory/movements?unlinked=1')} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border ${movementSummary.unlinked_non_zero > 0 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
            <Link2Off size={12} /> حركات بقيمة بدون قيد: {movementSummary.unlinked_non_zero}
          </button>
          <button onClick={() => navigate('/inventory/movements?unlinked=1')} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
            <AlertTriangle size={12} /> حركات صفرية بدون قيد: {movementSummary.unlinked_zero}
          </button>
          <button onClick={() => navigate('/inventory/movements?negative=1')} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border ${stockRiskSummary.negative_balance_rows > 0 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
            <CircleDollarSign size={12} /> أرصدة سالبة حالية: {stockRiskSummary.negative_balance_rows}
          </button>
        </div>
      </div>

      {/* Reorder Alerts */}
      {reorderAlerts.length > 0 && !reorderDismissed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-amber-100 rounded-lg shrink-0">
              <AlertTriangle size={16} className="text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-800 mb-2">
                تنبيه إعادة الطلب — {reorderAlerts.length} {reorderAlerts.length === 1 ? 'صنف' : 'أصناف'} على وشك النفاد
              </p>
              <p className="text-xs text-amber-600 mb-3">
                استهلاك أوامر العمل النشطة تجاوز 80% من الرصيد الحالي
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {reorderAlerts.map(alert => {
                  const critical = alert.consumption_pct >= 100
                  return (
                    <div key={alert.item_code}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs border
                        ${critical
                          ? 'bg-red-50 border-red-200 text-red-800'
                          : 'bg-white border-amber-200 text-amber-800'}`}
                    >
                      <Package size={12} className="shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{alert.item_name}</p>
                        <p className="text-[11px] opacity-75">
                          رصيد: {new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(alert.current_balance)} {alert.unit ?? ''}
                          {' · '}
                          <Wrench size={9} className="inline" />
                          {' '}{alert.active_order_count} أمر عمل
                        </p>
                      </div>
                      <span className={`font-bold shrink-0 ${critical ? 'text-red-700' : 'text-amber-700'}`}>
                        {Math.round(alert.consumption_pct)}%
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
            <button
              onClick={() => setReorderDismissed(true)}
              className="text-amber-400 hover:text-amber-600 transition-colors shrink-0 p-1"
              title="إخفاء"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Warehouse tabs */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveWarehouse(null)}
          className={`btn text-sm ${!activeWarehouse ? 'btn-primary' : 'btn-secondary'}`}
        >
          كل المخازن
        </button>
        {(warehouses ?? []).map(wh => (
          <button
            key={wh}
            onClick={() => setActiveWarehouse(wh)}
            className={`btn text-sm ${activeWarehouse === wh ? 'btn-primary' : 'btn-secondary'}`}
          >
            {wh}
          </button>
        ))}
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : Object.keys(grouped).length === 0 ? (
        <div className="card p-16 text-center text-slate-400">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Package size={32} className="opacity-30" />
          </div>
          <p className="font-medium">لا توجد أرصدة مخزنية</p>
          <p className="text-sm text-slate-300 mt-1">أضف حركة مخزنية لتظهر هنا</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([warehouse, items]) => {
            const isOpen   = expanded.has(warehouse)
            const totalVal = items.reduce((s, i) => s + i.balance_value, 0)
            const totalQty = items.length

            return (
              <div key={warehouse} className="card overflow-hidden">
                {/* Warehouse header */}
                <button
                  onClick={() => toggleExpand(warehouse)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="w-10 h-10 bg-brand-100 rounded-xl flex items-center justify-center text-brand-700">
                    <Package size={20} />
                  </div>
                  <div className="flex-1 text-right">
                    <p className="font-bold text-slate-800">{warehouse}</p>
                    <p className="text-sm text-slate-400">{totalQty} صنف</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-slate-500">إجمالي القيمة</p>
                    <p className="font-bold text-brand-700">{egp(totalVal)}</p>
                  </div>
                  {isOpen ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                </button>

                {/* Items table */}
                {isOpen && (
                  <div className="border-t border-slate-200 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          {['الصنف','الوحدة','الرصيد','قيمة الرصيد', 'إجراءات'].map(h => (
                            <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {items.map(item => (
                          <tr key={item.item_code}
                            className="hover:bg-brand-50 cursor-pointer transition-colors group">
                            <td className="px-4 py-3 font-medium text-slate-700 group-hover:text-brand-700 flex items-center gap-1.5"
                                onClick={() => navigate(`/inventory/item/${item.item_code}`)}>
                              {item.item_name ?? `#${item.item_code}`}
                              <ExternalLink size={12} className="opacity-0 group-hover:opacity-60 transition-opacity text-brand-500" />
                            </td>
                            <td className="px-4 py-3 text-slate-500">{item.unit ?? '—'}</td>
                            <td className="px-4 py-3">
                              <span className={`font-bold ${item.balance_qty > 0 ? 'text-slate-800' : 'text-slate-400'}`}>
                                {num(item.balance_qty)}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-semibold text-brand-700">{egp(item.balance_value)}</td>
                            <td className="px-4 py-3">
                              {canWrite('inventory') && item.balance_qty > 0 && (
                                <button 
                                  className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all border border-indigo-100"
                                  title="تحويل مخزني"
                                  onClick={(e) => { 
                                    e.stopPropagation(); 
                                    navigate(`/inventory/workspace/new?type=TRANSFER_OUT&warehouse=${warehouse}`);
                                  }}
                                >
                                  <ArrowRightLeft size={14} />
                                  <span>تحويل</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                        <tr>
                          <td colSpan={3} className="px-4 py-2.5 text-sm font-semibold text-slate-600 text-left">
                            إجمالي {warehouse}
                          </td>
                          <td colSpan={2} className="px-4 py-2.5 font-bold text-brand-700">{egp(totalVal)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}


    </div>
  )
}
