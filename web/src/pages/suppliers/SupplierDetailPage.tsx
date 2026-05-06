import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight, FileText, Plus, Filter, BarChart3, ShieldCheck,
  CreditCard, TrendingDown, Wallet, BookOpen, AlertTriangle,
  CheckCircle2, Clock, Edit3, Download, Trash2, Link2,
} from 'lucide-react'
import { suppliersApi, reportsApi, configApi, downloadCsv } from '../../api/client'
import { usePermission } from '../../hooks/usePermission'
import DataTable, { type Column } from '../../components/ui/DataTable'
import AddSupplierTransactionModal from '../../components/forms/AddSupplierTransactionModal'
import EditSupplierModal from '../../components/forms/EditSupplierModal'
import type { Supplier, SupplierTransaction } from '../../types'
import { useToast } from '../../contexts/ToastContext'

const MONTH_NAMES = ['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

type TabId = 'statement' | 'analysis'

function egp(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}

// ── Odoo-Style Smart Button ───────────────────────────────────
function SmartButton({ icon, label, value, color, onClick, pulse }: {
  icon: React.ReactNode
  label: string
  value: string | number
  color: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'slate'
  onClick?: () => void
  pulse?: boolean
}) {
  const colorMap = {
    blue:   'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-300',
    green:  'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300',
    amber:  'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-300',
    red:    'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:border-red-300',
    purple: 'border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 hover:border-purple-300',
    slate:  'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:border-slate-300',
  }
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center gap-0.5 px-4 py-2.5 rounded-xl border text-center transition-all duration-200 min-w-[80px] ${
        onClick ? 'cursor-pointer' : 'cursor-default'
      } ${colorMap[color]}`}
    >
      {pulse && (
        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
      )}
      <span className="text-xl">{icon}</span>
      <span className="text-lg font-black tabular-nums leading-none">{value}</span>
      <span className="text-[10px] font-semibold leading-tight">{label}</span>
    </button>
  )
}

// ── Status Badge ──────────────────────────────────────────────
function SupplierStatusBadge({ isActive }: { isActive: number | undefined }) {
  if (isActive) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
        <CheckCircle2 size={11} /> نشط
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-500 border border-slate-200">
      <Clock size={11} /> موقوف
    </span>
  )
}

export default function SupplierDetailPage() {
  const { canWrite } = usePermission()
  const { code }         = useParams<{ code: string }>()
  const navigate         = useNavigate()
  const [searchParams]   = useSearchParams()
  const { toast }        = useToast()
  const queryClient      = useQueryClient()
  const [page,        setPage]       = useState(1)
  const [addOpen,     setAddOpen]    = useState(false)
  const [editOpen,    setEditOpen]   = useState(false)
  const [tab,         setTab]        = useState<TabId>('statement')
  const [seasonId,    setSeasonId]   = useState<number | undefined>(undefined)
  const [filterMonth, setFilterMonth]= useState<number | undefined>(undefined)
  const highlightId = searchParams.get('highlight') ? Number(searchParams.get('highlight')) : null
  const tableRef    = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!highlightId) return
    const timer = setTimeout(() => {
      const el = tableRef.current?.querySelector(`[data-row-key="${highlightId}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 400)
    return () => clearTimeout(timer)
  }, [highlightId])

  const { data: seasons } = useQuery({
    queryKey: ['seasons'],
    queryFn:  configApi.seasons,
  })

  const { data: supplier } = useQuery({
    queryKey: ['supplier', code],
    queryFn:  () => suppliersApi.get(Number(code)) as Promise<Supplier>,
    enabled:  !!code,
  })

  // ── Smart Button Data ──────────────────────────────────────
  const { data: summary } = useQuery({
    queryKey: ['supplier-summary', code],
    queryFn:  () => suppliersApi.summary(Number(code)),
    enabled:  !!code,
    staleTime: 30_000,
  })

  const { data: txns, isLoading } = useQuery({
    queryKey: ['supplier-statement', code, page, seasonId, filterMonth],
    queryFn:  () => suppliersApi.statement(Number(code), {
      page, size: 100,
      ...(seasonId    ? { season_id: seasonId }  : {}),
      ...(filterMonth ? { month: filterMonth }   : {}),
    }) as Promise<{
      data: SupplierTransaction[]; total: number; page: number; page_size: number; has_more: boolean
    }>,
    enabled: !!code,
  })

  const postMutation = useMutation({
    mutationFn: (id: number) => suppliersApi.postTransaction(Number(code), id),
    onSuccess: () => {
      toast('تم ترحيل الفاتورة واعتمادها بنجاح', 'success')
      queryClient.invalidateQueries({ queryKey: ['supplier-statement', code] })
      queryClient.invalidateQueries({ queryKey: ['supplier', code] })
      queryClient.invalidateQueries({ queryKey: ['supplier-summary', code] })
    },
    onError: (err: { message?: string }) => toast(err.message || 'فشل ترحيل الحركة', 'error')
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => suppliersApi.deleteTransaction(Number(code), id),
    onSuccess: () => {
      toast('تم حذف المسودة بنجاح', 'success')
      queryClient.invalidateQueries({ queryKey: ['supplier-statement', code] })
      queryClient.invalidateQueries({ queryKey: ['supplier-summary', code] })
    },
    onError: (err: { message?: string }) => toast(err.message || 'فشل حذف الحركة', 'error')
  })

  const TXNS_COLS: Column<SupplierTransaction>[] = [
    { key: 'transaction_date', header: 'التاريخ', width: '100px',
      render: r => new Date(r.transaction_date).toLocaleDateString('en-US') },
    {
      key: 'status', header: 'الحالة', width: '85px',
      render: r => (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
          r.status === 'posted'
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-amber-50 text-amber-700 border-amber-200'
        }`}>
          {r.status === 'posted' ? <><CheckCircle2 size={9} /> مرحّل</> : <><Clock size={9} /> مسودة</>}
        </span>
      )
    },
    {
      key: 'document_type', header: 'النوع', width: '105px',
      render: r => {
        const dtype = r.document_type
        if (!dtype) return <span className="text-slate-300 text-xs">—</span>
        const cfg: Record<string, string> = {
          'فاتورة':      'bg-blue-50 text-blue-700 border-blue-200',
          'أمر شراء':   'bg-indigo-50 text-indigo-700 border-indigo-200',
          'شيك':         'bg-purple-50 text-purple-700 border-purple-200',
          'تحويل بنكي': 'bg-sky-50 text-sky-700 border-sky-200',
          'نقداً':       'bg-emerald-50 text-emerald-700 border-emerald-200',
          'إيصال':       'bg-teal-50 text-teal-700 border-teal-200',
        }
        const cls = cfg[dtype] ?? 'bg-slate-50 text-slate-600 border-slate-200'
        return (
          <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold border ${cls}`}>
            {dtype}
          </span>
        )
      }
    },
    { key: 'document_number',  header: 'رقم',      width: '65px',  render: r => r.document_number ?? '—' },
    { key: 'expense_category', header: 'الخدمة',                   render: r => r.expense_category ?? '—' },
    { key: 'amount', header: 'القيمة', width: '110px',
      render: r => <span className="font-semibold tabular-nums">{egp(r.amount)}</span> },
    {
      key: 'journal_entry_id', header: 'القيد اليومية', width: '115px', align: 'center',
      render: r => (
        r.journal_entry_id ? (
          <a
            href={`/gl/entries?id=${r.journal_entry_id}&trace=1`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold hover:bg-emerald-100 transition-colors"
          >
            <span className="font-mono">{r.journal_entry_id}</span>
            <Link2 size={9} className="opacity-60" />
          </a>
        ) : (
          <span className="text-slate-300 text-[11px]">—</span>
        )
      )
    },
    { key: 'credit', header: 'دائن ↑', width: '110px',
      render: r => r.credit ? <span className="text-amber-700 font-semibold tabular-nums">{egp(r.credit)}</span> : <span className="text-slate-200">—</span> },
    { key: 'debit',  header: 'مدين ↓', width: '110px',
      render: r => r.debit ? <span className="text-blue-700 font-semibold tabular-nums">{egp(r.debit)}</span> : <span className="text-slate-200">—</span> },
    { key: 'balance_with_checks', header: 'الرصيد', width: '120px',
      render: r => {
        if (r.status === 'draft') return <span className="text-slate-300 italic text-[10px]">بانتظار الترحيل</span>
        const b = r.balance_with_checks ?? 0
        return <span className={`font-bold tabular-nums ${b > 0 ? 'text-amber-700' : b < 0 ? 'text-green-700' : 'text-slate-400'}`}>{egp(b)}</span>
      }
    },
    {
      key: 'actions', header: '', width: '80px',
      render: r => (
        r.status === 'draft' && canWrite('suppliers') ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => postMutation.mutate(r.id)}
              disabled={postMutation.isPending}
              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
              title="اعتماد وترحيل"
            >
              <ShieldCheck size={16} />
            </button>
            <button
              onClick={() => {
                if (window.confirm('هل تريد حذف هذه المسودة؟ لا يمكن التراجع عن هذا الإجراء.')) {
                  deleteMutation.mutate(r.id)
                }
              }}
              disabled={deleteMutation.isPending}
              className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition-colors"
              title="حذف المسودة"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ) : null
      )
    }
  ]

  const { data: analysis, isLoading: analysisLoading } = useQuery({
    queryKey: ['supplier-analysis', code, seasonId],
    queryFn:  () => reportsApi.supplierPayments({ supplier_code: Number(code), season_id: seasonId }),
    enabled:  !!code && tab === 'analysis',
  })

  const allTxns = txns?.data ?? []

  // Center breakdown from analysis
  const centerMap = new Map<number | null, { name: string | null; credit: number; debit: number }>()
  if (analysis?.data) {
    for (const t of analysis.data as SupplierTransaction[]) {
      const k = (t as unknown as Record<string, number | null>)['center_code'] as number | null
      const n = (t as unknown as Record<string, string | null>)['center_name'] as string | null
      const existing = centerMap.get(k) ?? { name: n, credit: 0, debit: 0 }
      existing.credit += t.credit ?? 0
      existing.debit  += t.debit  ?? 0
      centerMap.set(k, existing)
    }
  }

  const openBalance = summary?.open_balance ?? (supplier?.current_balance ?? 0)
  const hasDrafts   = (summary?.draft_count ?? 0) > 0
  const glApBalance = (summary?.gl_credit ?? 0) - (summary?.gl_debit ?? 0)
  const apGap = Math.round((openBalance - glApBalance) * 100) / 100
  const isApInSync = Math.abs(apGap) < 0.01

  return (
    <div className="space-y-0 animate-fade-in">

      {/* ── Odoo-Style Page Header ─────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
          <button
            onClick={() => navigate('/suppliers')}
            className="hover:text-slate-700 transition-colors font-medium"
          >
            الموردين والعملاء
          </button>
          <ArrowRight size={12} className="rotate-180 text-slate-300" />
          <span className="font-semibold text-slate-600">{supplier?.name ?? '…'}</span>
        </div>

        {/* Main header row */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-black text-lg shadow-lg shadow-blue-100 shrink-0">
              {supplier?.name?.charAt(0) ?? '؟'}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl font-black text-slate-900">{supplier?.name ?? '…'}</h1>
                <SupplierStatusBadge isActive={supplier?.is_active} />
              </div>
              <p className="text-sm text-slate-500">
                <span className="font-mono font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded-md text-xs mr-1">{code}</span>
                {supplier?.activity ? ` · ${supplier.activity}` : ''}
                {supplier?.notes ? ` · ${supplier.notes}` : ''}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {canWrite('suppliers') && (
              <button
                className="btn-secondary gap-2 text-xs"
                onClick={() => setEditOpen(true)}
              >
                <Edit3 size={13} /> تعديل المورد
              </button>
            )}
            <button
              className="btn-secondary gap-2 text-xs"
              onClick={() => downloadCsv(`/suppliers/${code}/statement`, `كشف_حساب_${code}`)}
            >
              <Download size={13} /> تصدير CSV
            </button>
            {canWrite('suppliers') && (
              <button
                className="btn-primary gap-2 shadow-lg shadow-blue-100"
                onClick={() => setAddOpen(true)}
              >
                <Plus size={15} /> إضافة قيد مالي
              </button>
            )}
          </div>
        </div>

        {/* ── Smart Buttons (Odoo-style) ──────────────────── */}
        <div className="flex items-center gap-3 mt-5 flex-wrap">
          <SmartButton
            icon={<FileText size={18} />}
            label="فاتورة / قيد"
            value={summary?.invoices_count ?? 0}
            color="blue"
            onClick={() => setTab('statement')}
          />
          <SmartButton
            icon={<AlertTriangle size={18} />}
            label="مسودات"
            value={summary?.draft_count ?? 0}
            color={hasDrafts ? 'amber' : 'slate'}
            onClick={() => setTab('statement')}
            pulse={hasDrafts}
          />
          <SmartButton
            icon={<CreditCard size={18} />}
            label="دفعة نقدية"
            value={summary?.payments_count ?? 0}
            color="green"
            onClick={() => navigate(`/treasury?supplier=${code}`)}
          />
          <SmartButton
            icon={<TrendingDown size={18} />}
            label="إجمالي الفواتير"
            value={egp(summary?.total_credit)}
            color="amber"
          />
          <SmartButton
            icon={<Wallet size={18} />}
            label="إجمالي المدفوع"
            value={egp(summary?.payments_total)}
            color="green"
          />
          <div className="h-10 w-px bg-slate-200 mx-1" />
          <SmartButton
            icon={<BookOpen size={18} />}
            label="رصيد مستحق"
            value={egp(openBalance)}
            color={openBalance > 0 ? 'red' : openBalance < 0 ? 'green' : 'slate'}
            onClick={() => navigate(`/gl/ledger`)}
          />
        </div>
      </div>

      {/* ── Tabs + Content ──────────────────────────────────── */}
      <div className="px-6 py-4 space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-black text-slate-800">مطابقة ذمم المورد مع GL</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">مقارنة مباشرة بين رصيد المورد الفرعي ورصيد حساب الدائنين من القيود</p>
            </div>
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
              isApInSync
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-red-50 text-red-700 border-red-200'
            }`}>
              {isApInSync ? 'مطابق' : 'يوجد فرق'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] text-slate-500">Subledger (Supplier)</p>
              <p className="font-black text-slate-800 tabular-nums">{egp(openBalance)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] text-slate-500">GL AP Balance</p>
              <p className="font-black text-slate-800 tabular-nums">{egp(glApBalance)}</p>
            </div>
            <div className={`rounded-lg border px-3 py-2 ${
              isApInSync
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-red-200 bg-red-50'
            }`}>
              <p className={`text-[11px] ${isApInSync ? 'text-emerald-700' : 'text-red-700'}`}>Gap</p>
              <p className={`font-black tabular-nums ${isApInSync ? 'text-emerald-700' : 'text-red-700'}`}>{egp(apGap)}</p>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-0 border-b border-slate-200">
          {([
            { id: 'statement' as TabId, label: 'كشف الحساب',          icon: <FileText  size={14} /> },
            { id: 'analysis'  as TabId, label: 'توزيع مراكز التكلفة', icon: <BarChart3 size={14} /> },
          ]).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-5 py-2.5 text-sm font-bold border-b-2 transition-all ${
                tab === t.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-400 hover:text-slate-600 hover:border-slate-300'
              }`}
            >
              {t.icon}{t.label}
            </button>
          ))}

          {/* Filters right side */}
          <div className="flex items-center gap-2 ms-auto pb-1">
            <Filter size={13} className="text-slate-400" />
            <select
              value={seasonId ?? ''}
              onChange={e => { setSeasonId(e.target.value ? Number(e.target.value) : undefined); setPage(1) }}
              className="input-field h-8 text-xs py-0 bg-white border-slate-200 min-w-[120px]"
            >
              <option value="">كل المواسم</option>
              {(seasons as Array<{ id: number; name: string }> ?? []).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select
              value={filterMonth ?? ''}
              onChange={e => { setFilterMonth(e.target.value ? Number(e.target.value) : undefined); setPage(1) }}
              className="input-field h-8 text-xs py-0 bg-white border-slate-200"
            >
              <option value="">كل الشهور</option>
              {MONTH_NAMES.slice(1).map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Tab: Statement */}
        {tab === 'statement' && (
          <div className="card border-none shadow-lg overflow-hidden">
            {/* Draft warning banner */}
            {hasDrafts && (
              <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs font-semibold">
                <AlertTriangle size={13} className="text-amber-500" />
                يوجد {summary?.draft_count} قيد/فاتورة في حالة المسودة — يلزم الترحيل لتحديث الرصيد
              </div>
            )}
            <div ref={tableRef}>
              <DataTable<SupplierTransaction>
                columns={TXNS_COLS}
                data={allTxns}
                loading={isLoading}
                total={txns?.total ?? 0}
                page={page}
                pageSize={100}
                onPage={setPage}
                rowKey={r => r.id}
                rowClassName={r => highlightId === r.id
                  ? 'bg-amber-50 ring-1 ring-inset ring-amber-300'
                  : (allTxns.indexOf(r) % 2 === 0 ? 'bg-white' : 'bg-slate-50/50')}
                emptyText="لا توجد معاملات لهذا المورد"
              />
            </div>
          </div>
        )}

        {/* Tab: Analysis */}
        {tab === 'analysis' && (
          <div className="card border-none shadow-lg">
            {analysisLoading ? (
              <p className="p-8 text-center text-slate-400">جارٍ التحميل…</p>
            ) : (
              <div>
                <h3 className="px-5 py-4 font-black text-slate-800 border-b border-slate-100 flex items-center gap-2">
                  <BarChart3 size={18} className="text-blue-500" />
                  توزيع المصروفات حسب مراكز التكلفة
                  <span className="mr-auto text-xs font-medium text-slate-400">{centerMap.size} مركز</span>
                </h3>
                {[...centerMap.entries()].length === 0 ? (
                  <p className="p-12 text-center text-slate-400 text-sm italic">لا توجد بيانات تحليلية متاحة</p>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {[...centerMap.entries()]
                      .sort((a, b) => b[1].credit - a[1].credit)
                      .map(([k, v]) => {
                        const total = (analysis?.summary as Array<{ total_credit: number }> | undefined)
                          ?.reduce((s, r) => s + r.total_credit, 0) ?? 1
                        const pct = total > 0 ? Math.round((v.credit / total) * 100) : 0
                        return (
                          <div key={String(k)} className="flex items-center px-6 py-4 hover:bg-slate-50 transition-colors gap-4">
                            <div className="flex-1">
                              <p className="font-bold text-slate-700">{v.name ?? 'مركز غير محدد'}</p>
                              {k && <p className="text-[10px] text-slate-400 font-mono">CODE: {k}</p>}
                              <div className="mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden w-48">
                                <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-base font-black text-amber-700 tabular-nums">{egp(v.credit)}</p>
                              <p className="text-[10px] text-slate-400">{pct}% من الإجمالي</p>
                              {v.debit > 0 && <p className="text-[10px] font-bold text-emerald-600">تم السداد: {egp(v.debit)}</p>}
                            </div>
                          </div>
                        )
                      })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <AddSupplierTransactionModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        supplierCode={Number(code)}
        supplierName={supplier?.name ?? ''}
      />

      <EditSupplierModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        supplier={supplier}
      />
    </div>
  )
}
