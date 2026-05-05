import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Download, ShieldCheck, RefreshCw, X,
  TrendingUp, TrendingDown, Wallet, Clock, CheckCircle2, AlertTriangle, Search,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { treasuryApi, glApi, downloadCsv } from '../../api/client'
import { usePermission } from '../../hooks/usePermission'
import DataTable, { type Column, type SortState } from '../../components/ui/DataTable'
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

export default function CashJournalPage() {
  const { canWrite, role } = usePermission()
  const { toast }          = useToast()
  const queryClient        = useQueryClient()

  const [page,      setPage]      = useState(1)
  const [direction, setDirection] = useState('')
  const [status,    setStatus]    = useState('')
  const [month,     setMonth]     = useState('')
  const [year,      setYear]      = useState('')
  const [addOpen,     setAddOpen]     = useState(false)
  const [sort,        setSort]        = useState<SortState | undefined>(undefined)
  const [search,      setSearch]      = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const { data: balance } = useQuery({
    queryKey: ['treasury', 'balance'],
    queryFn:  () => treasuryApi.balance(),
  })

  type Period = { id: number; is_closed: number }
  const { data: periods } = useQuery({
    queryKey: ['gl-periods'],
    queryFn:  glApi.periods as () => Promise<Period[]>,
    staleTime: 300_000,
  })
  const hasOpenPeriod = (periods ?? []).some(p => !p.is_closed)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['treasury', 'txns', page, direction, month, year, status, search],
    queryFn:  () => treasuryApi.list({
      page, size: 100,
      direction: direction || undefined,
      month:  month  ? Number(month)  : undefined,
      year:   year   ? Number(year)   : undefined,
      status: status || undefined,
      search: search.trim() || undefined,
    }) as Promise<{ data: CashTransaction[]; total: number; page: number; page_size: number; has_more: boolean }>,
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
      for (const id of ids) await treasuryApi.post(id)
    },
    onSuccess: () => {
      toast(`تم ترحيل الحركات المحددة بنجاح`, 'success')
      setSelectedIds(new Set())
      queryClient.invalidateQueries({ queryKey: ['treasury'] })
    },
    onError: (err: { message?: string }) => toast(err.message || 'فشل الترحيل الجماعي', 'error'),
  })

  const COLUMNS: Column<CashTransaction>[] = [
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
    { key: 'transaction_date', header: 'التاريخ', width: '110px', sortable: true,
      render: r => <span className="text-xs tabular-nums">{new Date(r.transaction_date).toLocaleDateString('en-US')}</span> },
    {
      key: 'direction', header: 'الاتجاه', width: '85px',
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
      key: 'status', header: 'الحالة', width: '90px',
      render: r => (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
          r.status === 'posted'
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-amber-50 text-amber-700 border-amber-200'
        }`}>
          {r.status === 'posted' ? <CheckCircle2 size={9} /> : <Clock size={9} />}
          {r.status === 'posted' ? 'مُرحّل' : 'مسودة'}
        </span>
      )
    },
    {
      key: 'document_type', header: 'نوع المستند', width: '100px',
      render: r => {
        if (!r.document_type) return <span className="text-slate-300">—</span>
        const cfg: Record<string, string> = {
          'فاتورة':      'bg-blue-50 text-blue-700 border-blue-200',
          'شيك':         'bg-purple-50 text-purple-700 border-purple-200',
          'تحويل بنكي': 'bg-sky-50 text-sky-700 border-sky-200',
          'نقداً':       'bg-emerald-50 text-emerald-700 border-emerald-200',
          'إيصال':       'bg-teal-50 text-teal-700 border-teal-200',
        }
        const cls = cfg[r.document_type] ?? 'bg-slate-50 text-slate-600 border-slate-200'
        return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>{r.document_type}</span>
      },
    },
    { key: 'document_number', header: 'رقم المستند', width: '90px',
      render: r => r.document_number ? <span className="font-mono text-xs text-slate-600">#{r.document_number}</span> : <span className="text-slate-300">—</span> },
    { key: 'recipient_name',  header: 'المستلم / المسلم',
      render: r => r.recipient_name ?? <span className="text-slate-300">—</span> },
    { key: 'narration',       header: 'البيان',
      render: r => <span className="text-slate-700">{r.narration}</span> },
    { key: 'amount', header: 'المبلغ', sortable: true, width: '120px',
      render: r => (
        <span className={`font-bold tabular-nums ${r.direction === 'د' ? 'text-emerald-700' : 'text-red-600'}`}>
          {egp(r.amount)}
        </span>
      )
    },
    {
      key: 'running_balance', header: 'الرصيد التراكمي', width: '130px',
      render: r => {
        if (r.status === 'draft') return <span className="text-slate-300 italic text-[10px]">— مسودة —</span>
        const b = r.running_balance ?? 0
        return (
          <span className={`font-black tabular-nums text-sm ${b >= 0 ? 'text-slate-800' : 'text-red-600'}`}>
            {egp(b)}
          </span>
        )
      },
    },
    {
      key: 'actions', header: '', width: '60px',
      render: r => (
        r.status === 'draft' && (role === 'super_admin' || role === 'company_admin') ? (
          <button
            onClick={() => postMutation.mutate(r.id)}
            disabled={postMutation.isPending}
            className="p-1.5 text-emerald-600 hover:bg-emerald-100 rounded-lg transition-colors"
            title="اعتماد وترحيل"
          >
            <ShieldCheck size={16} />
          </button>
        ) : null
      )
    }
  ]

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

  const bal        = (balance as { balance: number } | null)?.balance
  const allRows    = data?.data ?? []
  const draftCount = allRows.filter(r => r.status === 'draft').length
  const cashIn     = allRows.filter(r => r.direction === 'د' && r.status === 'posted').reduce((s, r) => s + r.amount, 0)
  const cashOut    = allRows.filter(r => r.direction === 'م' && r.status === 'posted').reduce((s, r) => s + r.amount, 0)
  const hasFilters = !!(direction || month || year || status || search.trim())

  const kpis: KpiItem[] = [
    { id: 'balance',  label: 'الرصيد المعتمد', value: bal != null ? egp(bal) : '…',  variant: (bal ?? 0) >= 0 ? 'success' : 'warning' },
    { id: 'in',      label: 'وارد (معروض)',    value: egp(cashIn),                   variant: 'success' },
    { id: 'out',     label: 'منصرف (معروض)',   value: egp(cashOut),                  variant: 'warning' },
    { id: 'drafts',  label: 'مسودات معلقة',   value: `${draftCount} حركة`,          variant: draftCount > 0 ? 'warning' : 'default' },
  ]

  const actions: CommandAction[] = [
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
    ...(selectedIds.size > 0 && (role === 'super_admin' || role === 'company_admin') ? [{
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
            onClick={() => setStatus('draft')}
          >
            عرض المسودات فقط ←
          </button>
        </div>
      )}

      {/* ── Period warning ────────────────────────────── */}
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

      {/* ── Filters ───────────────────────────────────── */}
      <div className="card p-4 bg-slate-50/50">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Status toggle */}
          <div className="flex items-center gap-1 rounded-xl bg-white border border-slate-200 p-1 shadow-sm">
            {[
              { v: '',       l: 'الكل' },
              { v: 'posted', l: '✅ معتمد' },
              { v: 'draft',  l: '📝 مسودة' },
            ].map(({ v, l }) => (
              <button
                key={v}
                onClick={() => { setStatus(v); setPage(1) }}
                className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all ${
                  status === v ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Direction toggle */}
          <div className="flex items-center gap-1 rounded-xl bg-white border border-slate-200 p-1 shadow-sm">
            {[
              { v: '',  l: 'كل الاتجاهات' },
              { v: 'د', l: '↓ وارد' },
              { v: 'م', l: '↑ منصرف' },
            ].map(({ v, l }) => (
              <button
                key={v}
                onClick={() => { setDirection(v); setPage(1) }}
                className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all ${
                  direction === v ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Year */}
          <select
            className="input w-24 text-xs h-8 bg-white border-slate-200"
            value={year}
            onChange={e => { setYear(e.target.value); setPage(1) }}
          >
            <option value="">كل السنوات</option>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          {/* Month */}
          <select
            className="input w-32 text-xs h-8 bg-white border-slate-200"
            value={month}
            onChange={e => { setMonth(e.target.value); setPage(1) }}
          >
            <option value="">كل الشهور</option>
            {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>

          {/* Search */}
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="بحث في البيان أو المستلم..."
              className="input h-8 text-xs pr-7 bg-white border-slate-200 w-full"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
            />
          </div>

          {/* Clear */}
          {hasFilters && (
            <button
              className="flex items-center gap-1 text-xs font-bold text-red-500 hover:bg-red-50 px-2 py-1 rounded-lg transition-colors"
              onClick={() => { setDirection(''); setMonth(''); setYear(''); setStatus(''); setSearch(''); setPage(1) }}
            >
              <X size={12} /> مسح
            </button>
          )}

          <span className="mr-auto text-[11px] font-bold text-slate-400 uppercase tracking-widest">
            {data?.total?.toLocaleString('en-US') ?? '…'} حركة
          </span>
        </div>
      </div>

      {/* ── Data Table ────────────────────────────────── */}
      <SectionCard title="سجل الحركات" icon={<Wallet size={15} />}>
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

      <AddCashTransactionModal open={addOpen} onClose={() => setAddOpen(false)} />
      </div>
    </div>
  )
}
