import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Download, ShieldCheck, RefreshCw, XCircle,
  TrendingUp, TrendingDown, Wallet, Clock, CheckCircle2,
  AlertTriangle, Search, Users, Tag, Eye, EyeOff,
  Calendar, Receipt,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { treasuryApi, glApi, suppliersApi, configApi, downloadCsv } from '../../api/client'
import type { BankAccount } from '../../api/gl'
import { usePermission } from '../../hooks/usePermission'
import DataTableV2, { type ColumnV2 } from '../../components/ui/DataTableV2'
import AddCashTransactionModal from '../../components/forms/AddCashTransactionModal'
import type { CashTransaction } from '../../types'
import { useToast } from '../../contexts/ToastContext'
import { CommandBar, type CommandAction } from '../../components/shell/CommandBar'
import { KpiStrip, type KpiItem } from '../../components/ui/KpiStrip'
import SectionCard from '../../components/ui/SectionCard'

function egp(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}

const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']
const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 4 }, (_, i) => CURRENT_YEAR - 1 + i)

// Detects large jumps in running balance relative to prior row
function isBalanceAnomaly(rows: CashTransaction[], idx: number): boolean {
  if (idx === 0) return false
  const cur  = rows[idx].running_balance ?? 0
  const prev = rows[idx - 1].running_balance ?? 0
  const diff = Math.abs(cur - prev)
  const base = Math.abs(prev) || 1
  // Flag if jump > 5× the previous balance or > 500k EGP absolute
  return diff / base > 5 || diff > 500_000
}

export default function CashJournalPage() {
  const { canWrite, role } = usePermission()
  const { toast }          = useToast()
  const queryClient        = useQueryClient()

  const [page,         setPage]         = useState(1)
  const [direction,    setDirection]    = useState('')
  const [status,       setStatus]       = useState('')
  const [month,        setMonth]        = useState('')
  const [year,         setYear]         = useState('')
  const [addOpen,      setAddOpen]      = useState(false)
  const [search,       setSearch]       = useState('')
  const [selectedIds,  setSelectedIds]  = useState<Set<number>>(new Set())
  const [accountId,    setAccountId]    = useState('')
  const [supplierCode, setSupplierCode] = useState('')
  const [expenseCode,  setExpenseCode]  = useState('')
  const [showNotes,    setShowNotes]    = useState(false)

  const { data: accounts = [] } = useQuery({
    queryKey: ['finance', 'bank-accounts'],
    queryFn:  () => glApi.bankAccounts() as Promise<BankAccount[]>,
    staleTime: 300_000,
  })

  const { data: balance } = useQuery({
    queryKey: ['treasury', 'balance', accountId],
    queryFn:  () => treasuryApi.balance(accountId ? Number(accountId) : undefined),
  })

  type Period = { id: number; is_closed: number }
  const { data: periods } = useQuery({
    queryKey: ['gl-periods'],
    queryFn:  glApi.periods as () => Promise<Period[]>,
    staleTime: 300_000,
  })
  const hasOpenPeriod = (periods ?? []).some(p => !p.is_closed)

  type SupplierOption = { code: number; name: string }
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-list-dropdown'],
    queryFn:  () => suppliersApi.list({ size: 300 }) as Promise<{ data: SupplierOption[] }>,
    staleTime: 120_000,
    select: res => (res as unknown as { data: SupplierOption[] }).data ?? res,
  })

  type ExpenseOption = { code: number; name: string }
  const { data: expenseTypes = [] } = useQuery({
    queryKey: ['config', 'expense_types'],
    queryFn:  configApi.expenseTypes as () => Promise<ExpenseOption[]>,
    staleTime: 120_000,
  })

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['treasury', 'txns', page, direction, month, year, status, search, accountId, supplierCode, expenseCode],
    queryFn:  () => treasuryApi.list({
      page, size: 100,
      direction:     direction     || undefined,
      month:         month         ? Number(month)        : undefined,
      year:          year          ? Number(year)         : undefined,
      status:        status        || undefined,
      search:        search.trim() || undefined,
      account_id:    accountId     ? Number(accountId)    : undefined,
      supplier_code: supplierCode  ? Number(supplierCode) : undefined,
      expense_code:  expenseCode   ? Number(expenseCode)  : undefined,
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

  const allRows = useMemo(() => data?.data ?? [], [data])

  const anomalyIds = useMemo(() => {
    const ids = new Set<number>()
    allRows.forEach((r, i) => { if (isBalanceAnomaly(allRows, i)) ids.add(r.id) })
    return ids
  }, [allRows])

  const COLUMNS: ColumnV2<CashTransaction>[] = [
    {
      key: 'id', header: '', width: '36px',
      render: r => r.status === 'draft' ? (
        <input
          type="checkbox"
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
          <span className="flex items-center gap-1 text-xs text-slate-700">
            <Users size={11} className="text-slate-400 shrink-0" />
            {r.supplier_name}
          </span>
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
            {anomaly && (
              <span title="قفزة كبيرة في الرصيد — تحقق من الحركة">
                <AlertTriangle size={11} className="text-amber-500" />
              </span>
            )}
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

  const bal        = (balance as { balance: number } | null)?.balance
  const draftCount = allRows.filter(r => r.status === 'draft').length
  const cashIn     = allRows.filter(r => r.direction === 'د' && r.status === 'posted').reduce((s, r) => s + r.amount, 0)
  const cashOut    = allRows.filter(r => r.direction === 'م' && r.status === 'posted').reduce((s, r) => s + r.amount, 0)
  const netView    = cashIn - cashOut
  const hasFilters = !!(direction || month || year || status || search.trim() || accountId || supplierCode || expenseCode)

  const selectedAccount = accounts.find(a => String(a.id) === accountId)
  const balanceLabel    = selectedAccount
    ? `رصيد: ${selectedAccount.account_name}`
    : 'الرصيد الإجمالي'

  const kpis: KpiItem[] = [
    { id: 'balance', label: balanceLabel,    value: bal != null ? egp(bal) : '…',  variant: (bal ?? 0) >= 0 ? 'success' : 'warning' },
    { id: 'in',      label: 'وارد (معروض)',  value: egp(cashIn),                   variant: 'success' },
    { id: 'out',     label: 'منصرف (معروض)', value: egp(cashOut),                  variant: 'warning' },
    { id: 'net',     label: 'صافي المعروض',  value: egp(netView),                  variant: netView >= 0 ? 'success' : 'warning' },
    { id: 'drafts',  label: 'مسودات معلقة', value: `${draftCount} حركة`,           variant: draftCount > 0 ? 'warning' : 'default' },
  ]

  const actions: CommandAction[] = [
    {
      id: 'notes-toggle',
      label: showNotes ? 'إخفاء الملاحظات' : 'عرض الملاحظات',
      icon: showNotes ? <EyeOff size={14} /> : <Eye size={14} />,
      onClick: () => setShowNotes(v => !v),
      variant: 'secondary',
    },
    {
      id: 'refresh', label: isLoading ? 'Loading…' : 'تحديث',
      icon: <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />,
      onClick: () => refetch(), variant: 'secondary',
    },
    {
      id: 'export', label: 'تصدير CSV',
      icon: <Download size={14} />,
      onClick: () => downloadCsv('/treasury', 'دفتر_اليومية', {
        year:  year  ? Number(year)  : undefined,
        month: month ? Number(month) : undefined,
      }),
      variant: 'secondary',
    },
    ...(selectedIds.size > 0 && (role === 'super_admin' || role === 'company_admin' || role === 'accountant') ? [{
      id: 'bulk-post', label: bulkPostMut.isPending ? 'جاري الترحيل...' : `ترحيل ${selectedIds.size} حركة`,
      icon: <ShieldCheck size={14} />,
      onClick: () => bulkPostMut.mutate([...selectedIds]),
      variant: 'primary' as const,
    }] : []),
    ...(canWrite('treasury') ? [{
      id: 'add', label: 'حركة جديدة',
      icon: <Plus size={14} />,
      onClick: () => setAddOpen(true),
      variant: 'primary' as const,
    }] : []),
  ]

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <CommandBar actions={actions} />
      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4 animate-fade-in">

        <KpiStrip items={kpis} />

        {/* Draft alert banner */}
        {draftCount > 0 && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-amber-800 text-xs font-semibold">
            <Clock size={13} className="text-amber-500 shrink-0" />
            يوجد {draftCount} حركة في المسودة — لن تؤثر على الرصيد الفعلي حتى يتم ترحيلها
            <button
              className="mr-auto text-amber-700 hover:text-amber-900 font-bold text-xs"
              onClick={() => { setStatus('draft'); setPage(1) }}
            >
              عرض المسودات فقط ←
            </button>
          </div>
        )}

        {/* Period warning */}
        {periods !== undefined && !hasOpenPeriod && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <AlertTriangle size={15} className="text-red-500 shrink-0" />
            <div>
              <span className="text-sm font-bold text-red-800">لا توجد فترة مالية مفتوحة</span>
              <span className="text-xs font-normal text-red-700 mr-2">— لن تُرحّل أي حركة إلى دفتر الأستاذ حتى تُنشئ فترة مفتوحة</span>
            </div>
            <Link to="/gl/periods" className="mr-auto shrink-0 text-xs font-bold text-red-700 hover:text-red-900 underline underline-offset-2 whitespace-nowrap">
              إنشاء فترة مالية ←
            </Link>
          </div>
        )}

        {/* ── Unified Filter Bar ── */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 lg:p-5 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center gap-4">
            {/* Search - Main Focus */}
            <div className="relative flex-1 group">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-brand-500 transition-colors" />
              <input
                type="text"
                placeholder="بحث في البيان، رقم المستند، اسم المورد أو المستلم..."
                className="w-full h-11 pl-11 pr-4 bg-slate-50 border border-slate-100 focus:bg-white focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all rounded-xl text-sm outline-none"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>

            {/* Quick Status Toggles */}
            <div className="flex flex-wrap items-center gap-1.5 bg-slate-100/80 p-1 rounded-xl self-start max-w-full">
              <div className="flex items-center">
                {[
                  { v: '', l: 'الكل' },
                  { v: 'posted', l: 'معتمد' },
                  { v: 'draft', l: 'مسودة' },
                ].map(it => (
                  <button
                    key={it.v}
                    onClick={() => { setStatus(it.v); setPage(1); }}
                    className={`px-4 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                      status === it.v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {it.l}
                  </button>
                ))}
              </div>
              <div className="hidden sm:block w-[1px] h-4 bg-slate-300 mx-1" />
              <div className="flex flex-wrap items-center">
                {[
                  { v: '', l: 'الكل' },
                  { v: 'د', l: 'وارد', c: 'text-emerald-600' },
                  { v: 'م', l: 'منصرف', c: 'text-red-600' },
                ].map(it => (
                  <button
                    key={it.v}
                    onClick={() => { setDirection(it.v); setPage(1); }}
                    className={`px-4 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                      direction === it.v ? `bg-white shadow-sm ${it.c || 'text-slate-900'}` : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {it.l}
                  </button>
                ))}
              </div>
            </div>

            {hasFilters && (
              <button
                onClick={() => {
                  setDirection(''); setMonth(''); setYear(''); setStatus(''); setSearch('');
                  setAccountId(''); setSupplierCode(''); setExpenseCode(''); setPage(1);
                }}
                className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold text-red-500 hover:bg-red-50 rounded-lg transition-colors lg:ml-2"
              >
                <XCircle size={14} /> مسح الكل
              </button>
            )}
          </div>

          {/* Advanced Dropdowns Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pt-4 border-t border-slate-100">
            <div className="space-y-1.5 min-w-0">
              <label className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-wider mr-1 truncate">
                <Calendar size={12} className="shrink-0" /> السنة
              </label>
              <select className="w-full h-10 px-3 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:bg-white focus:border-brand-500 transition-all outline-none truncate"
                value={year} onChange={e => { setYear(e.target.value); setPage(1); }}>
                <option value="">كل السنوات</option>
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="space-y-1.5 min-w-0">
              <label className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-wider mr-1 truncate">
                <Calendar size={12} className="shrink-0" /> الشهر
              </label>
              <select className="w-full h-10 px-3 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:bg-white focus:border-brand-500 transition-all outline-none truncate"
                value={month} onChange={e => { setMonth(e.target.value); setPage(1); }}>
                <option value="">كل الشهور</option>
                {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div className="space-y-1.5 min-w-0">
              <label className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-wider mr-1 truncate">
                <Wallet size={12} className="shrink-0" /> الخزينة / البنك
              </label>
              <select className="w-full h-10 px-3 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:bg-white focus:border-brand-500 transition-all outline-none truncate"
                value={accountId} onChange={e => { setAccountId(e.target.value); setPage(1); }}>
                <option value="">كل الحسابات</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name} — {a.account_name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5 min-w-0">
              <label className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-wider mr-1 truncate">
                <Users size={12} className="shrink-0" /> المورد / العميل
              </label>
              <select className="w-full h-10 px-3 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:bg-white focus:border-brand-500 transition-all outline-none truncate"
                value={supplierCode} onChange={e => { setSupplierCode(e.target.value); setPage(1); }}>
                <option value="">كل الموردين</option>
                {(suppliers as SupplierOption[]).map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5 min-w-0">
              <label className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-wider mr-1 truncate">
                <Receipt size={12} className="shrink-0" /> بند المصروف
              </label>
              <select className="w-full h-10 px-3 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:bg-white focus:border-brand-500 transition-all outline-none truncate"
                value={expenseCode} onChange={e => { setExpenseCode(e.target.value); setPage(1); }}>
                <option value="">كل البنود</option>
                {expenseTypes.map(et => <option key={et.code} value={et.code}>{et.name}</option>)}
              </select>
            </div>
          </div>
        </div>


        {/* ── Table ── */}
        <SectionCard
          title="سجل حركات الخزينة"
          icon={<Wallet size={15} />}
          action={
            allRows.some((_, i) => isBalanceAnomaly(allRows, i)) ? (
              <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                <AlertTriangle size={10} /> يوجد قفزات في الرصيد
              </span>
            ) : undefined
          }
        >
          <DataTableV2<CashTransaction>
            columns={COLUMNS}
            data={allRows}
            loading={isLoading}
            total={data?.total ?? 0}
            page={page}
            pageSize={100}
            onPage={setPage}
            rowKey={r => r.id}
            emptyText="لا توجد حركات بالفلاتر المحددة"
            exportFilename="دفتر_اليومية"
          />
        </SectionCard>

        <AddCashTransactionModal open={addOpen} onClose={() => setAddOpen(false)} />
      </div>
    </div>
  )
}
