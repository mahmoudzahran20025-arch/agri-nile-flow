import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Package, ChevronDown, ChevronUp } from 'lucide-react'
import { inventoryApi } from '../../api/client'
import type { InventoryBalance } from '../../types'

function egp(n: number) {
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}
function num(n: number) {
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(n)
}

export default function WarehouseBalancesPage() {
  const [activeWarehouse, setActiveWarehouse] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn:  inventoryApi.warehouses,
  })

  const { data: balances, isLoading } = useQuery({
    queryKey: ['inventory', 'balances', activeWarehouse],
    queryFn:  () => inventoryApi.balances(activeWarehouse ?? undefined) as Promise<InventoryBalance[]>,
  })

  // Group by warehouse
  const grouped = (balances ?? []).reduce<Record<string, InventoryBalance[]>>((acc, row) => {
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

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">أرصدة المخازن</h1>
      </div>

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
        <div className="card p-16 text-center text-slate-400">
          <Package size={40} className="mx-auto mb-3 opacity-30 animate-pulse" />
          جاري تحميل أرصدة المخازن...
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="card p-16 text-center text-slate-400">
          <Package size={40} className="mx-auto mb-3 opacity-30" />
          لا توجد أرصدة مخزنية
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
                          {['الصنف','الوحدة','الوارد','المنصرف','الرصيد','قيمة الرصيد'].map(h => (
                            <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {items.map(item => (
                          <tr key={item.item_code} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-medium text-slate-700">{item.item_name ?? `#${item.item_code}`}</td>
                            <td className="px-4 py-3 text-slate-500">{item.unit ?? '—'}</td>
                            <td className="px-4 py-3 text-green-700">{num(item.total_in)}</td>
                            <td className="px-4 py-3 text-red-600">{num(item.total_out)}</td>
                            <td className="px-4 py-3">
                              <span className={`font-bold ${item.balance_qty > 0 ? 'text-slate-800' : 'text-slate-400'}`}>
                                {num(item.balance_qty)}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-semibold text-brand-700">{egp(item.balance_value)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                        <tr>
                          <td colSpan={5} className="px-4 py-2.5 text-sm font-semibold text-slate-600 text-left">
                            إجمالي {warehouse}
                          </td>
                          <td className="px-4 py-2.5 font-bold text-brand-700">{egp(totalVal)}</td>
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
