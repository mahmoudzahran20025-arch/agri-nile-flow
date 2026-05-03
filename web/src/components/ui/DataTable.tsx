import React from 'react';
import { ChevronRight, ChevronLeft, SearchX, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';

export interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (row: T) => React.ReactNode;
  align?: 'right' | 'left' | 'center';
  width?: string;
  minWidth?: string;
  sortable?: boolean;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

interface Props<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  total?: number;
  page?: number;
  pageSize?: number;
  onPage?: (page: number) => void;
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  emptyText?: string;
  emptyIcon?: React.ReactNode;
  sort?: SortState;
  onSort?: (sort: SortState) => void;
}

function getVal<T>(row: T, key: string): React.ReactNode {
  const parts = key.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let v: any = row;
  for (const p of parts) v = v?.[p];
  return v == null ? '—' : String(v);
}

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
  );
}

export default function DataTable<T>({
  columns, data, loading, total = 0, page = 1, pageSize = 50,
  onPage, rowKey, onRowClick, rowClassName, emptyText = 'No data available', emptyIcon,
  sort, onSort,
}: Props<T>) {
  const totalPages = Math.ceil(total / pageSize);

  const handleSort = (key: string) => {
    if (!onSort) return;
    if (sort?.key === key) {
      onSort({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      onSort({ key, dir: 'asc' });
    }
  };

  const startEntry = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endEntry = Math.min(page * pageSize, total);

  return (
    <div className="bg-white rounded border border-slate-200 overflow-hidden shadow-sm flex flex-col h-full">
      <div className="overflow-x-auto flex-1 relative" style={{ WebkitOverflowScrolling: 'touch' }}>
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#f8fafc] border-b border-slate-200">
              {columns.map(col => {
                const isActive = sort?.key === String(col.key);
                const isSortable = col.sortable && !!onSort;
                return (
                  <th
                    key={String(col.key)}
                    style={{ width: col.width, minWidth: col.minWidth }}
                    onClick={isSortable ? () => handleSort(String(col.key)) : undefined}
                    className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap border-b border-slate-200
                      ${col.align === 'left' ? 'text-left' : col.align === 'center' ? 'text-center' : 'text-right'}
                      ${isSortable ? 'cursor-pointer select-none hover:bg-slate-100 transition-colors' : ''}
                      ${isActive ? 'text-[#0F2D5C]' : 'text-slate-500'}`}
                  >
                    <span className={`inline-flex items-center gap-1 ${col.align === 'right' ? 'flex-row-reverse' : ''}`}>
                      {col.header}
                      {isSortable && (
                        isActive
                          ? sort!.dir === 'asc'
                            ? <ArrowUp size={13} className="text-[#1D9E75]" />
                            : <ArrowDown size={13} className="text-[#1D9E75]" />
                          : <ArrowUpDown size={13} className="text-slate-300" />
                      )}
                    </span>
                  </th>
                );
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
                    <div className="w-14 h-14 rounded bg-slate-50 border border-slate-100 flex items-center justify-center">
                      {emptyIcon ?? <SearchX size={24} className="text-slate-300" />}
                    </div>
                    <p className="text-[13px] font-medium">{emptyText}</p>
                  </div>
                </td>
              </tr>
            ) : (
              data.map((row, index) => (
                <tr
                  key={rowKey(row)}
                  data-row-key={rowKey(row)}
                  onClick={() => onRowClick?.(row)}
                  className={`${rowClassName ? rowClassName(row) : (index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50')} hover:bg-slate-100 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
                >
                  {columns.map(col => (
                    <td
                      key={String(col.key)}
                      className={`px-4 py-2.5 text-slate-700 whitespace-nowrap text-[12px]
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
      {onPage && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-white text-[13px]">
          <span className="text-slate-500 font-medium">
            Showing {startEntry} to {endEntry} of {total.toLocaleString('en-US')} entries
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPage(page - 1)}
              disabled={page <= 1}
              className="p-1 rounded hover:bg-slate-100 text-slate-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
              if (p < 1 || p > totalPages) return null;
              return (
                <button
                  key={p}
                  onClick={() => onPage(p)}
                  className={`w-7 h-7 rounded text-[12px] font-semibold transition-colors
                    ${p === page ? 'bg-[#0F2D5C] text-white shadow-sm' : 'hover:bg-slate-100 text-slate-600'}`}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => onPage(page + 1)}
              disabled={page >= totalPages}
              className="p-1 rounded hover:bg-slate-100 text-slate-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
