import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Package, ChevronDown, ChevronUp, Plus, Download, ExternalLink } from 'lucide-react'
import { inventoryApi, downloadCsv } from '../../api/client'
import AddInventoryBatchModal from '../../components/forms/AddInventoryBatchModal'
import { TableSkeleton } from '../../components/ui/Skeleton'
import type { InventoryBalance } from '../../types'
import { usePermission } from '../../hooks/usePermission'

function egp(n: number) {
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}
function num(n: number) {
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(n)
}

export default function WarehouseBalancesPage() {
  const { canWrite } = usePermission()
  const navigate     = useNavigate()
  const [activeWarehouse, setActiveWarehouse] = useState<string | null>(null)
  const [expanded,        setExpanded]        = useState<Set<string>>(new Set())
  const [addOpen,         setAddOpen]         = useState(false)

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
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary gap-2"
            onClick={() => downloadCsv('/inventory', 'أرصدة_المخازن')}
          >
            <Download size={16} />تصدير CSV
          </button>
          {canWrite('inventory') && (
            <button className="btn-primary gap-2" onClick={() => setAddOpen(true)}>
              <Plus size={16} />
              حركة جديدة
            </button>
          )}
        </div>
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
                          {['الصنف','الوحدة','الوارد','المنصرف','الرصيد','قيمة الرصيد'].map(h => (
                            <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {items.map(item => (
                          <tr key={item.item_code}
                            className="hover:bg-brand-50 cursor-pointer transition-colors group"
                            onClick={() => navigate(`/inventory/item/${item.item_code}`)}>
                            <td className="px-4 py-3 font-medium text-slate-700 group-hover:text-brand-700 flex items-center gap-1.5">
                              {item.item_name ?? `#${item.item_code}`}
                              <ExternalLink size={12} className="opacity-0 group-hover:opacity-60 transition-opacity text-brand-500" />
                            </td>
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

      <AddInventoryBatchModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        defaultWarehouse={activeWarehouse ?? undefined}
      />
    </div>
  )
}
