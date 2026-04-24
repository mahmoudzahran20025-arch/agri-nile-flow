import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Download, ShieldCheck, HelpCircle, Filter, RefreshCcw } from 'lucide-react'
import { treasuryApi, downloadCsv } from '../../api/client'
import { usePermission } from '../../hooks/usePermission'
import DataTable, { type Column, type SortState } from '../../components/ui/DataTable'
import AddCashTransactionModal from '../../components/forms/AddCashTransactionModal'
import type { CashTransaction } from '../../types'
import { useToast } from '../../contexts/ToastContext'

function egp(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(n)
}

const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

export default function CashJournalPage() {
  const { canWrite, role } = usePermission()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [page,      setPage]      = useState(1)
  const [direction, setDirection] = useState('')
  const [status,    setStatus]    = useState('')
  const [month,     setMonth]     = useState('')
  const [addOpen,   setAddOpen]   = useState(false)
  const [sort,      setSort]      = useState<SortState | undefined>(undefined)

  const { data: balance } = useQuery({
    queryKey: ['treasury', 'balance'],
    queryFn:  () => treasuryApi.balance(),
  })

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['treasury', 'txns', page, direction, month, status],
    queryFn:  () => treasuryApi.list({
      page, size: 100,
      direction: direction || undefined,
      month: month ? Number(month) : undefined,
      status: status || undefined,
    }) as Promise<{ data: CashTransaction[]; total: number; page: number; page_size: number; has_more: boolean }>,
  })

  const postMutation = useMutation({
    mutationFn: (id: number) => treasuryApi.post(id),
    onSuccess: () => {
      toast('تم ترحيل الحركة واعتمادها بنجاح', 'success')
      queryClient.invalidateQueries({ queryKey: ['treasury'] })
    },
    onError: (err: any) => toast(err.message || 'فشل ترحيل الحركة', 'error')
  })

  const COLUMNS: Column<CashTransaction>[] = [
    { key: 'transaction_date', header: 'التاريخ', width: '110px', sortable: true,
      render: r => new Date(r.transaction_date).toLocaleDateString('ar-EG') },
    {
      key: 'direction', header: 'الاتجاه', width: '80px',
      render: r => (
        <span className={r.direction === 'د' ? 'badge-green' : 'badge-red'}>
          {r.direction === 'د' ? 'وارد' : 'منصرف'}
        </span>
      ),
    },
    {
      key: 'status', header: 'الحالة', width: '90px',
      render: r => (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
          r.status === 'posted' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
        }`}>
          {r.status === 'posted' ? 'مُرحّل' : 'مسودة'}
        </span>
      )
    },
    { key: 'document_number', header: 'رقم المستند', width: '100px', render: r => r.document_number ?? '—' },
    { key: 'recipient_name',  header: 'المستلم / المسلم', render: r => r.recipient_name ?? '—' },
    { key: 'narration',       header: 'البيان' },
    { key: 'amount',  header: 'المبلغ',   sortable: true,
      render: r => <span className="font-medium">{egp(r.amount)}</span> },
    {
      key: 'running_balance', header: 'الرصيد', sortable: true,
      render: r => {
        if (r.status === 'draft') return <span className="text-slate-300 italic text-xs">— بانتظار الترحيل —</span>
        const b = r.running_balance ?? 0
        return <span className={`font-bold ${b >= 0 ? 'text-slate-800' : 'text-red-600'}`}>{egp(b)}</span>
      },
    },
    {
       key: 'actions', header: '', width: '60px',
       render: r => (
         r.status === 'draft' && (role === 'super_admin' || role === 'company_admin') ? (
           <button 
             onClick={() => postMutation.mutate(r.id)}
             disabled={postMutation.isPending}
             className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
             title="اعتماد وترحيل"
           >
             <ShieldCheck size={18} />
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

  const bal = (balance as { balance: number } | null)?.balance

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">الخزينة والسيولة</h1>
          {bal != null && (
            <div className="flex items-center gap-3 mt-1">
               <p className="text-sm text-slate-500">
                الرصيد المعتمد:
                <span className={`font-black mr-2 text-lg ${bal >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                  {egp(bal)}
                </span>
              </p>
              <div className="h-4 w-[1px] bg-slate-200" />
              <div className="flex items-center gap-1 text-[10px] text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-100">
                 <HelpCircle size={10} /> المسودات لا تؤثر على الرصيد
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary gap-2"
            onClick={() => refetch()}
          >
            <RefreshCcw size={16} />تحديث
          </button>
          <button
            className="btn-secondary gap-2"
            onClick={() => downloadCsv('/treasury', 'دفتر_اليومية', {
              year:  new Date().getFullYear(),
              month: month ? Number(month) : undefined,
            })}
          >
            <Download size={16} />تصدير CSV
          </button>
          {canWrite('treasury') && (
            <button className="btn-primary gap-2" onClick={() => setAddOpen(true)}>
              <Plus size={16} />حركة جديدة
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 space-y-3 bg-slate-50/50">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
             <Filter size={14} className="text-slate-400" />
             <span className="text-xs font-bold text-slate-500">التصفيات:</span>
          </div>

          <div className="flex items-center gap-1 rounded-xl bg-white border border-slate-200 p-1 shadow-sm">
            {[
              { v: '',  l: 'الكل' },
              { v: 'posted', l: 'معتمد ✅' },
              { v: 'draft',  l: 'مسودة 📝' },
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

          <div className="flex items-center gap-1 rounded-xl bg-white border border-slate-200 p-1 shadow-sm">
            {[
              { v: '',  l: 'كل الاتجاهات' },
              { v: 'د', l: 'وارد' },
              { v: 'م', l: 'منصرف' },
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

          <select
            className="input w-36 text-xs h-8 bg-white border-slate-200"
            value={month}
            onChange={e => { setMonth(e.target.value); setPage(1) }}
          >
            <option value="">كل الشهور</option>
            {MONTHS.map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>

          {(direction || month || status) && (
            <button
              className="text-xs font-bold text-rose-600 hover:underline"
              onClick={() => { setDirection(''); setMonth(''); setStatus(''); setPage(1) }}
            >
              إلغاء التصفية
            </button>
          )}

          <div className="flex-1 text-left self-center text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {data ? `${(data?.total ?? 0).toLocaleString('ar-EG')} حركة` : ''}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden shadow-xl border-none">
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
          emptyText="لا توجد حركات في الخزينة"
        />
      </div>

      <AddCashTransactionModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}
