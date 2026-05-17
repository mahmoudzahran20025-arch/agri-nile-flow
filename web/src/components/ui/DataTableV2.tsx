/**
 * DataTableV2 — TanStack Table v8 powered data grid
 *
 * Drop-in enhancement over DataTable with:
 *   • Global text search (client-side)
 *   • Multi-column client-side sorting (click header, shift+click for multi)
 *   • Column visibility toggle panel
 *   • Optional row grouping by a single column
 *   • Server-side pagination support (pass total + onPage)
 *   • Export to CSV
 *
 * Backward compatible with DataTable column shape: { key, header, render, align, width, sortable }
 */

import { useState, useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getGroupedRowModel,
  getExpandedRowModel,
  flexRender,
  createColumnHelper,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
  type GroupingState,
  type ExpandedState,
} from '@tanstack/react-table'
import {
  ChevronRight, ChevronLeft, SearchX, ArrowUp, ArrowDown, ArrowUpDown,
  Search, SlidersHorizontal, Download, ChevronDown, ChevronRight as ChevronRightIcon,
} from 'lucide-react'

// ── Column definition (compatible with existing DataTable usage) ───────────────

export interface ColumnV2<T> {
  key:       string
  header:    React.ReactNode
  render?:   (row: T) => React.ReactNode
  align?:    'right' | 'left' | 'center'
  width?:    string
  minWidth?: string
  sortable?: boolean
  groupable?: boolean
  hidden?:   boolean            // start hidden in column visibility
  csvValue?: (row: T) => string // custom CSV serializer
}

export interface DataTableV2Props<T> {
  columns:       ColumnV2<T>[]
  data:          T[]
  rowKey:        (row: T) => string | number
  loading?:      boolean
  // Server-side pagination (pass total > data.length to enable)
  total?:        number
  page?:         number
  pageSize?:     number
  onPage?:       (page: number) => void
  // Interaction
  onRowClick?:   (row: T) => void
  rowClassName?: (row: T) => string
  // UX
  emptyText?:    string
  emptyIcon?:    React.ReactNode
  searchPlaceholder?: string
  exportFilename?: string
  // Initial state
  defaultGroupBy?: string
  className?: string
}

// ── CSV export helper ─────────────────────────────────────────────────────────

function toCSV<T>(columns: ColumnV2<T>[], data: T[]): string {
  const header = columns.map(c => `"${String(c.header)}"`).join(',')
  const rows = data.map(row =>
    columns.map(col => {
      const v = col.csvValue ? col.csvValue(row) : col.render
        ? ''  // rendered nodes can't be serialized; caller provides csvValue
        : String((row as Record<string, unknown>)[col.key] ?? '')
      return `"${v.replace(/"/g, '""')}"`
    }).join(',')
  )
  return [header, ...rows].join('\n')
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRows({ cols, rows = 7 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, ri) => (
        <tr key={ri} className="border-b border-slate-100">
          {Array.from({ length: cols }).map((_, ci) => (
            <td key={ci} className="px-4 py-3">
              <div
                className="h-4 rounded animate-pulse bg-slate-200"
                style={{ width: `${45 + (ri * 7 + ci * 13) % 40}%`, animationDelay: `${(ri * cols + ci) * 25}ms` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DataTableV2<T extends object>({
  columns: colDefs,
  data,
  rowKey,
  loading = false,
  total,
  page = 1,
  pageSize = 50,
  onPage,
  onRowClick,
  rowClassName,
  emptyText = 'لا توجد بيانات',
  emptyIcon,
  searchPlaceholder = 'بحث…',
  exportFilename,
  defaultGroupBy,
  className = '',
}: DataTableV2Props<T>) {

  const [globalFilter,    setGlobalFilter]    = useState('')
  const [sorting,         setSorting]         = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    Object.fromEntries(colDefs.filter(c => c.hidden).map(c => [c.key, false]))
  )
  const [grouping,  setGrouping]  = useState<GroupingState>(defaultGroupBy ? [defaultGroupBy] : [])
  const [expanded,  setExpanded]  = useState<ExpandedState>({})
  const [showColPanel, setShowColPanel] = useState(false)

  // ── Build TanStack column definitions ───────────────────────────────────────

  const helper = createColumnHelper<T>()

  const tanColumns = useMemo<ColumnDef<T, unknown>[]>(() =>
    colDefs.map(col =>
      helper.accessor(
        (row) => (row as Record<string, unknown>)[col.key],
        {
          id:     col.key,
          header: () => col.header,
          enableSorting: col.sortable ?? true,
          enableGrouping: col.groupable ?? false,
          cell: (info) => col.render
            ? col.render(info.row.original)
            : (info.getValue() ?? '—') as React.ReactNode,
          size: col.width ? parseInt(col.width) : undefined,
        }
      )
    ),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [colDefs])

  // ── TanStack table instance ─────────────────────────────────────────────────

  const table = useReactTable({
    data,
    columns: tanColumns,
    state: {
      globalFilter,
      sorting,
      columnVisibility,
      grouping,
      expanded,
    },
    onGlobalFilterChange:    setGlobalFilter,
    onSortingChange:         setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onGroupingChange:        setGrouping,
    onExpandedChange:        setExpanded,
    getCoreRowModel:     getCoreRowModel(),
    getSortedRowModel:   getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getGroupedRowModel:  getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    // For server-side pagination: disable auto-pagination
    manualPagination: !!onPage,
  })

  const rows = table.getRowModel().rows

  // ── Pagination math ─────────────────────────────────────────────────────────

  const effectiveTotal = total ?? data.length
  const totalPages     = Math.ceil(effectiveTotal / pageSize)
  const startEntry     = effectiveTotal === 0 ? 0 : (page - 1) * pageSize + 1
  const endEntry       = Math.min(page * pageSize, effectiveTotal)

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleExport = () => {
    const visibleCols = colDefs.filter(c => columnVisibility[c.key] !== false)
    const csvContent  = toCSV(visibleCols, data)
    downloadCSV(csvContent, exportFilename ?? `export-${new Date().toISOString().slice(0,10)}.csv`)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const visibleColCount = colDefs.filter(c => columnVisibility[c.key] !== false).length

  return (
    <div className={`bg-white rounded border border-slate-200 overflow-hidden shadow-sm flex flex-col ${className}`}>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50/60 flex-shrink-0">

        {/* Global search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={globalFilter}
            onChange={e => setGlobalFilter(e.target.value)}
            placeholder={searchPlaceholder}
            dir="rtl"
            className="w-full h-7 pr-7 pl-2 rounded border border-slate-200 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-300 focus:border-blue-300"
          />
          {globalFilter && (
            <button
              onClick={() => setGlobalFilter('')}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
            >
              ×
            </button>
          )}
        </div>

        <div className="flex-1" />

        {/* Export */}
        {exportFilename !== undefined && (
          <button
            onClick={handleExport}
            disabled={loading || data.length === 0}
            className="flex items-center gap-1 h-7 px-2.5 rounded border border-slate-200 text-xs text-slate-600 hover:bg-white hover:shadow-sm transition-all disabled:opacity-40"
          >
            <Download size={12} />
            تصدير
          </button>
        )}

        {/* Column visibility toggle */}
        <div className="relative">
          <button
            onClick={() => setShowColPanel(p => !p)}
            className={`flex items-center gap-1 h-7 px-2.5 rounded border text-xs transition-all
              ${showColPanel
                ? 'bg-[#0F2D5C] text-white border-[#0F2D5C]'
                : 'border-slate-200 text-slate-600 hover:bg-white hover:shadow-sm'}`}
          >
            <SlidersHorizontal size={12} />
            أعمدة
          </button>

          {showColPanel && (
            <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-slate-200 rounded-xl shadow-lg p-3 min-w-[180px]">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">إظهار / إخفاء</p>
              {colDefs.map(col => (
                <label key={col.key} className="flex items-center gap-2 py-1 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={columnVisibility[col.key] !== false}
                    onChange={e => setColumnVisibility(prev => ({ ...prev, [col.key]: e.target.checked }))}
                    className="w-3.5 h-3.5 accent-[#0F2D5C]"
                  />
                  <span className="text-xs text-slate-600 group-hover:text-slate-900">{String(col.header)}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="overflow-auto flex-1 relative" style={{ WebkitOverflowScrolling: 'touch' }}>
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 z-10">
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id} className="bg-[#f8fafc] border-b border-slate-200">
                {hg.headers.map(header => {
                  const colDef = colDefs.find(c => c.key === header.id)
                  const canSort = header.column.getCanSort()
                  const sortDir = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      style={{ width: colDef?.width, minWidth: colDef?.minWidth }}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap border-b border-slate-200
                        ${colDef?.align === 'left' ? 'text-left' : colDef?.align === 'center' ? 'text-center' : 'text-right'}
                        ${canSort ? 'cursor-pointer select-none hover:bg-slate-100 transition-colors' : ''}
                        ${sortDir ? 'text-[#0F2D5C]' : 'text-slate-500'}`}
                    >
                      <span className={`inline-flex items-center gap-1 ${colDef?.align !== 'left' ? 'flex-row-reverse' : ''}`}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && (
                          sortDir === 'asc'  ? <ArrowUp   size={13} className="text-[#1D9E75]" /> :
                          sortDir === 'desc' ? <ArrowDown size={13} className="text-[#1D9E75]" /> :
                                              <ArrowUpDown size={13} className="text-slate-300" />
                        )}
                      </span>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>

          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <SkeletonRows cols={visibleColCount} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={visibleColCount}>
                  <div className="py-16 flex flex-col items-center gap-3 text-slate-400">
                    <div className="w-14 h-14 rounded bg-slate-50 border border-slate-100 flex items-center justify-center">
                      {emptyIcon ?? <SearchX size={24} className="text-slate-300" />}
                    </div>
                    <p className="text-[13px] font-medium">
                      {globalFilter ? `لا نتائج لـ "${globalFilter}"` : emptyText}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                if (row.getIsGrouped()) {
                  return (
                    <tr
                      key={row.id}
                      className="bg-slate-100/80 cursor-pointer hover:bg-slate-100"
                      onClick={row.getToggleExpandedHandler()}
                    >
                      <td colSpan={visibleColCount} className="px-4 py-2 text-xs font-bold text-[#0F2D5C]">
                        <span className="inline-flex items-center gap-1.5">
                          {row.getIsExpanded()
                            ? <ChevronDown size={13} />
                            : <ChevronRightIcon size={13} />}
                          {String(row.groupingValue ?? '—')}
                          <span className="ml-1 text-slate-400 font-normal">({row.subRows.length})</span>
                        </span>
                      </td>
                    </tr>
                  )
                }

                return (
                  <tr
                    key={rowKey(row.original)}
                    onClick={() => onRowClick?.(row.original)}
                    className={`${rowClassName ? rowClassName(row.original) : (index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50')}
                      hover:bg-slate-100 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
                  >
                    {row.getVisibleCells().map(cell => {
                      const colDef = colDefs.find(c => c.key === cell.column.id)
                      return (
                        <td
                          key={cell.id}
                          className={`px-4 py-2.5 text-slate-700 whitespace-nowrap text-[12px]
                            ${colDef?.align === 'left' ? 'text-left' : colDef?.align === 'center' ? 'text-center' : 'text-right'}`}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      )
                    })}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ──────────────────────────────────────────────────────── */}
      {onPage && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-white text-[13px] flex-shrink-0">
          <span className="text-slate-500 font-medium">
            {startEntry}–{endEntry} من {effectiveTotal.toLocaleString('ar-EG')}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPage(page - 1)}
              disabled={page <= 1}
              className="p-1 rounded hover:bg-slate-100 text-slate-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={18} />
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i
              if (p < 1 || p > totalPages) return null
              return (
                <button
                  key={p}
                  onClick={() => onPage(p)}
                  className={`w-7 h-7 rounded text-[12px] font-semibold transition-colors
                    ${p === page ? 'bg-[#0F2D5C] text-white shadow-sm' : 'hover:bg-slate-100 text-slate-600'}`}
                >
                  {p}
                </button>
              )
            })}
            <button
              onClick={() => onPage(page + 1)}
              disabled={page >= totalPages}
              className="p-1 rounded hover:bg-slate-100 text-slate-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
