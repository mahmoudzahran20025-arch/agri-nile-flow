/**
 * TransactionHistoryPage — Phase 4 document-level view of inventory movements.
 *
 * Each row = one inventory_transaction (a logical document: GRN, ISSUE, TRANSFER, ADJUSTMENT).
 * Click a row → side drawer reveals the individual movement lines with cost & GL detail.
 *
 * Progressive disclosure rules:
 *   Table (always visible):  date, type, warehouse, doc#, line count, total qty, total value
 *   Drawer (on demand):      per-line item, unit_price, balance_qty, gl_posting_status, journal_entry_id
 */
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, SlidersHorizontal,
  RotateCcw, X, ChevronLeft, ChevronRight, Link2, AlertTriangle,
  FileText, Package, BarChart2,
} from 'lucide-react'
import { inventoryApi } from '../../api/inventory'
import { TableSkeleton } from '../../components/ui/Skeleton'
import { CommandBar, type CommandAction } from '../../components/shell/CommandBar'

// ─── Formatters ───────────────────────────────────────────────────────────────
const EGP = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
const NUM = (n: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)

// ─── Type metadata ────────────────────────────────────────────────────────────
const TX_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  GRN:               { label: 'استلام بضاعة',  color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <ArrowDownCircle size={11} /> },
  ISSUE:             { label: 'صرف مخزون',     color: 'bg-rose-50 text-rose-700 border-rose-200',           icon: <ArrowUpCircle size={11} /> },
  TRANSFER:          { label: 'تحويل مخازن',   color: 'bg-blue-50 text-blue-700 border-blue-200',           icon: <ArrowLeftRight size={11} /> },
  ADJUSTMENT:        { label: 'تسوية جردية',   color: 'bg-amber-50 text-amber-700 border-amber-200',        icon: <SlidersHorizontal size={11} /> },
  RETURN_SUPPLIER:   { label: 'مرتجع مورد',    color: 'bg-purple-50 text-purple-700 border-purple-200',     icon: <RotateCcw size={11} /> },
  RETURN_CUSTOMER:   { label: 'مرتجع عميل',    color: 'bg-teal-50 text-teal-700 border-teal-200',           icon: <RotateCcw size={11} /> },
  ADJUSTMENT_PROFIT: { label: 'تسوية — زيادة', color: 'bg-emerald-50 text-emerald-700 border-emerald-200',  icon: <SlidersHorizontal size={11} /> },
  ADJUSTMENT_LOSS:   { label: 'تسوية — نقص',   color: 'bg-rose-50 text-rose-700 border-rose-200',           icon: <SlidersHorizontal size={11} /> },
}

function TypeBadge({ type }: { type: string }) {
  const meta = TX_META[type] ?? { label: type, color: 'bg-slate-50 text-slate-600 border-slate-200', icon: <FileText size={11} /> }
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${meta.color}`}>
      {meta.icon} {meta.label}
    </span>
  )
}

// ─── GL status badge ──────────────────────────────────────────────────────────
// Improvement 5: entry ID is a drill-through link to /gl/entries?id=X
function GlBadge({ status, entryId }: { status: string | null; entryId: number | null }) {
  if (entryId) {
    return (
      <Link
        to={`/gl/entries?id=${entryId}`}
        onClick={e => e.stopPropagation()}
        className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
      >
        <Link2 size={9} /> #{entryId}
      </Link>
    )
  }
  if (!status || status === 'exempt_zero_value') {
    return <span className="text-[11px] text-slate-300">—</span>
  }
  const isOk = status === 'posted'
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full border ${isOk ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
      {isOk ? null : <AlertTriangle size={9} />} {status}
    </span>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface TxRow {
  id: number; transaction_type: string; document_number: number | null
  movement_date: string; warehouse: string; to_warehouse: string | null
  notes: string | null; status: string
  line_count: number; total_qty: number; total_value: number
  created_by_user_id: string | null; created_at: string
  unposted_lines: number
}
interface TxLine {
  id: number; item_code: number; item_name: string | null; unit: string | null
  warehouse: string; movement_type: string
  quantity: number; unit_price: number | null
  qty_in: number; qty_out: number; balance_qty: number
  value_in: number; value_out: number; balance_value: number
  gl_posting_status: string | null; journal_entry_id: number | null
  movement_date: string; notes: string | null
}

// ─── Side Drawer ──────────────────────────────────────────────────────────────
function TxDrawer({ tx, onClose }: { tx: TxRow; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'transaction', tx.id],
    queryFn:  () => inventoryApi.transactionDetail(tx.id),
    staleTime: 60_000,
  })

  const lines = (data?.lines ?? []) as TxLine[]

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="w-[680px] max-w-full bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-start gap-3 bg-slate-50 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <TypeBadge type={tx.transaction_type} />
              <span className="text-[12px] text-slate-400 font-mono">{tx.movement_date}</span>
              {tx.document_number && (
                <span className="text-[12px] text-slate-500">مستند #{tx.document_number}</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 text-[13px] text-slate-600">
              <span className="font-medium">{tx.warehouse}</span>
              {tx.to_warehouse && (
                <>
                  <ArrowLeftRight size={13} className="text-slate-400" />
                  <span className="font-medium">{tx.to_warehouse}</span>
                </>
              )}
            </div>
            {tx.notes && (
              <p className="text-[12px] text-slate-400 mt-1 truncate">{tx.notes}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-[11px] text-slate-400">القيمة الإجمالية</p>
            <p className="text-[17px] font-bold text-slate-800 tabular-nums">{EGP(tx.total_value)}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{tx.line_count} صنف / {NUM(tx.total_qty)} وحدة</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Lines */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="p-5"><TableSkeleton rows={4} cols={5} /></div>
          ) : lines.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
              لا توجد تفاصيل
            </div>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-right px-4 py-2.5 font-semibold text-slate-500">الصنف</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-slate-500">الكمية</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-slate-500">سعر الوحدة</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-slate-500">القيمة</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-slate-500">الرصيد</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-slate-500">GL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map(l => {
                  const isIn  = l.qty_in > 0
                  const value = isIn ? l.value_in : l.value_out
                  return (
                    <tr key={l.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-800">{l.item_name ?? `#${l.item_code}`}</p>
                        {l.unit && <p className="text-[11px] text-slate-400">{l.unit}</p>}
                        {l.warehouse !== tx.warehouse && (
                          <p className="text-[11px] text-blue-500">{l.warehouse}</p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <span className={isIn ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>
                          {isIn ? '+' : '−'}{NUM(l.quantity)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                        {l.unit_price != null && l.unit_price > 0 ? EGP(l.unit_price) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 font-medium">
                        {value > 0 ? EGP(value) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <span className={l.balance_qty < 0 ? 'text-red-600 font-bold' : 'text-slate-600'}>
                          {NUM(l.balance_qty)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <GlBadge status={l.gl_posting_status} entryId={l.journal_entry_id} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                <tr>
                  <td className="px-4 py-2.5 font-semibold text-slate-700">الإجمالي</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold text-slate-700">{NUM(tx.total_qty)}</td>
                  <td />
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold text-slate-800">{EGP(tx.total_value)}</td>
                  <td /><td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Footer meta */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 text-[11px] text-slate-400 flex gap-4 shrink-0">
          <span>معاملة #{tx.id}</span>
          {tx.created_by_user_id && <span>بواسطة: {tx.created_by_user_id}</span>}
          {tx.created_at && <span>{tx.created_at.slice(0, 16)}</span>}
        </div>
      </div>
    </div>
  )
}

// ─── Filters ──────────────────────────────────────────────────────────────────
interface Filters {
  transaction_type: string; warehouse: string; start: string; end: string
  work_order_id: string  // Improvement 2
  gl_posting_status: string  // I6: GL status filter
}
const EMPTY: Filters = { transaction_type: '', warehouse: '', start: '', end: '', work_order_id: '', gl_posting_status: '' }

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function TransactionHistoryPage() {
  const [page, setPage]         = useState(1)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters]   = useState<Filters>(EMPTY)
  const [selected, setSelected] = useState<TxRow | null>(null)
  const PAGE_SIZE = 50

  const qp = useMemo(() => ({
    page, size: PAGE_SIZE,
    ...(filters.transaction_type  ? { transaction_type:  filters.transaction_type }          : {}),
    ...(filters.warehouse         ? { warehouse:          filters.warehouse }                 : {}),
    ...(filters.start             ? { start:              filters.start }                     : {}),
    ...(filters.end               ? { end:                filters.end }                       : {}),
    ...(filters.work_order_id     ? { work_order_id:      Number(filters.work_order_id) }     : {}),
    ...(filters.gl_posting_status ? { gl_posting_status:  filters.gl_posting_status }         : {}),
  }), [page, filters])

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'transactions', qp],
    queryFn:  () => inventoryApi.transactions(qp),
    staleTime: 30_000,
  })

  const rows = (data?.data ?? []) as TxRow[]
  const total      = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const activeCount = Object.values(filters).filter(Boolean).length

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn:  inventoryApi.warehouses,
    staleTime: 300_000,
  })

  // Improvement 3: summary query — only fetch when at least one filter is active
  const summaryEnabled = activeCount > 0
  const { data: summaryRows } = useQuery({
    queryKey: ['inventory', 'transactions', 'summary', filters],
    queryFn:  () => inventoryApi.transactionsSummary({
      ...(filters.transaction_type  ? { transaction_type:  filters.transaction_type }          : {}),
      ...(filters.warehouse         ? { warehouse:          filters.warehouse }                 : {}),
      ...(filters.start             ? { start:              filters.start }                     : {}),
      ...(filters.end               ? { end:                filters.end }                     : {}),
      ...(filters.work_order_id     ? { work_order_id:      Number(filters.work_order_id) }    : {}),
      ...(filters.gl_posting_status ? { gl_posting_status:  filters.gl_posting_status }        : {}),
    }),
    enabled: summaryEnabled,
    staleTime: 30_000,
  })
  function applyFilter(patch: Partial<Filters>) {
    setFilters(f => ({ ...f, ...patch }))
    setPage(1)
  }

  // KPIs from current page (light — no extra API call)
  const kpiIn  = rows.filter(r => ['GRN','RETURN_CUSTOMER','ADJUSTMENT_PROFIT'].includes(r.transaction_type))
                     .reduce((s, r) => s + r.total_value, 0)
  const kpiOut = rows.filter(r => ['ISSUE','RETURN_SUPPLIER','ADJUSTMENT_LOSS'].includes(r.transaction_type))
                     .reduce((s, r) => s + r.total_value, 0)
  const kpiXfr = rows.filter(r => r.transaction_type === 'TRANSFER').length

  const actions: CommandAction[] = [
    {
      id: 'filter',
      label: `تصفية${activeCount ? ` (${activeCount})` : ''}`,
      icon: <SlidersHorizontal size={15} />,
      variant: filtersOpen ? 'primary' : 'secondary',
      onClick: () => setFiltersOpen(v => !v),
    },
    {
      id: 'unposted',
      label: 'غير مرحلة',
      icon: <AlertTriangle size={14} />,
      variant: filters.gl_posting_status === 'unposted' ? 'primary' : 'secondary',
      onClick: () => {
        applyFilter({ gl_posting_status: filters.gl_posting_status === 'unposted' ? '' : 'unposted' })
      },
    },
    ...(activeCount > 0 ? [{
      id: 'reset',
      label: 'إعادة تعيين',
      icon: <X size={14} />,
      variant: 'secondary' as const,
      onClick: () => { setFilters(EMPTY); setPage(1) },
    }] : []),
  ]

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      {/* Header */}
      <div className="px-6 py-5 bg-white border-b border-slate-200 shrink-0">
        <h1 className="text-[18px] font-bold text-[#0F2D5C]">سجل المعاملات المخزنية</h1>
        <p className="text-[12px] text-slate-500 mt-0.5">
          عرض موثق على مستوى المستند — كل سطر يمثل معاملة كاملة (استلام، صرف، تحويل، تسوية)
        </p>
      </div>

      {/* Command bar */}
      <CommandBar actions={actions} />

      {/* Filter panel */}
      {filtersOpen && (
        <div className="bg-white border-b border-slate-200 px-6 py-4 grid grid-cols-2 md:grid-cols-6 gap-3 shrink-0">
          <div>
            <label className="text-[11px] text-slate-500 font-medium mb-1 block">نوع المعاملة</label>
            <select
              className="w-full text-[13px] border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C] outline-none"
              value={filters.transaction_type}
              onChange={e => applyFilter({ transaction_type: e.target.value })}
            >
              <option value="">الكل</option>
              <option value="GRN">استلام بضاعة (GRN)</option>
              <option value="ISSUE">صرف مخزون (ISSUE)</option>
              <option value="TRANSFER">تحويل مخازن</option>
              <option value="ADJUSTMENT">تسوية جردية</option>
              <option value="RETURN_SUPPLIER">مرتجع مورد</option>
              <option value="RETURN_CUSTOMER">مرتجع عميل</option>
              <option value="ADJUSTMENT_PROFIT">تسوية — زيادة</option>
              <option value="ADJUSTMENT_LOSS">تسوية — نقص</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] text-slate-500 font-medium mb-1 block">المخزن</label>
            <select
              className="w-full text-[13px] border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C] outline-none"
              value={filters.warehouse}
              onChange={e => applyFilter({ warehouse: e.target.value })}
            >
              <option value="">الكل</option>
              {(warehouses ?? []).map((w: string) => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-slate-500 font-medium mb-1 block">من تاريخ</label>
            <input type="date"
              className="w-full text-[13px] border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C] outline-none"
              value={filters.start}
              onChange={e => applyFilter({ start: e.target.value })}
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-500 font-medium mb-1 block">إلى تاريخ</label>
            <input type="date"
              className="w-full text-[13px] border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C] outline-none"
              value={filters.end}
              onChange={e => applyFilter({ end: e.target.value })}
            />
          </div>
          {/* Improvement 2: work-order cost rollup filter */}
          <div>
            <label className="text-[11px] text-slate-500 font-medium mb-1 block">أمر عمل (رقم)</label>
            <input type="number" placeholder="رقم أمر العمل"
              className="w-full text-[13px] border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C] outline-none"
              value={filters.work_order_id}
              onChange={e => applyFilter({ work_order_id: e.target.value })}
            />
          </div>
          {/* I6: GL posting status filter */}
          <div>
            <label className="text-[11px] text-slate-500 font-medium mb-1 block">حالة القيد المحاسبي</label>
            <select
              className="w-full text-[13px] border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C] outline-none"
              value={filters.gl_posting_status}
              onChange={e => applyFilter({ gl_posting_status: e.target.value })}
            >
              <option value="">الكل</option>
              <option value="unposted">غير مرحّلة (Unposted)</option>
              <option value="posted">مرحّلة (Posted)</option>
              <option value="pending">قيد الانتظار (Pending)</option>
              <option value="failed">فشل الترحيل (Failed)</option>
              <option value="outbox_pending">Outbox Pending</option>
              <option value="exempt_zero_value">معفاة (Zero Value)</option>
            </select>
          </div>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-3 px-6 py-4 bg-slate-50 border-b border-slate-200 shrink-0">
        <div className="bg-white rounded-xl border border-emerald-200 px-4 py-3 shadow-sm">
          <p className="text-[11px] text-slate-500">قيمة الواردات (هذه الصفحة)</p>
          <p className="text-lg font-bold text-emerald-700 tabular-nums">{EGP(kpiIn)}</p>
        </div>
        <div className="bg-white rounded-xl border border-rose-200 px-4 py-3 shadow-sm">
          <p className="text-[11px] text-slate-500">قيمة الصادرات (هذه الصفحة)</p>
          <p className="text-lg font-bold text-rose-700 tabular-nums">{EGP(kpiOut)}</p>
        </div>
        <div className="bg-white rounded-xl border border-blue-200 px-4 py-3 shadow-sm">
          <p className="text-[11px] text-slate-500">تحويلات مخازن (هذه الصفحة)</p>
          <p className="text-lg font-bold text-blue-700 tabular-nums">{kpiXfr}</p>
        </div>
      </div>

      {/* Improvement 3: season / period summary breakdown — only shown when filters active */}
      {summaryEnabled && summaryRows && summaryRows.length > 0 && (
        <div className="px-6 py-3 bg-white border-b border-slate-200 shrink-0">
          <p className="text-[11px] font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
            <BarChart2 size={12} /> تفصيل النتائج للفترة المحددة
          </p>
          <div className="flex flex-wrap gap-2">
            {summaryRows.map(s => {
              const isIn = ['GRN','RETURN_CUSTOMER','ADJUSTMENT_PROFIT'].includes(s.transaction_type)
              return (
                <div key={s.transaction_type} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-[12px]">
                  <TypeBadge type={s.transaction_type} />
                  <span className="text-slate-500">{s.doc_count} مستند</span>
                  <span className={`font-semibold tabular-nums ${isIn ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {isIn ? '+' : '−'}{EGP(s.total_value)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {isLoading ? (
          <TableSkeleton rows={10} cols={7} />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
            <Package size={32} strokeWidth={1} />
            <p className="text-sm">لا توجد معاملات تطابق معايير البحث</p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">التاريخ</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">النوع</th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600">GL</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">المخزن</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">مستند</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">الأصناف</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">الكمية</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">القيمة</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">ملاحظات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(row => (
                  <tr
                    key={row.id}
                    className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                    onClick={() => setSelected(row)}
                  >
                    <td className="px-4 py-3 font-mono text-[12px] text-slate-600 whitespace-nowrap">
                      {row.movement_date}
                    </td>
                    <td className="px-4 py-3">
                      <TypeBadge type={row.transaction_type} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.unposted_lines > 0 ? (
                        <span
                          title={`${row.unposted_lines} بند غير مرحّل`}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5"
                        >
                          <AlertTriangle size={9} />{row.unposted_lines}
                        </span>
                      ) : (
                        <span className="text-slate-300 text-[11px]">✓</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                      {row.warehouse}
                      {row.to_warehouse && (
                        <span className="text-slate-400"> → {row.to_warehouse}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-[12px]">
                      {row.document_number ? `#${row.document_number}` : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {row.line_count}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700 font-medium">
                      {NUM(row.total_qty)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">
                      {row.total_value > 0 ? (
                        <span className={['GRN','RETURN_CUSTOMER','ADJUSTMENT_PROFIT'].includes(row.transaction_type) ? 'text-emerald-700' : 'text-rose-700'}>
                          {EGP(row.total_value)}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-[12px] max-w-[180px] truncate">
                      {row.notes ?? <span className="text-slate-200">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 px-1">
            <span className="text-[12px] text-slate-500">
              عرض {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} من {total.toLocaleString()} معاملة
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={16} />
              </button>
              <span className="text-[12px] font-medium text-slate-600 px-2">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selected && <TxDrawer tx={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
