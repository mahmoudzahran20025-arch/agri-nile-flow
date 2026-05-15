import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import {
  ArrowDownCircle, ArrowUpCircle, Download, Filter, X,
  Link2, AlertTriangle,
} from 'lucide-react'
import { inventoryApi, configApi, downloadCsv } from '../../api/client'
import { CommandBar, type CommandAction } from '../../components/shell/CommandBar'
import AddInventoryBatchModal from '../../components/forms/AddInventoryBatchModal'
import DataTableV2, { type ColumnV2 } from '../../components/ui/DataTableV2'


// ─── Types ────────────────────────────────────────────────────────────────────
interface Movement {
  id: number
  movement_date: string
  warehouse: string
  movement_type: string
  item_code: number
  item_name: string | null
  unit: string | null
  quantity: number
  unit_price: number
  qty_in: number
  qty_out: number
  balance_qty: number
  value_in: number
  value_out: number
  balance_value: number
  supplier_name: string | null
  document_number: number | null
  notes: string | null
  season_id: number | null
  field_id: number | null
  field_name: string | null
  work_order_id: number | null
  work_order_name: string | null
  center_code: number | null
  center_name: string | null
  related_movement_id: number | null
  journal_entry_id: number | null
}

// ─── Formatters ───────────────────────────────────────────────────────────────
const EGP = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
const NUM = (n: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)

// ─── Movement type badge ──────────────────────────────────────────────────────
const IN_TYPES = new Set(['GRN', 'TRANSFER_IN', 'RETURN_CUSTOMER', 'ADJUSTMENT_PROFIT', 'PRODUCTION_OUTPUT'])

function TypeBadge({ type }: { type: string }) {
  if (IN_TYPES.has(type)) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
        <ArrowDownCircle size={11} /> إضافة
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
      <ArrowUpCircle size={11} /> صرف
    </span>
  )
}

// ─── GL link indicator ────────────────────────────────────────────────────────
function GlBadge({ entryId }: { entryId: number | null }) {
  if (entryId) {
    return (
      <Link
        to={`/gl/entries`}
        className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
        title={`قيد #${entryId}`}
      >
        <Link2 size={10} /> #{entryId}
      </Link>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200" title="بدون قيد محاسبي">
      <AlertTriangle size={10} /> بدون قيد
    </span>
  )
}

// ─── Filter bar ───────────────────────────────────────────────────────────────
interface Filters {
  type: string
  warehouse: string
  season_id: string
  start: string
  end: string
  unlinked_only: boolean
  negative_only: boolean
}

const EMPTY_FILTERS: Filters = {
  type: '', warehouse: '', season_id: '', start: '', end: new Date().toISOString().slice(0, 10), unlinked_only: false, negative_only: false,
}

export default function InventoryMovementsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [addOpen, setAddOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState<Filters>(() => ({
    type: searchParams.get('type') ?? '',
    warehouse: searchParams.get('warehouse') ?? '',
    season_id: searchParams.get('season_id') ?? '',
    start: searchParams.get('start') ?? EMPTY_FILTERS.start,
    end: searchParams.get('end') ?? EMPTY_FILTERS.end,
    unlinked_only: searchParams.get('unlinked') === '1' || searchParams.get('unlinked_only') === '1',
    negative_only: searchParams.get('negative') === '1' || searchParams.get('negative_only') === '1',
  }))
  const PAGE_SIZE = 100

  // ── Server query (all non-unlinked filters go server-side) ───────────────
  const queryParams = useMemo(() => ({
    page,
    size: PAGE_SIZE,
    ...(filters.type        ? { type:      filters.type }           : {}),
    ...(filters.warehouse   ? { warehouse: filters.warehouse }      : {}),
    ...(filters.season_id   ? { season_id: Number(filters.season_id) } : {}),
    ...(filters.start       ? { start:     filters.start }          : {}),
    ...(filters.end         ? { end:       filters.end }            : {}),
  }), [page, filters])

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'movements', queryParams],
    queryFn:  () => inventoryApi.list(queryParams) as Promise<{ data: Movement[]; total: number; page: number; page_size: number; has_more: boolean }>,
    staleTime: 30_000,
  })

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn:  inventoryApi.warehouses,
  })

  const { data: seasons } = useQuery({
    queryKey: ['seasons'],
    queryFn:  configApi.seasons,
  })

  // ── Client-side unlinked filter (only non-zero value = real GL gap) ──────
  const rows: Movement[] = useMemo(() => {
    const all = (data?.data ?? []) as Movement[]
    return all.filter(r => {
      if (filters.unlinked_only && (r.journal_entry_id || (r.value_in + r.value_out) <= 0)) return false
      if (filters.negative_only && r.balance_qty >= 0) return false
      return true
    })
  }, [data, filters.unlinked_only, filters.negative_only])

  const total = data?.total ?? 0

  const activeFiltersCount = Object.entries(filters).filter(([k, v]) =>
    k !== 'unlinked_only' ? Boolean(v) : v === true
  ).length

  const exportParams = useMemo(() => ({
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.warehouse ? { warehouse: filters.warehouse } : {}),
    ...(filters.season_id ? { season_id: Number(filters.season_id) } : {}),
    ...(filters.start ? { start: filters.start } : {}),
    ...(filters.end ? { end: filters.end } : {}),
  }), [filters.type, filters.warehouse, filters.season_id, filters.start, filters.end])

  // ── Commands ──────────────────────────────────────────────────────────────
  const actions: CommandAction[] = [
    {
      id: 'new',
      label: 'حركة جديدة',
      icon: <ArrowDownCircle size={15} />,
      variant: 'primary',
      onClick: () => setAddOpen(true),
    },
    {
      id: 'filter',
      label: `تصفية${activeFiltersCount ? ` (${activeFiltersCount})` : ''}`,
      icon: <Filter size={15} />,
      variant: filtersOpen ? 'primary' : 'secondary',
      onClick: () => setFiltersOpen(v => !v),
    },
    { id: 'sep1', isSeparator: true, label: '' },
    {
      id: 'export',
      label: exporting ? 'جاري التصدير...' : 'تصدير CSV',
      icon: <Download size={15} />,
      variant: 'secondary',
      disabled: exporting,
      onClick: async () => {
        try {
          setExporting(true)
          await downloadCsv('/inventory/movements', 'inventory_movements', exportParams)
        } finally {
          setExporting(false)
        }
      },
    },
  ]

  function resetFilters() {
    setFilters(EMPTY_FILTERS)
    setPage(1)
  }

  function applyFilter(patch: Partial<Filters>) {
    setFilters(f => ({ ...f, ...patch }))
    setPage(1)
  }

  // ── KPI summary ───────────────────────────────────────────────────────────
  const kpiRows = (data?.data ?? []) as Movement[]
  const totalIn      = kpiRows.reduce((s, r) => s + (r.value_in  ?? 0), 0)
  const totalOut     = kpiRows.reduce((s, r) => s + (r.value_out ?? 0), 0)
  // Zero-value unlinked = expected (no price at entry). Non-zero unlinked = real gap.
  const unlinkedNonZero = kpiRows.filter(r => !r.journal_entry_id && (r.value_in + r.value_out) > 0).length
  const unlinkedZero    = kpiRows.filter(r => !r.journal_entry_id && (r.value_in + r.value_out) === 0).length

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      {/* ── Header ── */}
      <div className="px-6 py-5 bg-white border-b border-slate-200 shrink-0">
        <h1 className="text-[18px] font-bold text-[#0F2D5C]">حركات المخزون</h1>
        <p className="text-[12px] text-slate-500 mt-0.5">
          تتبع جميع حركات الوارد والصادر مع الربط المحاسبي الآلي
        </p>
      </div>

      {/* ── Command bar ── */}
      <CommandBar actions={actions} />

      {/* ── Filter panel ── */}
      {filtersOpen && (
        <div className="bg-white border-b border-slate-200 px-6 py-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 shrink-0">
          {/* Type */}
          <div>
            <label className="text-[11px] text-slate-500 font-medium mb-1 block">النوع</label>
            <select
              className="w-full text-[13px] border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C] outline-none"
              value={filters.type}
              onChange={e => applyFilter({ type: e.target.value })}
            >
              <option value="">الكل</option>
              <option value="GRN">استلام / إضافة (GRN)</option>
              <option value="ISSUE">صرف مخزون (ISSUE)</option>
              <option value="RETURN_SUPPLIER">مرتجع مورد</option>
              <option value="RETURN_CUSTOMER">مرتجع عميل</option>
              <option value="ADJUSTMENT_PROFIT">تسوية — زيادة</option>
              <option value="ADJUSTMENT_LOSS">تسوية — نقص</option>
            </select>
          </div>

          {/* Warehouse */}
          <div>
            <label className="text-[11px] text-slate-500 font-medium mb-1 block">المخزن</label>
            <select
              className="w-full text-[13px] border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C] outline-none"
              value={filters.warehouse}
              onChange={e => applyFilter({ warehouse: e.target.value })}
            >
              <option value="">الكل</option>
              {(warehouses ?? []).map((w: string) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </div>

          {/* Season */}
          <div>
            <label className="text-[11px] text-slate-500 font-medium mb-1 block">الموسم</label>
            <select
              className="w-full text-[13px] border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C] outline-none"
              value={filters.season_id}
              onChange={e => applyFilter({ season_id: e.target.value })}
            >
              <option value="">الكل</option>
              {((seasons as any)?.data ?? seasons ?? []).map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Date from */}
          <div>
            <label className="text-[11px] text-slate-500 font-medium mb-1 block">من تاريخ</label>
            <input
              type="date"
              className="w-full text-[13px] border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C] outline-none"
              value={filters.start}
              onChange={e => applyFilter({ start: e.target.value })}
            />
          </div>

          {/* Date to */}
          <div>
            <label className="text-[11px] text-slate-500 font-medium mb-1 block">إلى تاريخ</label>
            <input
              type="date"
              className="w-full text-[13px] border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C] outline-none"
              value={filters.end}
              onChange={e => applyFilter({ end: e.target.value })}
            />
          </div>

          {/* Unlinked toggle + reset */}
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.unlinked_only}
                onChange={e => applyFilter({ unlinked_only: e.target.checked })}
                className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-[12px] text-slate-600 font-medium">بدون قيد فقط</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.negative_only}
                onChange={e => applyFilter({ negative_only: e.target.checked })}
                className="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
              />
              <span className="text-[12px] text-slate-600 font-medium">أرصدة سالبة فقط</span>
            </label>
            {activeFiltersCount > 0 && (
              <button
                onClick={resetFilters}
                className="flex items-center gap-1 text-[12px] text-slate-500 hover:text-rose-600 transition-colors"
              >
                <X size={12} /> إعادة تعيين
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 py-4 bg-slate-50 border-b border-slate-200 shrink-0">
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm">
          <p className="text-[11px] text-slate-500">إجمالي الحركات</p>
          <p className="text-xl font-bold text-[#0F2D5C] tabular-nums">{total.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border border-emerald-200 px-4 py-3 shadow-sm">
          <p className="text-[11px] text-slate-500">إجمالي الوارد</p>
          <p className="text-xl font-bold text-emerald-700 tabular-nums">{EGP(totalIn)}</p>
        </div>
        <div className="bg-white rounded-xl border border-rose-200 px-4 py-3 shadow-sm">
          <p className="text-[11px] text-slate-500">إجمالي الصادر</p>
          <p className="text-xl font-bold text-rose-700 tabular-nums">{EGP(totalOut)}</p>
        </div>
        <div className={`rounded-xl border px-4 py-3 shadow-sm ${unlinkedNonZero > 0 ? 'bg-red-50 border-red-200' : unlinkedZero > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
          <p className="text-[11px] text-slate-500">بدون قيد محاسبي</p>
          <p className={`text-xl font-bold tabular-nums ${unlinkedNonZero > 0 ? 'text-red-700' : unlinkedZero > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
            {unlinkedNonZero > 0 ? `${unlinkedNonZero} ⚠` : unlinkedZero > 0 ? `${unlinkedZero} (صفرية)` : '✓ 0'}
          </p>
          {unlinkedZero > 0 && unlinkedNonZero === 0 && (
            <p className="text-[10px] text-amber-600 mt-0.5">بسعر صفر — لا قيد مطلوب</p>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {(() => {
          const movCols: ColumnV2<Movement>[] = [
            {
              key: 'movement_date', header: 'التاريخ', sortable: true,
              render: r => <span className="text-slate-700 whitespace-nowrap font-mono text-[12px]">{r.movement_date}</span>,
              csvValue: r => r.movement_date,
            },
            {
              key: 'item_name', header: 'الصنف',
              render: r => (
                <button onClick={() => navigate(`/inventory/item/${r.item_code}`)} className="text-left hover:text-[#0F2D5C] hover:underline transition-colors">
                  <span className="font-medium text-slate-800">{r.item_name ?? `#${r.item_code}`}</span>
                  {r.unit && <span className="text-slate-400 ml-1 text-[11px]">({r.unit})</span>}
                </button>
              ),
              csvValue: r => r.item_name ?? String(r.item_code),
            },
            {
              key: 'movement_type', header: 'النوع', align: 'center',
              render: r => <TypeBadge type={r.movement_type} />,
              csvValue: r => r.movement_type,
            },
            {
              key: 'warehouse', header: 'المخزن', sortable: true,
              render: r => <span className="text-slate-600 whitespace-nowrap">{r.warehouse}</span>,
              csvValue: r => r.warehouse,
            },
            {
              key: 'quantity', header: 'الكمية', align: 'right', sortable: true,
              render: r => (
                <span className={IN_TYPES.has(r.movement_type) ? 'text-emerald-700 font-semibold tabular-nums' : 'text-rose-700 font-semibold tabular-nums'}>
                  {IN_TYPES.has(r.movement_type) ? '+' : '−'}{NUM(r.quantity)}
                </span>
              ),
              csvValue: r => String(r.quantity),
            },
            {
              key: 'value_in', header: 'القيمة', align: 'right', sortable: true,
              render: r => <span className="tabular-nums text-slate-700">{EGP(IN_TYPES.has(r.movement_type) ? r.value_in : r.value_out)}</span>,
              csvValue: r => String(IN_TYPES.has(r.movement_type) ? r.value_in : r.value_out),
            },
            {
              key: 'balance_qty', header: 'الرصيد', align: 'right', sortable: true,
              render: r => <span className={`tabular-nums ${r.balance_qty < 0 ? 'text-red-600 font-bold' : 'text-slate-600'}`}>{NUM(r.balance_qty)}</span>,
              csvValue: r => String(r.balance_qty),
            },
            {
              key: 'center_name', header: 'مركز التكلفة',
              render: r => <span className="text-slate-500 text-[12px]">{r.center_name ?? (r.center_code ? `#${r.center_code}` : <span className="text-slate-300">—</span>)}</span>,
              csvValue: r => r.center_name ?? (r.center_code ? String(r.center_code) : ''),
            },
            {
              key: 'field_name', header: 'الحقل',
              render: r => <span className="text-slate-500 text-[12px]">{r.field_name ?? (r.field_id ? `#${r.field_id}` : <span className="text-slate-300">—</span>)}</span>,
              csvValue: r => r.field_name ?? (r.field_id ? String(r.field_id) : ''),
            },
            {
              key: 'journal_entry_id', header: 'قيد GL', align: 'center',
              render: r => <GlBadge entryId={r.journal_entry_id} />,
              csvValue: r => r.journal_entry_id ? String(r.journal_entry_id) : '',
            },
            {
              key: 'notes', header: 'ملاحظات',
              render: r => <span className="text-slate-400 text-[12px] max-w-[160px] truncate block" title={r.notes ?? ''}>{r.notes ?? <span className="text-slate-200">—</span>}</span>,
              csvValue: r => r.notes ?? '',
            },
          ]
          return (
            <DataTableV2<Movement>
              columns={movCols}
              data={rows}
              rowKey={r => r.id}
              loading={isLoading}
              total={total}
              page={page}
              pageSize={PAGE_SIZE}
              onPage={setPage}
              onRowClick={r => navigate(`/inventory/item/${r.item_code}`)}
              emptyText="لا توجد حركات تطابق معايير البحث"
              exportFilename="inventory_movements"
              searchPlaceholder="بحث في الصنف أو المخزن..."
            />
          )
        })()}
      </div>

      {/* ── Add modal ── */}
      {addOpen && (
        <AddInventoryBatchModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  )
}
