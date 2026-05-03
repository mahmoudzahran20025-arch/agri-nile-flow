import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Package, RefreshCw, AlertTriangle, CheckCircle,
  Search, Filter, ChevronLeft, ChevronRight, ExternalLink,
} from 'lucide-react'
import { inventoryApi } from '../../api/client'
import { TableSkeleton } from '../../components/ui/Skeleton'

function egp(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}
function num(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)
}

export default function InventoryBalancesPage() {
  const navigate = useNavigate()

  const [page, setPage]       = useState(1)
  const [size]                = useState(50)
  const [warehouse, setWh]    = useState('')
  const [search, setSearch]   = useState('')
  const [staleOnly, setStale] = useState(false)
  const [searchInput, setSearchInput] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['inventory-balances', page, size, warehouse, search, staleOnly],
    queryFn: () => inventoryApi.balancesList({ page, size, warehouse: warehouse || undefined, search: search || undefined, stale: staleOnly }),
  })

  const rows       = data?.data ?? []
  const pagination = data?.pagination
  const warehouses = data?.warehouses ?? []
  const staleCount = data?.stale_count ?? 0

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setSearch(searchInput)
    setPage(1)
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Package className="w-6 h-6 text-blue-600" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">أرصدة المخزون</h1>
            <p className="text-sm text-gray-500">
              لقطة الرصيد لكل صنف × مخزن — {pagination?.total ?? 0} صف
            </p>
          </div>
        </div>
        {staleCount > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
            <AlertTriangle className="w-4 h-4" />
            {staleCount} صف قديم (is_stale=1)
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="بحث بالاسم أو الكود…"
              className="pl-9 pr-3 py-2 text-sm border rounded-lg w-56"
            />
          </div>
          <button type="submit" className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            بحث
          </button>
          {search && (
            <button type="button" onClick={() => { setSearch(''); setSearchInput(''); setPage(1) }}
              className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50">
              مسح
            </button>
          )}
        </form>

        <select
          value={warehouse}
          onChange={e => { setWh(e.target.value); setPage(1) }}
          className="px-3 py-2 text-sm border rounded-lg"
        >
          <option value="">كل المخازن</option>
          {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
        </select>

        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={staleOnly}
            onChange={e => { setStale(e.target.checked); setPage(1) }}
            className="rounded"
          />
          <Filter className="w-3.5 h-3.5 text-amber-500" />
          الأرصدة القديمة فقط
        </label>
      </div>

      {/* Table */}
      <div className="bg-white border rounded-xl overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={12} cols={8} />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <CheckCircle className="w-10 h-10 mb-3 text-green-400" />
            <p className="text-sm">لا توجد أرصدة تطابق الفلتر</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-right px-4 py-3 font-medium text-gray-600">الصنف</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">الكود</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">المخزن</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">الكمية</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">القيمة</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">متوسط التكلفة</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">IPG / PPG</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(row => (
                <tr
                  key={`${row.item_code}-${row.warehouse}`}
                  className={`hover:bg-gray-50 ${row.is_stale ? 'bg-amber-50/40' : ''}`}
                >
                  <td className="px-4 py-3">
                    <button
                      onClick={() => navigate(`/inventory/item/${row.item_code}`)}
                      className="flex items-center gap-1 text-blue-600 hover:underline font-medium"
                    >
                      {row.item_name ?? '—'}
                      <ExternalLink className="w-3 h-3 opacity-60" />
                    </button>
                    {row.unit && <span className="text-xs text-gray-400 ml-1">{row.unit}</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-500 text-xs">{row.item_code}</td>
                  <td className="px-4 py-3 text-gray-700">{row.warehouse}</td>
                  <td className="px-4 py-3 font-mono">
                    <span className={row.balance_qty < 0 ? 'text-red-600 font-semibold' : ''}>
                      {num(row.balance_qty)}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono">{egp(row.balance_value)}</td>
                  <td className="px-4 py-3 font-mono text-gray-600">
                    {row.balance_qty > 0 ? egp(row.balance_value / row.balance_qty) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      {row.ipg && <span className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded font-mono">{row.ipg}</span>}
                      {row.ppg && <span className="text-xs px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded font-mono">{row.ppg}</span>}
                      {!row.ipg && !row.ppg && <span className="text-xs text-gray-400">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {row.is_stale ? (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded-full">
                        <RefreshCw className="w-3 h-3" />
                        قديم
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">
                        <CheckCircle className="w-3 h-3" />
                        محدّث
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            صفحة {pagination.page} من {pagination.pages} — {pagination.total} صف إجمالي
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(p => Math.min(pagination.pages, p + 1))}
              disabled={page >= pagination.pages}
              className="p-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Stale note */}
      {staleCount > 0 && (
        <p className="text-xs text-amber-600">
          * الأرصدة القديمة (is_stale=1) تعني أن هناك حركة مخزنية جديدة لم تُعاد حسابها بعد. ستُحدَّث تلقائياً عند القراءة التالية.
        </p>
      )}
    </div>
  )
}
