import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, FileText, Plus, Filter, BarChart3 } from 'lucide-react'
import { suppliersApi, reportsApi, configApi, downloadCsv } from '../../api/client'
import { usePermission } from '../../hooks/usePermission'
import DataTable, { type Column } from '../../components/ui/DataTable'
import AddSupplierTransactionModal from '../../components/forms/AddSupplierTransactionModal'
import type { Supplier, SupplierTransaction } from '../../types'

const MONTH_NAMES = ['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

type TabId = 'statement' | 'analysis'

function egp(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(n)
}

const TXNS_COLS: Column<SupplierTransaction>[] = [
  { key: 'transaction_date', header: 'التاريخ', width: '100px',
    render: r => new Date(r.transaction_date + 'T00:00:00').toLocaleDateString('ar-EG') },
  { key: 'document_type',    header: 'المستند',  width: '120px', render: r => r.document_type ?? '—' },
  { key: 'document_number',  header: 'رقم',      width: '65px',  render: r => r.document_number ?? '—' },
  { key: 'expense_category', header: 'الخدمة',                   render: r => r.expense_category ?? '—' },
  { key: 'equipment',        header: 'المعدة',   width: '90px',  render: r => r.equipment ?? '—' },
  { key: 'quantity',         header: 'الكمية',   width: '70px',  render: r => r.quantity ?? '—' },
  { key: 'unit',             header: 'الوحدة',   width: '65px',  render: r => r.unit ?? '—' },
  { key: 'unit_price',       header: 'السعر',    width: '90px',  render: r => r.unit_price ? egp(r.unit_price) : '—' },
  { key: 'amount',           header: 'القيمة',   width: '100px',
    render: r => <span className="font-medium">{egp(r.amount)}</span> },
  { key: 'credit',           header: 'دائن',     width: '100px',
    render: r => r.credit ? <span className="text-amber-700 font-medium">{egp(r.credit)}</span> : <span className="text-slate-300">—</span> },
  { key: 'debit',            header: 'مدين',     width: '100px',
    render: r => r.debit ? <span className="text-blue-700 font-medium">{egp(r.debit)}</span> : <span className="text-slate-300">—</span> },
  { key: 'balance_with_checks', header: 'الرصيد', width: '110px',
    render: r => {
      const b = r.balance_with_checks ?? 0
      return <span className={`font-bold ${b > 0 ? 'text-amber-700' : b < 0 ? 'text-green-700' : 'text-slate-400'}`}>{egp(b)}</span>
    }
  },
  { key: 'notes', header: 'ملاحظات', render: r => r.notes ?? '—' },
]

export default function SupplierDetailPage() {
  const { canWrite }     = usePermission()
  const { code }         = useParams<{ code: string }>()
  const navigate         = useNavigate()
  const [page,        setPage]       = useState(1)
  const [addOpen,     setAddOpen]    = useState(false)
  const [tab,         setTab]        = useState<TabId>('statement')
  const [seasonId,    setSeasonId]   = useState<number | undefined>(undefined)
  const [filterMonth, setFilterMonth]= useState<number | undefined>(undefined)

  const { data: seasons } = useQuery({
    queryKey: ['seasons'],
    queryFn:  configApi.seasons,
  })

  const { data: supplier } = useQuery({
    queryKey: ['supplier', code],
    queryFn:  () => suppliersApi.get(Number(code)) as Promise<Supplier>,
    enabled:  !!code,
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

  const { data: analysis, isLoading: analysisLoading } = useQuery({
    queryKey: ['supplier-analysis', code, seasonId],
    queryFn:  () => reportsApi.supplierPayments({ supplier_code: Number(code), season_id: seasonId }),
    enabled:  !!code && tab === 'analysis',
  })

  const allTxns     = txns?.data ?? []
  const totalCredit = allTxns.reduce((s, t) => s + (t.credit ?? 0), 0)
  const totalDebit  = allTxns.reduce((s, t) => s + (t.debit  ?? 0), 0)
  const totalChecks = allTxns.reduce((s, t) => s + (t.check_amount ?? 0), 0)
  const lastBalance = allTxns.length > 0 ? (allTxns[allTxns.length - 1].balance_with_checks ?? 0) : 0

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

  const TAB_ITEMS: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'statement', label: 'كشف الحساب',          icon: <FileText  size={15} /> },
    { id: 'analysis',  label: 'توزيع مراكز التكلفة', icon: <BarChart3 size={15} /> },
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => navigate('/suppliers')} className="btn-ghost p-2">
          <ArrowRight size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="page-title truncate">{supplier?.name ?? '…'}</h1>
          <p className="text-sm text-slate-500">
            كود: <span className="font-mono">{code}</span>
            {supplier?.activity ? ` · ${supplier.activity}` : ''}
          </p>
        </div>
        <button
          className="btn-secondary gap-2 text-sm"
          onClick={() => downloadCsv(`/suppliers/${code}/statement`, `كشف_حساب_${code}`)}
        >
          <FileText size={15} />
          تصدير CSV
        </button>
        {canWrite('suppliers') && (
          <button className="btn-primary gap-2 text-sm" onClick={() => setAddOpen(true)}>
            <Plus size={15} />
            إضافة قيد
          </button>
        )}
      </div>

      {/* KPI Cards */}
      {supplier && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'إجمالي الدائن (مستحق)', val: totalCredit || supplier.total_credit,   color: 'text-amber-700' },
            { label: 'إجمالي المدين (مدفوع)', val: totalDebit  || supplier.total_debit,    color: 'text-blue-700' },
            { label: 'شيكات معلقة',           val: totalChecks,                             color: 'text-purple-700' },
            { label: 'الرصيد الحالي',         val: lastBalance || supplier.current_balance, color: 'text-slate-900 font-bold' },
          ].map(c => (
            <div key={c.label} className="card p-4 text-center">
              <p className="text-xs text-slate-500 mb-1">{c.label}</p>
              <p className={`text-base font-semibold ${c.color}`}>{egp(c.val)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs + Filters */}
      <div className="flex items-center gap-1 border-b border-slate-200 flex-wrap">
        {TAB_ITEMS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
              ${tab === t.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {t.icon}{t.label}
          </button>
        ))}
        <div className="flex items-center gap-2 ms-auto pb-1">
          <Filter size={13} className="text-slate-400" />
          <select
            value={seasonId ?? ''}
            onChange={e => { setSeasonId(e.target.value ? Number(e.target.value) : undefined); setPage(1) }}
            className="input-field h-8 text-xs py-0"
          >
            <option value="">كل المواسم</option>
            {(seasons as Array<{ id: number; name: string }> ?? []).map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select
            value={filterMonth ?? ''}
            onChange={e => { setFilterMonth(e.target.value ? Number(e.target.value) : undefined); setPage(1) }}
            className="input-field h-8 text-xs py-0"
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
        <DataTable<SupplierTransaction>
          columns={TXNS_COLS}
          data={allTxns}
          loading={isLoading}
          total={txns?.total ?? 0}
          page={page}
          pageSize={100}
          onPage={setPage}
          rowKey={r => r.id}
          emptyText="لا توجد معاملات"
        />
      )}

      {/* Tab: Analysis */}
      {tab === 'analysis' && (
        <div className="card">
          {analysisLoading ? (
            <p className="p-8 text-center text-slate-400">جارٍ التحميل…</p>
          ) : (
            <div>
              <h3 className="px-5 py-3 font-semibold text-slate-700 border-b border-slate-100">
                توزيع المعاملات على مراكز التكلفة
              </h3>
              <div className="divide-y divide-slate-100">
                {[...centerMap.entries()]
                  .sort((a, b) => b[1].credit - a[1].credit)
                  .map(([k, v]) => (
                    <div key={String(k)} className="flex items-center px-5 py-3 gap-4">
                      <div className="flex-1">
                        <p className="font-medium text-slate-700">{v.name ?? 'غير محدد'}</p>
                        {k && <p className="text-xs text-slate-400 font-mono">{k}</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-amber-700">{egp(v.credit)}</p>
                        {v.debit > 0 && <p className="text-xs text-blue-600">مدفوع: {egp(v.debit)}</p>}
                      </div>
                    </div>
                  ))}
                {centerMap.size === 0 && (
                  <p className="p-6 text-center text-slate-400 text-sm">لا توجد بيانات</p>
                )}
              </div>
              {analysis?.summary && analysis.summary.length > 0 && (
                <div className="border-t border-slate-200 bg-slate-50 px-5 py-3">
                  <div className="flex justify-between text-sm flex-wrap gap-3">
                    <span className="text-slate-600 font-semibold">الإجمالي</span>
                    <div className="flex gap-6 flex-wrap">
                      <span className="text-amber-700 font-bold">دائن: {egp(analysis.summary[0]?.total_credit)}</span>
                      <span className="text-blue-700">مدفوع: {egp(analysis.summary[0]?.total_debit)}</span>
                      <span className={`font-bold ${(analysis.summary[0]?.balance ?? 0) > 0 ? 'text-red-600' : 'text-green-700'}`}>
                        رصيد: {egp(analysis.summary[0]?.balance)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <AddSupplierTransactionModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        supplierCode={Number(code)}
        supplierName={supplier?.name ?? ''}
      />
    </div>
  )
}
