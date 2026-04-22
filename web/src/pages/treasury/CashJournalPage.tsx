import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Download } from 'lucide-react'
import { treasuryApi, downloadCsv } from '../../api/client'
import { usePermission } from '../../hooks/usePermission'
import DataTable, { type Column, type SortState } from '../../components/ui/DataTable'
import AddCashTransactionModal from '../../components/forms/AddCashTransactionModal'
import type { CashTransaction } from '../../types'

function egp(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(n)
}

const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

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
  { key: 'document_number', header: 'رقم المستند', width: '100px', render: r => r.document_number ?? '—' },
  { key: 'recipient_name',  header: 'المستلم / المسلم', render: r => r.recipient_name ?? '—' },
  { key: 'narration',       header: 'البيان' },
  { key: 'amount',  header: 'المبلغ',   sortable: true,
    render: r => <span className="font-medium">{egp(r.amount)}</span> },
  { key: 'debit',   header: 'مدين',     sortable: true,
    render: r => <span className="text-red-600">{r.debit  ? egp(r.debit)  : '—'}</span> },
  { key: 'credit',  header: 'دائن',     sortable: true,
    render: r => <span className="text-green-700">{r.credit ? egp(r.credit) : '—'}</span> },
  {
    key: 'running_balance', header: 'الرصيد', sortable: true,
    render: r => {
      const b = r.running_balance ?? 0
      return <span className={`font-bold ${b >= 0 ? 'text-slate-800' : 'text-red-600'}`}>{egp(b)}</span>
    },
  },
  { key: 'notes', header: 'ملاحظات', render: r => r.notes ?? '—' },
]

export default function CashJournalPage() {
  const { canWrite } = usePermission()
  const [page,      setPage]      = useState(1)
  const [direction, setDirection] = useState('')
  const [month,     setMonth]     = useState('')
  const [addOpen,   setAddOpen]   = useState(false)
  const [sort,      setSort]      = useState<SortState | undefined>(undefined)

  const { data: balance } = useQuery({
    queryKey: ['treasury', 'balance'],
    queryFn:  () => treasuryApi.balance(),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['treasury', 'txns', page, direction, month],
    queryFn:  () => treasuryApi.list({
      page, size: 100,
      direction: direction || undefined,
      month: month ? Number(month) : undefined,
    }) as Promise<{ data: CashTransaction[]; total: number; page: number; page_size: number; has_more: boolean }>,
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

  const bal = (balance as { balance: number } | null)?.balance

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">الخزينة</h1>
          {bal != null && (
            <p className="text-sm text-slate-500 mt-0.5">
              الرصيد الحالي:
              <span className={`font-bold mr-1 ${bal >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                {egp(bal)}
              </span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
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
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Direction filter pills */}
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
            {[
              { v: '',  l: 'كل الاتجاهات' },
              { v: 'د', l: 'وارد ↑' },
              { v: 'م', l: 'منصرف ↓' },
            ].map(({ v, l }) => (
              <button
                key={v}
                onClick={() => { setDirection(v); setPage(1) }}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                  direction === v ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Month select */}
          <select
            className="input w-36 text-sm"
            value={month}
            onChange={e => { setMonth(e.target.value); setPage(1) }}
          >
            <option value="">كل الشهور</option>
            {MONTHS.map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>

          {(direction || month) && (
            <button
              className="px-3 py-1 text-xs font-medium rounded-lg text-red-600 hover:bg-red-50 transition-colors"
              onClick={() => { setDirection(''); setMonth(''); setPage(1) }}
            >
              مسح الفلاتر
            </button>
          )}

          <div className="flex-1 text-left self-center text-sm text-slate-400">
            {data ? `${(data?.total ?? 0).toLocaleString('ar-EG')} حركة` : ''}
          </div>
        </div>
      </div>

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

      <AddCashTransactionModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}
