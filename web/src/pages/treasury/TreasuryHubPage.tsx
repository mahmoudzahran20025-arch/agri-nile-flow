import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import {
  Wallet, ShoppingCart, Plus, RefreshCw, Download,
  TrendingUp, TrendingDown, ShieldCheck, Clock, CheckCircle2,
  AlertTriangle, Search, Users, Tag, Eye, EyeOff, X,
  Send, Truck, Package, ChevronDown, ChevronUp,
  Loader2,
} from 'lucide-react'
import { treasuryApi, glApi, suppliersApi, downloadCsv } from '../../api/client'
import { financeApi, type PurchaseOrder, type POItem } from '../../api/finance'
import type { BankAccount } from '../../api/gl'
import { usePermission } from '../../hooks/usePermission'
import DataTable, { type Column, type SortState } from '../../components/ui/DataTable'
import AddCashTransactionModal from '../../components/forms/AddCashTransactionModal'
import type { CashTransaction } from '../../types'
import { useToast } from '../../contexts/ToastContext'
import { CommandBar } from '../../components/shell/CommandBar'
import { KpiStrip, type KpiItem } from '../../components/ui/KpiStrip'
import SectionCard from '../../components/ui/SectionCard'
import Modal from '../../components/ui/Modal'

// ─── Formatters ────────────────────────────────────────────────
function egp(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}
function fmtNum(n: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0 }).format(n)
}

const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']
const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 4 }, (_, i) => CURRENT_YEAR - 1 + i)

type Tab = 'journal' | 'po'

// ─── Balance anomaly detection ─────────────────────────────────
function isBalanceAnomaly(rows: CashTransaction[], idx: number): boolean {
  if (idx === 0) return false
  const cur  = rows[idx].running_balance ?? 0
  const prev = rows[idx - 1].running_balance ?? 0
  const diff = Math.abs(cur - prev)
  const base = Math.abs(prev) || 1
  return diff / base > 5 || diff > 500_000
}

// ─── PO helpers ────────────────────────────────────────────────
const PO_STATUS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft:     { label: 'مسودة',         color: 'bg-gray-100 text-gray-600',       icon: <ShoppingCart size={11} /> },
  sent:      { label: 'مُرسل',        color: 'bg-blue-100 text-blue-700',       icon: <Send size={11} /> },
  partial:   { label: 'استلام جزئي',  color: 'bg-amber-100 text-amber-700',     icon: <Package size={11} /> },
  received:  { label: 'مستلم كامل',   color: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle2 size={11} /> },
  cancelled: { label: 'ملغي',          color: 'bg-red-100 text-red-600',         icon: <X size={11} /> },
  closed:    { label: 'مغلق',          color: 'bg-slate-100 text-slate-500',     icon: <CheckCircle2 size={11} /> },
}

// ══════════════════════════════════════════════════════════════
// Main Hub
// ══════════════════════════════════════════════════════════════
export default function TreasuryHubPage() {
  const { canWrite, role } = usePermission()
  const queryClient        = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const activeTab = (searchParams.get('tab') as Tab) ?? 'journal'
  const setTab = (t: Tab) => setSearchParams({ tab: t }, { replace: true })

  // ── Shared modal state ──────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false)

  // ── Shared data ─────────────────────────────────────────────
  const { data: accounts = [] } = useQuery({
    queryKey: ['finance', 'bank-accounts'],
    queryFn:  () => glApi.bankAccounts() as Promise<BankAccount[]>,
    staleTime: 300_000,
  })

  const { data: balance } = useQuery({
    queryKey: ['treasury', 'balance'],
    queryFn:  () => treasuryApi.balance(),
  })

  // ── Shared KPIs ─────────────────────────────────────────────
  const totalBalance = (balance as { balance: number } | null)?.balance

  const hubKpis: KpiItem[] = [
    {
      id: 'balance', label: 'رصيد الخزينة الكلي',
      value: totalBalance != null ? egp(totalBalance) : '…',
      variant: (totalBalance ?? 0) >= 0 ? 'success' : 'warning',
      onClick: () => setTab('journal'),
    },
    {
      id: 'po', label: 'طلبات الشراء',
      value: '—',
      variant: 'default',
      onClick: () => setTab('po'),
    },
  ]

  // ── Tab config ──────────────────────────────────────────────
  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'journal', label: 'سجل الخزينة',      icon: <Wallet size={15} /> },
    { id: 'po',      label: 'طلبات الشراء (PO)', icon: <ShoppingCart size={15} /> },
  ]

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      {/* ── Top command bar ───────────────────────────────── */}
      <CommandBar actions={[
        ...(activeTab === 'journal' && canWrite('treasury') ? [{
          id: 'add', label: 'حركة جديدة',
          icon: <Plus size={14} />,
          onClick: () => setAddOpen(true),
          variant: 'primary' as const,
        }] : []),
        {
          id: 'refresh', label: 'تحديث',
          icon: <RefreshCw size={14} />,
          onClick: () => {
            queryClient.invalidateQueries({ queryKey: ['treasury'] })
            queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
          },
          variant: 'secondary' as const,
        },
        ...(activeTab === 'journal' ? [{
          id: 'export', label: 'تصدير CSV',
          icon: <Download size={14} />,
          onClick: () => downloadCsv('/treasury', 'دفتر_اليومية', {}),
          variant: 'secondary' as const,
        }] : []),
      ]} />

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4 animate-fade-in">

        {/* ── Hub KPIs ──────────────────────────────────────── */}
        <KpiStrip items={hubKpis} />

        {/* ── Tabs ─────────────────────────────────────────── */}
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-2xl p-1.5 shadow-sm w-fit">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                activeTab === t.id
                  ? 'bg-[#0F2D5C] text-white shadow-md'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab Content ──────────────────────────────────── */}
        {activeTab === 'journal' && (
          <JournalTab
            accounts={accounts}
            role={role}
          />
        )}

        {activeTab === 'po' && (
          <POTab />
        )}
      </div>

      {/* ── Shared Cash Modal ─────────────────────────────── */}
      <AddCashTransactionModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// Tab 1 — Cash Journal
// ══════════════════════════════════════════════════════════════
function JournalTab({
  accounts, role,
}: {
  accounts: BankAccount[]
  role: string | null
}) {
  const { toast }   = useToast()
  const queryClient = useQueryClient()

  const [page,         setPage]         = useState(1)
  const [direction,    setDirection]    = useState('')
  const [status,       setStatus]       = useState('')
  const [month,        setMonth]        = useState('')
  const [year,         setYear]         = useState('')
  const [sort,         setSort]         = useState<SortState | undefined>(undefined)
  const [search,       setSearch]       = useState('')
  const [selectedIds,  setSelectedIds]  = useState<Set<number>>(new Set())
  const [accountId,    setAccountId]    = useState('')
  const [supplierCode, setSupplierCode] = useState('')
  const [showNotes,    setShowNotes]    = useState(false)

  type SupplierOption = { code: number; name: string }
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-list-dropdown'],
    queryFn:  () => suppliersApi.list({ size: 300 }) as Promise<{ data: SupplierOption[] }>,
    staleTime: 120_000,
    select: res => (res as unknown as { data: SupplierOption[] }).data ?? res,
  })

  type Period = { id: number; is_closed: number }
  const { data: periods } = useQuery({
    queryKey: ['gl-periods'],
    queryFn:  glApi.periods as () => Promise<Period[]>,
    staleTime: 300_000,
  })
  const hasOpenPeriod = (periods ?? []).some(p => !p.is_closed)

  const { data, isLoading } = useQuery({
    queryKey: ['treasury', 'txns', page, direction, month, year, status, search, accountId, supplierCode],
    queryFn:  () => treasuryApi.list({
      page, size: 100,
      direction:     direction     || undefined,
      month:         month         ? Number(month)        : undefined,
      year:          year          ? Number(year)         : undefined,
      status:        status        || undefined,
      search:        search.trim() || undefined,
      account_id:    accountId     ? Number(accountId)    : undefined,
      supplier_code: supplierCode  ? Number(supplierCode) : undefined,
    } as Parameters<typeof treasuryApi.list>[0]) as Promise<{ data: CashTransaction[]; total: number; page: number; page_size: number; has_more: boolean }>,
  })

  const postMutation = useMutation({
    mutationFn: (id: number) => treasuryApi.post(id),
    onSuccess: () => {
      toast('تم ترحيل الحركة واعتمادها بنجاح', 'success')
      queryClient.invalidateQueries({ queryKey: ['treasury'] })
    },
    onError: (err: { message?: string }) => toast(err.message || 'فشل ترحيل الحركة', 'error'),
  })

  const bulkPostMut = useMutation({
    mutationFn: async (ids: number[]) => {
      const results = await Promise.allSettled(ids.map(id => treasuryApi.post(id)))
      const failed = results.filter(r => r.status === 'rejected')
      if (failed.length > 0) {
        const firstErr = (failed[0] as PromiseRejectedResult).reason
        throw Object.assign(
          new Error(firstErr?.message || 'فشل ترحيل بعض الحركات'),
          { failedCount: failed.length, total: ids.length }
        )
      }
    },
    onSuccess: (_data, ids) => {
      toast(`تم ترحيل ${ids.length} حركة بنجاح`, 'success')
      setSelectedIds(new Set())
      queryClient.invalidateQueries({ queryKey: ['treasury'] })
    },
    onError: (err: { message?: string; failedCount?: number; total?: number }) => {
      const msg = err.failedCount != null
        ? `فشل ترحيل ${err.failedCount} من ${err.total} حركة: ${err.message}`
        : err.message || 'فشل الترحيل الجماعي'
      toast(msg, 'error')
      setSelectedIds(new Set())
      queryClient.invalidateQueries({ queryKey: ['treasury'] })
    },
  })

  const sortedData = useMemo(() => {
    const rows = data?.data ?? []
    if (!sort) return rows
    const k = sort.key as keyof CashTransaction
    return [...rows].sort((a, b) => {
      const av = a[k] ?? ''
      const bv = b[k] ?? ''
      const cmp = typeof av === 'string' ? av.localeCompare(String(bv), 'ar') : Number(av) - Number(bv)
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [data, sort])

  const anomalyIds = useMemo(() => {
    const ids = new Set<number>()
    sortedData.forEach((r, i) => { if (isBalanceAnomaly(sortedData, i)) ids.add(r.id) })
    return ids
  }, [sortedData])

  const allRows    = data?.data ?? []
  const draftCount = allRows.filter(r => r.status === 'draft').length
  const cashIn     = allRows.filter(r => r.direction === 'د' && r.status === 'posted').reduce((s, r) => s + r.amount, 0)
  const cashOut    = allRows.filter(r => r.direction === 'م' && r.status === 'posted').reduce((s, r) => s + r.amount, 0)
  const netView    = cashIn - cashOut
  const hasFilters = !!(direction || month || year || status || search.trim() || accountId || supplierCode)

  const COLUMNS: Column<CashTransaction>[] = [
    {
      key: 'id', header: '', width: '36px',
      render: r => r.status === 'draft' ? (
        <input type="checkbox"
          className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 cursor-pointer"
          checked={selectedIds.has(r.id)}
          onChange={e => {
            setSelectedIds(prev => {
              const next = new Set(prev)
              e.target.checked ? next.add(r.id) : next.delete(r.id)
              return next
            })
          }}
          onClick={ev => ev.stopPropagation()}
        />
      ) : <span className="block w-3.5 h-3.5" />,
    },
    {
      key: 'transaction_date', header: 'التاريخ', width: '100px', sortable: true,
      render: r => (
        <span className="text-xs tabular-nums text-slate-600">
          {new Date(r.transaction_date).toLocaleDateString('ar-EG', { day: '2-digit', month: 'short', year: '2-digit' })}
        </span>
      ),
    },
    {
      key: 'direction', header: 'الاتجاه', width: '80px',
      render: r => (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
          r.direction === 'د'
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          {r.direction === 'د' ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
          {r.direction === 'د' ? 'وارد' : 'منصرف'}
        </span>
      ),
    },
    {
      key: 'status', header: 'الحالة', width: '80px',
      render: r => (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
          r.status === 'posted'
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-amber-50 text-amber-700 border-amber-200'
        }`}>
          {r.status === 'posted' ? <CheckCircle2 size={9} /> : <Clock size={9} />}
          {r.status === 'posted' ? 'مُرحّل' : 'مسودة'}
        </span>
      ),
    },
    {
      key: 'document_type', header: 'المستند', width: '95px',
      render: r => {
        if (!r.document_type) return <span className="text-slate-300 text-[10px]">—</span>
        const cfg: Record<string, string> = {
          'فاتورة':      'bg-blue-50 text-blue-700 border-blue-200',
          'شيك':         'bg-purple-50 text-purple-700 border-purple-200',
          'تحويل بنكي': 'bg-sky-50 text-sky-700 border-sky-200',
          'نقداً':       'bg-emerald-50 text-emerald-700 border-emerald-200',
          'إيصال':       'bg-teal-50 text-teal-700 border-teal-200',
        }
        const cls = cfg[r.document_type] ?? 'bg-slate-50 text-slate-600 border-slate-200'
        const num = r.document_number ? ` #${r.document_number}` : ''
        return (
          <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>
            {r.document_type}{num}
          </span>
        )
      },
    },
    {
      key: 'supplier_name', header: 'المورد / الجهة',
      render: r => {
        if (r.supplier_name) return (
          <Link
            to={`/suppliers/${r.supplier_code}`}
            onClick={ev => ev.stopPropagation()}
            className="flex items-center gap-1 text-xs text-indigo-700 hover:text-indigo-900 hover:underline transition-colors"
          >
            <Users size={11} className="shrink-0 text-indigo-400" />
            {r.supplier_name}
          </Link>
        )
        if (r.recipient_name) return <span className="text-xs text-slate-500">{r.recipient_name}</span>
        return <span className="text-slate-300 text-[10px]">—</span>
      },
    },
    {
      key: 'narration', header: 'البيان',
      render: r => (
        <div>
          <span className="text-xs text-slate-700 leading-snug">{r.narration}</span>
          {showNotes && r.notes && (
            <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[200px]" title={r.notes}>
              {r.notes}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'expense_name', header: 'بند المصروف', width: '120px',
      render: r => {
        if (!r.expense_name) return <span className="text-slate-300 text-[10px]">—</span>
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-200 text-[10px] font-medium">
            <Tag size={9} />
            {r.expense_name}
          </span>
        )
      },
    },
    {
      key: 'amount', header: 'المبلغ', sortable: true, width: '120px',
      render: r => (
        <span className={`font-bold tabular-nums text-sm ${r.direction === 'د' ? 'text-emerald-700' : 'text-red-600'}`}>
          {r.direction === 'م' ? '(' : ''}{egp(r.amount)}{r.direction === 'م' ? ')' : ''}
        </span>
      ),
    },
    {
      key: 'running_balance', header: 'الرصيد', width: '130px',
      render: r => {
        if (r.status === 'draft') return <span className="text-slate-300 italic text-[10px]">— مسودة —</span>
        const b       = r.running_balance ?? 0
        const anomaly = anomalyIds.has(r.id)
        return (
          <span className={`font-black tabular-nums text-sm flex items-center gap-1 ${
            anomaly ? 'text-amber-600' : b >= 0 ? 'text-slate-800' : 'text-red-600'
          }`}>
            {egp(b)}
            {anomaly && <span title="قفزة كبيرة في الرصيد"><AlertTriangle size={11} className="text-amber-500" /></span>}
          </span>
        )
      },
    },
    {
      key: 'journal_entry_id', header: 'GL', width: '60px',
      render: r => r.journal_entry_id
        ? (
          <Link
            to={`/gl/entries?id=${r.journal_entry_id}&trace=1`}
            className="inline-flex items-center gap-0.5 text-[10px] font-mono text-indigo-600 hover:text-indigo-900 hover:underline"
            title="عرض القيد المحاسبي"
            onClick={ev => ev.stopPropagation()}
          >
            #{r.journal_entry_id}
          </Link>
        )
        : r.status === 'posted'
          ? <span className="text-[10px] text-red-400 font-bold" title="لم يُنشأ قيد محاسبي">!</span>
          : <span className="text-slate-200">—</span>,
    },
    {
      key: 'actions', header: '', width: '52px',
      render: r => (
        r.status === 'draft' && (role === 'super_admin' || role === 'company_admin' || role === 'accountant') ? (
          <button
            onClick={() => postMutation.mutate(r.id)}
            disabled={postMutation.isPending}
            className="p-1.5 text-emerald-600 hover:bg-emerald-100 rounded-lg transition-colors"
            title="اعتماد وترحيل"
          >
            <ShieldCheck size={15} />
          </button>
        ) : null
      ),
    },
  ]

  return (
    <div className="space-y-3">
      {/* Mini KPIs for journal view */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'وارد (معروض)',  value: egp(cashIn),   color: 'text-emerald-700', border: 'border-emerald-100' },
          { label: 'منصرف (معروض)', value: egp(cashOut),  color: 'text-red-600',     border: 'border-red-100' },
          { label: 'صافي المعروض', value: egp(netView),  color: netView >= 0 ? 'text-emerald-700' : 'text-red-600', border: 'border-slate-200' },
          { label: 'مسودات معلقة', value: `${draftCount} حركة`, color: draftCount > 0 ? 'text-amber-600' : 'text-slate-400', border: draftCount > 0 ? 'border-amber-200' : 'border-slate-200' },
        ].map(k => (
          <div key={k.label} className={`bg-white rounded-xl border ${k.border} px-4 py-3 shadow-sm`}>
            <p className="text-[11px] text-slate-500">{k.label}</p>
            <p className={`text-lg font-bold tabular-nums ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Banners */}
      {draftCount > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-amber-800 text-xs font-semibold">
          <Clock size={13} className="text-amber-500 shrink-0" />
          يوجد {draftCount} حركة في المسودة — لن تؤثر على الرصيد حتى ترحيلها
          <button className="mr-auto text-amber-700 hover:text-amber-900 font-bold text-xs"
            onClick={() => setStatus('draft')}>
            عرض المسودات فقط ←
          </button>
        </div>
      )}

      {periods !== undefined && !hasOpenPeriod && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle size={15} className="text-red-500 shrink-0" />
          <span className="text-sm font-bold text-red-800">لا توجد فترة مالية مفتوحة</span>
          <Link to="/gl/periods" className="mr-auto shrink-0 text-xs font-bold text-red-700 hover:text-red-900 underline">
            إنشاء فترة مالية ←
          </Link>
        </div>
      )}

      {/* Bulk post */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
          <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
          <span className="text-sm font-semibold text-emerald-800">تم تحديد {selectedIds.size} حركة</span>
          <button
            onClick={() => bulkPostMut.mutate([...selectedIds])}
            disabled={bulkPostMut.isPending}
            className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-1.5 font-medium transition-colors disabled:opacity-50 mr-auto"
          >
            <ShieldCheck size={13} />
            {bulkPostMut.isPending ? 'جاري الترحيل...' : `ترحيل ${selectedIds.size} حركة`}
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="card p-3 bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
            {[{ v: '', l: 'الكل' }, { v: 'posted', l: '✅ معتمد' }, { v: 'draft', l: '📝 مسودة' }].map(({ v, l }) => (
              <button key={v} onClick={() => { setStatus(v); }}
                className={`px-3 py-1 text-[11px] font-bold rounded-md transition-all ${
                  status === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {l}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
            {[{ v: '', l: 'الكل' }, { v: 'د', l: '↓ وارد', cls: 'text-emerald-700' }, { v: 'م', l: '↑ منصرف', cls: 'text-red-600' }].map(({ v, l, cls = '' }) => (
              <button key={v} onClick={() => setDirection(v)}
                className={`px-3 py-1 text-[11px] font-bold rounded-md transition-all ${
                  direction === v ? `bg-white shadow-sm ${cls || 'text-slate-900'}` : 'text-slate-500 hover:text-slate-700'}`}>
                {l}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[180px] max-w-sm">
            <Search size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input type="text" placeholder="بحث في البيان أو المورد..."
              className="input h-8 text-xs pr-7 bg-white border-slate-200 w-full"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {hasFilters && (
            <button className="flex items-center gap-1 text-xs font-bold text-red-500 hover:bg-red-50 px-2 py-1 rounded-lg"
              onClick={() => { setDirection(''); setMonth(''); setYear(''); setStatus(''); setSearch(''); setAccountId(''); setSupplierCode('') }}>
              <X size={12} /> مسح الكل
            </button>
          )}
          <button className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-50"
            onClick={() => setShowNotes(v => !v)}>
            {showNotes ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          <span className="mr-auto text-[11px] font-bold text-slate-400 tabular-nums">
            {data?.total?.toLocaleString('en-US') ?? '…'} حركة
          </span>
        </div>
        <div className="flex flex-wrap gap-2 items-center mt-2 pt-2 border-t border-slate-100">
          <select className="input w-24 text-xs h-8 bg-white border-slate-200"
            value={year} onChange={e => setYear(e.target.value)}>
            <option value="">كل السنوات</option>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className="input w-28 text-xs h-8 bg-white border-slate-200"
            value={month} onChange={e => setMonth(e.target.value)}>
            <option value="">كل الشهور</option>
            {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          {accounts.length > 1 && (
            <select className="input w-44 text-xs h-8 bg-white border-slate-200"
              value={accountId} onChange={e => setAccountId(e.target.value)}>
              <option value="">كل الحسابات</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name} — {a.account_name}</option>)}
            </select>
          )}
          <select className="input w-48 text-xs h-8 bg-white border-slate-200"
            value={supplierCode} onChange={e => setSupplierCode(e.target.value)}>
            <option value="">كل الموردين</option>
            {(suppliers as SupplierOption[]).map(s => (
              <option key={s.code} value={s.code}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <SectionCard
        title="سجل حركات الخزينة"
        icon={<Wallet size={15} />}
        action={
          sortedData.some((_, i) => isBalanceAnomaly(sortedData, i)) ? (
            <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              <AlertTriangle size={10} /> يوجد قفزات في الرصيد
            </span>
          ) : undefined
        }
      >
        <DataTable<CashTransaction>
          columns={COLUMNS}
          data={sortedData}
          loading={isLoading}
          total={data?.total ?? 0}
          page={page}
          pageSize={100}
          onPage={setPage}
          rowKey={r => r.id}
          sort={sort}
          onSort={setSort}
          emptyText="لا توجد حركات بالفلاتر المحددة"
        />
      </SectionCard>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// Tab 2 — Purchase Orders
// ══════════════════════════════════════════════════════════════
function POTab() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [filterStatus, setFilterStatus] = useState('')
  const [expandedId,   setExpandedId]   = useState<number | null>(null)
  const [showCreate,   setShowCreate]   = useState(false)
  const [showReceive,  setShowReceive]  = useState<PurchaseOrder | null>(null)
  const [receiveDate,  setReceiveDate]  = useState(new Date().toISOString().slice(0, 10))
  const [receiveItems, setReceiveItems] = useState<Array<{
    po_item_id: number; item_name: string; qty_ordered: number
    qty_received_so_far: number; qty_to_receive: string; warehouse: string
  }>>([])
  const [form, setForm] = useState({
    supplier_code: '' as string, supplier_name: '',
    order_date: new Date().toISOString().slice(0, 10), expected_date: '', notes: '',
  })
  type POFormItem = { item_name: string; unit: string; qty_ordered: string; unit_price: string; center_code: string }
  const EMPTY_ITEM: POFormItem = { item_name: '', unit: 'قطعة', qty_ordered: '1', unit_price: '0', center_code: '' }
  const [formItems, setFormItems] = useState<POFormItem[]>([{ ...EMPTY_ITEM }])

  const { data: poData = [], isLoading } = useQuery({
    queryKey: ['purchase-orders', filterStatus],
    queryFn:  () => financeApi.getPurchaseOrders(filterStatus ? { status: filterStatus } : undefined),
    staleTime: 30_000,
  })

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list-po'],
    queryFn:  () => suppliersApi.list({ size: 200 }),
    staleTime: 120_000,
  })

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['purchase-order', expandedId],
    queryFn:  () => financeApi.getPurchaseOrder(expandedId!),
    enabled:  !!expandedId,
  })

  const createMut = useMutation({
    mutationFn: () => financeApi.createPurchaseOrder({
      supplier_code:  form.supplier_code ? Number(form.supplier_code) : undefined,
      supplier_name:  form.supplier_name || undefined,
      order_date:     form.order_date,
      expected_date:  form.expected_date || undefined,
      notes:          form.notes || undefined,
      items: formItems.filter(i => i.item_name.trim()).map(i => ({
        item_name:   i.item_name,
        unit:        i.unit || undefined,
        qty_ordered: Number(i.qty_ordered) || 1,
        unit_price:  Number(i.unit_price) || 0,
        center_code: i.center_code ? Number(i.center_code) : undefined,
      })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      setShowCreate(false)
      setForm({ supplier_code: '', supplier_name: '', order_date: new Date().toISOString().slice(0, 10), expected_date: '', notes: '' })
      setFormItems([{ ...EMPTY_ITEM }])
      toast('تم إنشاء طلب الشراء بنجاح', 'success')
    },
    onError: (err: { message?: string }) => toast(err.message || 'فشل إنشاء طلب الشراء', 'error'),
  })

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      financeApi.updatePOStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      qc.invalidateQueries({ queryKey: ['purchase-order', expandedId] })
      toast('تم تحديث حالة الطلب', 'success')
    },
    onError: (err: { message?: string }) => toast(err.message || 'فشل تحديث الحالة', 'error'),
  })

  const receiveMut = useMutation({
    mutationFn: ({ poId, received_date, items }: { poId: number; received_date: string; items: Array<{ po_item_id: number; qty_received: number; warehouse: string }> }) =>
      financeApi.receivePO(poId, { received_date, items }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      qc.invalidateQueries({ queryKey: ['purchase-order', expandedId] })
      setShowReceive(null)
      toast('تم تسجيل الاستلام — يمكنك الآن تسجيل الفاتورة', 'success')
    },
    onError: (err: { message?: string }) => toast(err.message || 'فشل تسجيل الاستلام', 'error'),
  })

  function openReceive(po: PurchaseOrder) {
    if (!detail?.items) return
    setReceiveItems(detail.items.map(i => ({
      po_item_id:          i.id,
      item_name:           i.item_name,
      qty_ordered:         i.qty_ordered,
      qty_received_so_far: i.qty_received,
      qty_to_receive:      String(i.qty_ordered - i.qty_received),
      warehouse:           i.warehouse ?? '',
    })))
    setShowReceive(po)
  }

  const orders = poData as PurchaseOrder[]
  const totalAmount = orders.reduce((s, o) => s + o.total_amount, 0)

  const STATUS_FILTERS = [
    { v: '', l: 'الكل' }, { v: 'draft', l: 'مسودة' }, { v: 'sent', l: 'مُرسل' },
    { v: 'partial', l: 'جزئي' }, { v: 'received', l: 'مُستلم' }, { v: 'cancelled', l: 'ملغي' },
  ]

  return (
    <div className="space-y-3">
      {/* PO mini KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'إجمالي الطلبات', value: orders.length, border: 'border-slate-200' },
          { label: 'مسودة / مُرسل',  value: orders.filter(o => ['draft','sent'].includes(o.status)).length, border: 'border-blue-100' },
          { label: 'استلام جزئي',    value: orders.filter(o => o.status === 'partial').length,              border: 'border-amber-100' },
          { label: 'بانتظار فاتورة', value: orders.filter(o => ['partial','received'].includes(o.status)).length, border: 'border-indigo-100' },
        ].map(k => (
          <div key={k.label} className={`bg-white rounded-xl border ${k.border} px-4 py-3 shadow-sm`}>
            <p className="text-[11px] text-slate-500">{k.label}</p>
            <p className="text-lg font-bold text-slate-800 tabular-nums">{k.value}</p>
          </div>
        ))}
      </div>

      <SectionCard title="طلبات الشراء (PO)" icon={<ShoppingCart size={15} />}
        action={
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
            {STATUS_FILTERS.map(({ v, l }) => (
              <button key={v} onClick={() => setFilterStatus(v)}
                className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all ${
                  filterStatus === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                {l}
              </button>
            ))}
          </div>
        }
      >
        {/* Create PO button inside card header area */}
        <div className="flex justify-end mb-3">
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 text-xs bg-[#0F2D5C] hover:bg-[#1a3f7c] text-white rounded-lg px-3 py-1.5 font-medium shadow-sm transition-colors">
            <Plus size={13} /> طلب شراء جديد
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-slate-400" size={32} /></div>
        ) : orders.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <ShoppingCart size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">لا توجد طلبات شراء</p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="divide-y divide-slate-50">
              {orders.map(po => (
                <PORow
                  key={po.id}
                  po={po}
                  expanded={expandedId === po.id}
                  detail={expandedId === po.id ? detail ?? null : null}
                  detailLoading={detailLoading && expandedId === po.id}
                  onToggle={() => setExpandedId(expandedId === po.id ? null : po.id)}
                  onStatus={(status) => statusMut.mutate({ id: po.id, status })}
                  onReceive={() => openReceive(po)}
                  statusPending={statusMut.isPending}
                />
              ))}
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-between text-sm">
              <span className="text-slate-500">{orders.length} طلب</span>
              <span className="font-bold text-slate-800">الإجمالي: {fmtNum(totalAmount)} ج.م</span>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Create PO Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="طلب شراء جديد">
        <div className="space-y-4 p-1 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">المورد</label>
              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500"
                value={form.supplier_code}
                onChange={e => {
                  const sel = (suppliersData?.data as Array<{ code: number; name: string }> ?? []).find(s => String(s.code) === e.target.value)
                  setForm(f => ({ ...f, supplier_code: e.target.value, supplier_name: sel?.name ?? '' }))
                }}>
                <option value="">— اختر المورد —</option>
                {(suppliersData?.data as Array<{ code: number; name: string }> ?? []).map(s => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
                <option value="__other__">مورد آخر (إدخال يدوي)</option>
              </select>
              {form.supplier_code === '__other__' && (
                <input className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500"
                  placeholder="اسم المورد" value={form.supplier_name}
                  onChange={e => setForm(f => ({ ...f, supplier_name: e.target.value }))} />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ الطلب</label>
              <input type="date" value={form.order_date}
                onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ التسليم المتوقع</label>
              <input type="date" value={form.expected_date}
                onChange={e => setForm(f => ({ ...f, expected_date: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500"
                value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">البنود</label>
              <button onClick={() => setFormItems(items => [...items, { ...EMPTY_ITEM }])}
                className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
                <Plus size={12} /> إضافة بند
              </button>
            </div>
            <div className="space-y-1.5">
              {formItems.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-1.5 items-center">
                  <input className="col-span-4 border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-brand-500"
                    placeholder="اسم الصنف" value={item.item_name}
                    onChange={e => setFormItems(items => items.map((it, i) => i === idx ? { ...it, item_name: e.target.value } : it))} />
                  <input className="col-span-2 border border-gray-300 rounded px-2 py-1.5 text-sm"
                    placeholder="وحدة" value={item.unit}
                    onChange={e => setFormItems(items => items.map((it, i) => i === idx ? { ...it, unit: e.target.value } : it))} />
                  <input type="number" min="0.01" step="any"
                    className="col-span-2 border border-gray-300 rounded px-2 py-1.5 text-sm text-center"
                    value={item.qty_ordered}
                    onChange={e => setFormItems(items => items.map((it, i) => i === idx ? { ...it, qty_ordered: e.target.value } : it))} />
                  <input type="number" min="0" step="any"
                    className="col-span-2 border border-gray-300 rounded px-2 py-1.5 text-sm text-center"
                    value={item.unit_price}
                    onChange={e => setFormItems(items => items.map((it, i) => i === idx ? { ...it, unit_price: e.target.value } : it))} />
                  <button onClick={() => setFormItems(items => items.filter((_, i) => i !== idx))}
                    disabled={formItems.length === 1}
                    className="col-span-1 flex justify-center text-gray-300 hover:text-red-400 disabled:opacity-20">
                    <X size={14} />
                  </button>
                  <span className="col-span-1 text-xs text-gray-500 tabular-nums text-left">
                    {fmtNum((Number(item.qty_ordered)||0)*(Number(item.unit_price)||0))}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-end text-sm font-bold text-gray-700">
              الإجمالي: {fmtNum(formItems.reduce((s, i) => s + (Number(i.qty_ordered)||0)*(Number(i.unit_price)||0), 0))} ج.م
            </div>
          </div>
          <div className="flex gap-3 pt-2 sticky bottom-0 bg-white pb-1">
            <button onClick={() => createMut.mutate()}
              disabled={!form.order_date || formItems.every(i => !i.item_name.trim()) || createMut.isPending}
              className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-2">
              {createMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              إنشاء طلب الشراء
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">إلغاء</button>
          </div>
        </div>
      </Modal>

      {/* Receive Modal */}
      {showReceive && (
        <Modal open onClose={() => setShowReceive(null)} title={`استلام — ${showReceive.po_number}`}>
          <div className="space-y-4 p-1">
            <div>
              <label className="text-xs text-gray-500 mb-0.5 block font-medium">تاريخ الاستلام</label>
              <input type="date" className="w-44 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-brand-500"
                value={receiveDate} onChange={e => setReceiveDate(e.target.value)} />
            </div>
            <div className="space-y-3">
              {receiveItems.map((item, idx) => (
                <div key={item.po_item_id} className="border border-gray-100 rounded-xl p-3 space-y-2 bg-gray-50">
                  <p className="text-sm font-medium text-gray-800">{item.item_name}</p>
                  <p className="text-xs text-gray-400">مطلوب: {item.qty_ordered} · مستلم سابقاً: {item.qty_received_so_far}</p>
                  <div className="flex items-center gap-2">
                    <div className="w-28">
                      <label className="text-xs text-gray-500 mb-0.5 block">الكمية</label>
                      <input type="number" min="0" step="any" max={item.qty_ordered - item.qty_received_so_far}
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-center focus:ring-2 focus:ring-brand-500"
                        value={item.qty_to_receive}
                        onChange={e => setReceiveItems(items => items.map((it, i) => i === idx ? { ...it, qty_to_receive: e.target.value } : it))} />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 mb-0.5 block">المخزن</label>
                      <input type="text" placeholder="مثال: مخزن رقم 1"
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-brand-500"
                        value={item.warehouse}
                        onChange={e => setReceiveItems(items => items.map((it, i) => i === idx ? { ...it, warehouse: e.target.value } : it))} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => receiveMut.mutate({
                  poId: showReceive.id,
                  received_date: receiveDate,
                  items: receiveItems.filter(i => Number(i.qty_to_receive) > 0).map(i => ({
                    po_item_id:   i.po_item_id,
                    qty_received: Number(i.qty_to_receive),
                    warehouse:    i.warehouse || 'المخزن الرئيسي',
                  })),
                })}
                disabled={receiveItems.every(i => !Number(i.qty_to_receive)) || receiveMut.isPending}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-2">
                {receiveMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
                تسجيل الاستلام
              </button>
              <button onClick={() => setShowReceive(null)} className="px-4 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">إلغاء</button>
            </div>
          </div>
        </Modal>
      )}

    </div>
  )
}

// ── PO Row ─────────────────────────────────────────────────────
function PORow({
  po, expanded, detail, detailLoading,
  onToggle, onStatus, onReceive, statusPending,
}: {
  po: PurchaseOrder
  expanded: boolean
  detail: (PurchaseOrder & { items: POItem[] }) | null
  detailLoading: boolean
  onToggle: () => void
  onStatus: (status: string) => void
  onReceive: () => void
  statusPending: boolean
}) {
  const s = PO_STATUS[po.status] ?? { label: po.status, color: 'bg-gray-100 text-gray-500', icon: null }
  const canSend    = po.status === 'draft'
  const canReceive = ['sent', 'partial'].includes(po.status)
  const canCancel  = ['draft', 'sent'].includes(po.status)

  return (
    <div>
      <button onClick={onToggle} className="w-full flex items-center gap-4 px-5 py-4 text-right hover:bg-slate-50 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-800">{po.po_number}</span>
            <span className={`inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 font-medium ${s.color}`}>
              {s.icon} {s.label}
            </span>
            {po.supplier_name && <span className="text-sm text-slate-500">{po.supplier_name}</span>}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {po.order_date}
            {po.expected_date && ` · تسليم: ${po.expected_date}`}
            {po.item_count != null && ` · ${po.item_count} صنف`}
          </p>
        </div>
        <div className="text-left shrink-0">
          <p className="font-bold text-slate-800">{fmtNum(po.total_amount)}</p>
          <p className="text-xs text-slate-400">ج.م</p>
        </div>
        {expanded ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
      </button>

      {expanded && (
        <div className="px-5 pb-5 pt-2 bg-slate-50 border-t border-slate-100">
          {detailLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="animate-spin text-slate-400" size={20} /></div>
          ) : (
            <>
              {detail?.items && detail.items.length > 0 && (
                <table className="w-full text-sm mb-4">
                  <thead>
                    <tr className="text-xs text-slate-500 font-medium border-b border-slate-200">
                      <th className="text-right pb-2">الصنف</th>
                      <th className="text-center pb-2">الوحدة</th>
                      <th className="text-center pb-2">مطلوب</th>
                      <th className="text-center pb-2">مستلم</th>
                      <th className="text-left pb-2">إجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detail.items.map(item => {
                      const pct = item.qty_ordered > 0 ? (item.qty_received / item.qty_ordered) * 100 : 0
                      return (
                        <tr key={item.id}>
                          <td className="py-1.5 text-slate-800 font-medium">{item.item_name}</td>
                          <td className="py-1.5 text-center text-slate-500">{item.unit ?? '—'}</td>
                          <td className="py-1.5 text-center">{item.qty_ordered}</td>
                          <td className="py-1.5 text-center">
                            <span className={pct >= 100 ? 'text-emerald-600 font-medium' : pct > 0 ? 'text-amber-600' : 'text-slate-400'}>
                              {item.qty_received}
                            </span>
                          </td>
                          <td className="py-1.5 text-left text-slate-700">{fmtNum(item.total_price)} ج.م</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}

              <div className="flex flex-wrap gap-2 mt-4">
                {canSend && (
                  <button onClick={() => onStatus('sent')} disabled={statusPending}
                    className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50">
                    <Send size={12} /> إرسال للمورد
                  </button>
                )}
                {canReceive && (
                  <button onClick={onReceive}
                    className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-1.5 transition-colors">
                    <Truck size={12} /> تسجيل استلام
                  </button>
                )}
                {canCancel && (
                  <button onClick={() => onStatus('cancelled')} disabled={statusPending}
                    className="flex items-center gap-1.5 text-xs border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg px-3 py-1.5 transition-colors">
                    <X size={12} /> إلغاء الطلب
                  </button>
                )}
                {po.status === 'received' && (
                  <button onClick={() => onStatus('closed')} disabled={statusPending}
                    className="flex items-center gap-1.5 text-xs border border-slate-300 text-slate-600 hover:bg-slate-100 rounded-lg px-3 py-1.5 transition-colors">
                    <CheckCircle2 size={12} /> إغلاق الطلب
                  </button>
                )}
              </div>
              {po.notes && (
                <p className="text-xs text-slate-400 mt-3 border-t border-slate-100 pt-2">ملاحظة: {po.notes}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

