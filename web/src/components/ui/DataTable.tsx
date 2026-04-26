import { ChevronRight, ChevronLeft, SearchX, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'

export interface Column<T> {
  key:       keyof T | string
  header:    string
  render?:   (row: T) => React.ReactNode
  align?:    'right' | 'left' | 'center'
  width?:    string
  minWidth?: string
  sortable?: boolean
}

export interface SortState {
  key: string
  dir: 'asc' | 'desc'
}

interface Props<T> {
  columns:     Column<T>[]
  data:        T[]
  loading?:    boolean
  total?:      number
  page?:       number
  pageSize?:   number
  onPage?:     (page: number) => void
  rowKey:      (row: T) => string | number
  onRowClick?: (row: T) => void
  emptyText?:  string
  emptyIcon?:  React.ReactNode
  sort?:       SortState
  onSort?:     (sort: SortState) => void
}

function getVal<T>(row: T, key: string): React.ReactNode {
  const parts = key.split('.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let v: any = row
  for (const p of parts) v = v?.[p]
  return v == null ? '—' : String(v)
}

// ── Skeleton rows while loading ───────────────────────────────
function SkeletonRows({ cols, rows = 7 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, ri) => (
        <tr key={ri} className="border-b border-slate-100">
          {Array.from({ length: cols }).map((_, ci) => (
            <td key={ci} className="px-4 py-3">
              <div
                className="h-4 rounded animate-pulse bg-slate-200"
                style={{
                  width: ci === 0 ? '60%' : `${50 + Math.random() * 40}%`,
                  animationDelay: `${(ri * cols + ci) * 30}ms`,
                }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

export default function DataTable<T>({
  columns, data, loading, total = 0, page = 1, pageSize = 50,
  onPage, rowKey, onRowClick, emptyText = 'لا توجد بيانات', emptyIcon,
  sort, onSort,
}: Props<T>) {
  const totalPages = Math.ceil(total / pageSize)

  const handleSort = (key: string) => {
    if (!onSort) return
    if (sort?.key === key) {
      onSort({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })
    } else {
      onSort({ key, dir: 'asc' })
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <table className="w-full text-sm" style={{ minWidth: '560px' }}>
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {columns.map(col => {
                const isActive  = sort?.key === String(col.key)
                const isSortable = col.sortable && !!onSort
                return (
                  <th
                    key={String(col.key)}
                    style={{ width: col.width, minWidth: col.minWidth }}
                    onClick={isSortable ? () => handleSort(String(col.key)) : undefined}
                    className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap
                      ${col.align === 'left' ? 'text-left' : col.align === 'center' ? 'text-center' : 'text-right'}
                      ${isSortable ? 'cursor-pointer select-none hover:bg-slate-100 transition-colors' : ''}
                      ${isActive ? 'text-brand-600' : 'text-slate-500'}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.header}
                      {isSortable && (
                        isActive
                          ? sort!.dir === 'asc'
                            ? <ArrowUp size={13} className="text-brand-500" />
                            : <ArrowDown size={13} className="text-brand-500" />
                          : <ArrowUpDown size={13} className="text-slate-300" />
                      )}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <SkeletonRows cols={columns.length} />
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <div className="py-16 flex flex-col items-center gap-3 text-slate-400">
                    <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                      {emptyIcon ?? <SearchX size={24} className="text-slate-300" />}
                    </div>
                    <p className="text-sm font-medium">{emptyText}</p>
                  </div>
                </td>
              </tr>
            ) : (
              data.map(row => (
                <tr
                  key={rowKey(row)}
                  onClick={() => onRowClick?.(row)}
                  className={`hover:bg-slate-50 transition-colors ${onRowClick ? 'cursor-pointer group' : ''}`}
                >
                  {columns.map(col => (
                    <td
                      key={String(col.key)}
                      className={`px-4 py-3 text-slate-700 whitespace-nowrap
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
            {(total ?? 0).toLocaleString('en-US')} نتيجة — صفحة {page} من {totalPages}
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
