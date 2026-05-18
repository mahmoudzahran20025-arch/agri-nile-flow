import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, Plus, ExternalLink, FileText, X, Clock } from 'lucide-react'
import { suppliersApi } from '../../api/client'
import { usePermission } from '../../hooks/usePermission'
import { useNewShortcut } from '../../hooks/useNewShortcut'
import DataTableV2, { type ColumnV2 } from '../../components/ui/DataTableV2'
import SidePanel from '../../components/ui/SidePanel'
import AddSupplierModal from '../../components/forms/AddSupplierModal'
import AddSupplierTransactionModal from '../../components/forms/AddSupplierTransactionModal'
import type { Supplier } from '../../types'

function egp(n: number | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}

// ── Filter types ─────────────────────────────────────────────
type StatusFilter  = 'all' | 'active' | 'inactive'
type BalanceFilter = 'all' | 'credit' | 'debit' | 'zero'

// ── Supplier Quick-View Panel ─────────────────────────────────
function SupplierPanel({ supplier, onClose, onNavigate, onAddTransaction }: {
  supplier: Supplier | null
  onClose:  () => void
  onNavigate: (code: number) => void
  onAddTransaction?: (supplier: Supplier) => void
}) {
  if (!supplier) return null
  const balance = supplier.current_balance ?? 0
  return (
    <SidePanel
      open={!!supplier}
      title={supplier.name}
      subtitle={`كود: ${supplier.code}`}
      onClose={onClose}
    >
      <div className="p-5 space-y-5">

        {/* Status + Activity */}
        <div className="flex items-center gap-3">
          <span className={supplier.is_active ? 'badge-green' : 'badge-slate'}>
            {supplier.is_active ? 'نشط' : 'موقوف'}
          </span>
          {supplier.activity && (
            <span className="text-sm text-slate-500">{supplier.activity}</span>
          )}
        </div>

        {/* Balance KPIs */}
        <div className="grid grid-cols-1 gap-3">
          <div className="rounded-xl bg-green-50 border border-green-100 px-4 py-3">
            <p className="text-xs text-green-600 font-medium mb-1">إجمالي الدائن</p>
            <p className="text-lg font-bold text-green-700">{egp(supplier.total_credit)}</p>
          </div>
          <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3">
            <p className="text-xs text-red-600 font-medium mb-1">إجمالي المدين</p>
            <p className="text-lg font-bold text-red-600">{egp(supplier.total_debit)}</p>
          </div>
          <div className={`rounded-xl px-4 py-3 border ${
            balance > 0 ? 'bg-brand-50 border-brand-100' :
            balance < 0 ? 'bg-red-50 border-red-100' :
            'bg-slate-50 border-slate-100'
          }`}>
            <p className="text-xs text-slate-500 font-medium mb-1">الرصيد الحالي</p>
            <p className={`text-xl font-bold ${
              balance > 0 ? 'text-brand-700' : balance < 0 ? 'text-red-600' : 'text-slate-400'
            }`}>
              {egp(balance)}
            </p>
          </div>
        </div>

        {/* Notes */}
        {supplier.notes && (
          <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <FileText size={13} className="text-amber-600" />
              <p className="text-xs font-medium text-amber-700">ملاحظات</p>
            </div>
            <p className="text-sm text-slate-600">{supplier.notes}</p>
          </div>
        )}

        {/* Navigate to full profile */}
        <button
          onClick={() => onNavigate(supplier.code)}
          className="btn-primary w-full gap-2 justify-center"
        >
          <ExternalLink size={15} />
          عرض التفاصيل الكاملة
        </button>

        {onAddTransaction && (
          <button
            onClick={() => onAddTransaction(supplier)}
            className="btn-secondary w-full gap-2 justify-center"
          >
            <Plus size={15} />
            إضافة حركة مالية
          </button>
        )}
      </div>
    </SidePanel>
  )
}

// ── Columns ───────────────────────────────────────────────────
const COLUMNS: ColumnV2<Supplier>[] = [
  { key: 'code',     header: 'الكود',          width: '90px',  sortable: true, csvValue: r => String(r.code) },
  { key: 'name',     header: 'المورد / العميل',                sortable: true, csvValue: r => r.name },
  { key: 'activity', header: 'النشاط',          render: r => r.activity ?? '—', csvValue: r => r.activity ?? '' },
  {
    key: 'total_credit', header: 'إجمالي الدائن', sortable: true,
    render: r => <span className="text-green-700 font-medium">{egp(r.total_credit)}</span>,
    csvValue: r => String(r.total_credit ?? 0),
  },
  {
    key: 'total_debit', header: 'إجمالي المدين', sortable: true,
    render: r => <span className="text-red-600 font-medium">{egp(r.total_debit)}</span>,
    csvValue: r => String(r.total_debit ?? 0),
  },
  {
    key: 'current_balance', header: 'الرصيد الحالي', sortable: true,
    render: r => {
      const b = r.current_balance ?? 0
      return (
        <span className={`font-bold ${b > 0 ? 'text-green-700' : b < 0 ? 'text-red-600' : 'text-slate-400'}`}>
          {egp(b)}
        </span>
      )
    },
    csvValue: r => String(r.current_balance ?? 0),
  },
  {
    key: 'is_active', header: 'الحالة',
    render: r => (
      <span className={r.is_active ? 'badge-green' : 'badge-slate'}>
        {r.is_active ? 'نشط' : 'موقوف'}
      </span>
    ),
    csvValue: r => r.is_active ? 'نشط' : 'موقوف',
  },
]

// ── Page ──────────────────────────────────────────────────────
export default function SupplierListPage() {
  const { canWrite } = usePermission()
  const navigate     = useNavigate()

  const [page,         setPage]         = useState(1)
  const [q,            setQ]            = useState('')
  const [qInput,       setQInput]       = useState('')
  const [addOpen,      setAddOpen]      = useState(false)
  const [txnSupplier,  setTxnSupplier]  = useState<Supplier | null>(null)
  useNewShortcut(() => setAddOpen(true))
  const [selected,     setSelected]     = useState<Supplier | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [balFilter,    setBalFilter]    = useState<BalanceFilter>('all')

  const { data, isLoading, error } = useQuery({
    queryKey: ['suppliers', page, q],
    queryFn:  () => suppliersApi.list({ page, size: 100, q: q || undefined }) as Promise<{
      data: Supplier[]; total: number; page: number; page_size: number; has_more: boolean
      meta?: { draft_count: number; suppliers_with_drafts: number }
    }>,
    staleTime: 30_000,
  })

  const draftMeta = (data as { meta?: { draft_count: number; suppliers_with_drafts: number } } | undefined)?.meta

  useEffect(() => {
    const timer = setTimeout(() => {
      const nextQ = qInput.trim()
      if (nextQ !== q) {
        setQ(nextQ)
        setPage(1)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [qInput, q])


  // ── Client-side filter + sort ──────────────────────────────
  const filtered = useMemo(() => {
    let rows = data?.data ?? []

    if (statusFilter === 'active')   rows = rows.filter(r => r.is_active)
    if (statusFilter === 'inactive') rows = rows.filter(r => !r.is_active)

    if (balFilter === 'credit') rows = rows.filter(r => (r.current_balance ?? 0) > 0)
    if (balFilter === 'debit')  rows = rows.filter(r => (r.current_balance ?? 0) < 0)
    if (balFilter === 'zero')   rows = rows.filter(r => (r.current_balance ?? 0) === 0)

    return rows
  }, [data, statusFilter, balFilter])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setQ(qInput.trim())
    setPage(1)
  }

  const clearFilters = () => {
    setStatusFilter('all')
    setBalFilter('all')
  }

  const hasActiveFilters = statusFilter !== 'all' || balFilter !== 'all'

  const columns = useMemo<ColumnV2<Supplier>[]>(() => {
    if (!canWrite('suppliers')) return COLUMNS
    return [
      ...COLUMNS,
      {
        key: 'actions',
        header: 'إجراء',
        align: 'center',
        width: '120px',
        sortable: false,
        render: (r) => (
          <button
            type="button"
            className="btn-secondary text-xs px-2.5 py-1"
            onClick={(e) => {
              e.stopPropagation()
              setTxnSupplier(r)
            }}
          >
            إضافة قيد
          </button>
        ),
      },
    ]
  }, [canWrite])

  return (
    <div className="space-y-5">
      {canWrite('suppliers') && (
        <div className="flex justify-end">
          <button className="btn-primary gap-2" onClick={() => setAddOpen(true)}>
            <Plus size={16} />
            إضافة مورد
          </button>
        </div>
      )}

      {error && (
        <div className="card bg-red-50 border border-red-200 p-4">
          <p className="text-red-700 font-medium">❌ خطأ في تحميل البيانات</p>
          <p className="text-red-600 text-sm">{String(error)}</p>
        </div>
      )}

      {(draftMeta?.draft_count ?? 0) > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-amber-800 text-xs font-semibold">
          <Clock size={13} className="text-amber-500 shrink-0" />
          يوجد {draftMeta!.draft_count} قيد في المسودة لدى {draftMeta!.suppliers_with_drafts} مورد — لن تؤثر على الأرصدة حتى يتم ترحيلها
        </div>
      )}

      {/* Search + Filters */}
      <div className="card p-4 space-y-3">
        {/* Search bar */}
        <form onSubmit={handleSearch} className="flex gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input pr-9"
              placeholder="بحث بالاسم أو الكود..."
              value={qInput}
              onChange={e => setQInput(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary">بحث</button>
          {q && (
            <button type="button" className="btn-secondary" onClick={() => { setQ(''); setQInput(''); setPage(1) }}>
              مسح
            </button>
          )}
        </form>

        {/* Filter pills */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Status filter */}
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
            {(['all', 'active', 'inactive'] as StatusFilter[]).map(v => (
              <button
                key={v}
                onClick={() => setStatusFilter(v)}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                  statusFilter === v
                    ? 'bg-white shadow text-slate-800'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {v === 'all' ? 'كل الحالات' : v === 'active' ? 'نشط' : 'موقوف'}
              </button>
            ))}
          </div>

          {/* Balance filter */}
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
            {(['all', 'credit', 'debit', 'zero'] as BalanceFilter[]).map(v => (
              <button
                key={v}
                onClick={() => setBalFilter(v)}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                  balFilter === v
                    ? 'bg-white shadow text-slate-800'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {v === 'all' ? 'كل الأرصدة' : v === 'credit' ? 'دائن ↑' : v === 'debit' ? 'مدين ↓' : 'صفر'}
              </button>
            ))}
          </div>

          {/* Clear filters */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg text-red-600 hover:bg-red-50 transition-colors"
            >
              <X size={12} />
              مسح الفلاتر
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-sm text-slate-500">
        <span>{filtered.length.toLocaleString('en-US')} مورد / عميل</span>
        {hasActiveFilters && (
          <span className="text-brand-600 font-medium">— فلتر مفعّل</span>
        )}
      </div>

      <DataTableV2<Supplier>
        columns={columns}
        data={filtered}
        loading={isLoading}
        total={filtered.length}
        page={page}
        pageSize={50}
        onPage={setPage}
        rowKey={r => r.code}
        onRowClick={r => setSelected(r)}
        emptyText="لا يوجد موردين أو عملاء مسجلين"
        searchPlaceholder="بحث في الموردين..."
        exportFilename={`suppliers-${new Date().toISOString().slice(0,10)}.csv`}
      />

      {/* Side panel for quick view */}
      <SupplierPanel
        supplier={selected}
        onClose={() => setSelected(null)}
        onNavigate={code => { setSelected(null); navigate(`/suppliers/${code}`) }}
        onAddTransaction={canWrite('suppliers') ? (supplier) => setTxnSupplier(supplier) : undefined}
      />

      <AddSupplierModal open={addOpen} onClose={() => setAddOpen(false)} />

      <AddSupplierTransactionModal
        open={!!txnSupplier}
        onClose={() => setTxnSupplier(null)}
        supplierCode={txnSupplier?.code ?? 0}
        supplierName={txnSupplier?.name ?? ''}
      />
    </div>
  )
}
