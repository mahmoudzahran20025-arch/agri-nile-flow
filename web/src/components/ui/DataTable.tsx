import { ChevronRight, ChevronLeft, Loader2 } from 'lucide-react'

export interface Column<T> {
  key:       keyof T | string
  header:    string
  render?:   (row: T) => React.ReactNode
  align?:    'right' | 'left' | 'center'
  width?:    string
}

interface Props<T> {
  columns:   Column<T>[]
  data:      T[]
  loading?:  boolean
  total?:    number
  page?:     number
  pageSize?: number
  onPage?:   (page: number) => void
  rowKey:    (row: T) => string | number
  onRowClick?: (row: T) => void
  emptyText?: string
}

function getVal<T>(row: T, key: string): React.ReactNode {
  const parts = key.split('.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let v: any = row
  for (const p of parts) v = v?.[p]
  return v == null ? '—' : String(v)
}

export default function DataTable<T>({
  columns, data, loading, total = 0, page = 1, pageSize = 50,
  onPage, rowKey, onRowClick, emptyText = 'لا توجد بيانات',
}: Props<T>) {
  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {columns.map(col => (
                <th
                  key={String(col.key)}
                  style={{ width: col.width }}
                  className={`px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide
                    ${col.align === 'left' ? 'text-left' : col.align === 'center' ? 'text-center' : 'text-right'}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="py-16 text-center text-slate-400">
                  <Loader2 className="animate-spin mx-auto mb-2" size={24} />
                  جاري التحميل...
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-16 text-center text-slate-400">
                  {emptyText}
                </td>
              </tr>
            ) : (
              data.map(row => (
                <tr
                  key={rowKey(row)}
                  onClick={() => onRowClick?.(row)}
                  className={`hover:bg-slate-50 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
                >
                  {columns.map(col => (
                    <td
                      key={String(col.key)}
                      className={`px-4 py-3 text-slate-700
                        ${col.align === 'left' ? 'text-left' : col.align === 'center' ? 'text-center' : 'text-right'}`}
                    >
                      {col.render ? col.render(row) : getVal(row, String(col.key))}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && onPage && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-sm">
          <span className="text-slate-500">
            {total.toLocaleString('ar-EG')} نتيجة — صفحة {page} من {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPage(page - 1)}
              disabled={page <= 1}
              className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight size={16} />
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i
              if (p < 1 || p > totalPages) return null
              return (
                <button
                  key={p}
                  onClick={() => onPage(p)}
                  className={`w-8 h-8 rounded text-xs font-medium transition-colors
                    ${p === page ? 'bg-brand-600 text-white' : 'hover:bg-slate-100 text-slate-600'}`}
                >
                  {p}
                </button>
              )
            })}
            <button
              onClick={() => onPage(page + 1)}
              disabled={page >= totalPages}
              className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
