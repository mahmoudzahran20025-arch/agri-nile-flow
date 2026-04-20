import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Download } from 'lucide-react'
import { treasuryApi } from '../../api/client'
import DataTable, { type Column } from '../../components/ui/DataTable'
import type { CashTransaction } from '../../types'

function egp(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(n)
}

const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

const COLUMNS: Column<CashTransaction>[] = [
  { key: 'transaction_date', header: 'التاريخ', width: '110px',
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
  { key: 'recipient_name', header: 'المستلم / المسلم', render: r => r.recipient_name ?? '—' },
  { key: 'narration',     header: 'البيان' },
  { key: 'amount',  header: 'المبلغ',   render: r => <span className="font-medium">{egp(r.amount)}</span> },
  { key: 'debit',   header: 'مدين',     render: r => <span className="text-red-600">{r.debit  ? egp(r.debit)  : '—'}</span> },
  { key: 'credit',  header: 'دائن',     render: r => <span className="text-green-700">{r.credit ? egp(r.credit) : '—'}</span> },
  {
    key: 'running_balance', header: 'الرصيد',
    render: r => {
      const b = r.running_balance ?? 0
      return <span className={`font-bold ${b >= 0 ? 'text-slate-800' : 'text-red-600'}`}>{egp(b)}</span>
    },
  },
  { key: 'notes', header: 'ملاحظات', render: r => r.notes ?? '—' },
]

export default function CashJournalPage() {
  const [page,      setPage]      = useState(1)
  const [direction, setDirection] = useState('')
  const [month,     setMonth]     = useState('')

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

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">الخزينة</h1>
          {balance != null && (
            <p className="text-sm text-slate-500 mt-0.5">
              الرصيد الحالي:
              <span className={`font-bold mr-1 ${(balance as { balance: number }).balance >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                {egp((balance as { balance: number }).balance)}
              </span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary gap-2"><Download size={16} />تصدير</button>
          <button className="btn-primary gap-2"><Plus size={16} />حركة جديدة</button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-3">
        <select
          className="input w-40"
          value={direction}
          onChange={e => { setDirection(e.target.value); setPage(1) }}
        >
          <option value="">كل الاتجاهات</option>
          <option value="د">وارد (د)</option>
          <option value="م">منصرف (م)</option>
        </select>

        <select
          className="input w-36"
          value={month}
          onChange={e => { setMonth(e.target.value); setPage(1) }}
        >
          <option value="">كل الشهور</option>
          {MONTHS.map((m, i) => (
            <option key={i+1} value={i+1}>{m}</option>
          ))}
        </select>

        {(direction || month) && (
          <button
            className="btn-ghost text-sm"
            onClick={() => { setDirection(''); setMonth(''); setPage(1) }}
          >
            مسح الفلاتر
          </button>
        )}

        <div className="flex-1 text-left self-center text-sm text-slate-400">
          {data ? `${data.total.toLocaleString('ar-EG')} حركة` : ''}
        </div>
      </div>

      <DataTable<CashTransaction>
        columns={COLUMNS}
        data={data?.data ?? []}
        loading={isLoading}
        total={data?.total ?? 0}
        page={page}
        pageSize={100}
        onPage={setPage}
        rowKey={r => r.id}
        emptyText="لا توجد حركات في الخزينة"
      />
    </div>
  )
}
