import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, FileText } from 'lucide-react'
import { suppliersApi } from '../../api/client'
import DataTable, { type Column } from '../../components/ui/DataTable'
import type { Supplier, SupplierTransaction } from '../../types'

function egp(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(n)
}

const TXNS_COLS: Column<SupplierTransaction>[] = [
  { key: 'transaction_date', header: 'التاريخ', width: '110px',
    render: r => new Date(r.transaction_date).toLocaleDateString('ar-EG') },
  { key: 'entry_type',    header: 'النوع',     width: '60px' },
  { key: 'document_type', header: 'المستند',   render: r => r.document_type ?? '—' },
  { key: 'document_number', header: 'رقم',     width: '70px', render: r => r.document_number ?? '—' },
  { key: 'expense_category', header: 'الخدمة', render: r => r.expense_category ?? '—' },
  { key: 'unit',    header: 'الوحدة',  width: '70px',  render: r => r.unit ?? '—' },
  { key: 'quantity', header: 'الكمية', width: '80px',  render: r => r.quantity ?? '—' },
  { key: 'unit_price', header: 'السعر', width: '90px', render: r => r.unit_price ? egp(r.unit_price) : '—' },
  { key: 'amount', header: 'القيمة',   render: r => <span className="font-medium">{egp(r.amount)}</span> },
  { key: 'credit', header: 'دائن',     render: r => <span className="text-green-700">{egp(r.credit)}</span> },
  { key: 'debit',  header: 'مدين',     render: r => <span className="text-red-600">{egp(r.debit)}</span> },
  { key: 'balance_with_checks', header: 'الرصيد',
    render: r => {
      const b = r.balance_with_checks ?? 0
      return <span className={`font-bold ${b >= 0 ? 'text-green-700' : 'text-red-600'}`}>{egp(b)}</span>
    }
  },
  { key: 'notes', header: 'ملاحظات', render: r => r.notes ?? '—' },
]

export default function SupplierDetailPage() {
  const { code } = useParams<{ code: string }>()
  const navigate  = useNavigate()
  const [page, setPage] = useState(1)

  const { data: supplier } = useQuery({
    queryKey: ['supplier', code],
    queryFn:  () => suppliersApi.get(Number(code)) as Promise<Supplier>,
    enabled:  !!code,
  })

  const { data: txns, isLoading } = useQuery({
    queryKey: ['supplier-statement', code, page],
    queryFn:  () => suppliersApi.statement(Number(code), { page, size: 100 }) as Promise<{
      data: SupplierTransaction[]; total: number; page: number; page_size: number; has_more: boolean
    }>,
    enabled: !!code,
  })

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/suppliers')} className="btn-ghost p-2">
          <ArrowRight size={18} />
        </button>
        <div>
          <h1 className="page-title">{supplier?.name ?? '…'}</h1>
          <p className="text-sm text-slate-500">
            كود: {code} · {supplier?.activity ?? '—'}
          </p>
        </div>
        <div className="flex-1" />
        <button className="btn-secondary gap-2">
          <FileText size={16} />
          تصدير كشف الحساب
        </button>
      </div>

      {/* Summary cards */}
      {supplier && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'إجمالي الدائن',  val: supplier.total_credit,   color: 'text-green-700' },
            { label: 'إجمالي المدين',  val: supplier.total_debit,    color: 'text-red-600'   },
            { label: 'الرصيد الحالي', val: supplier.current_balance, color: 'text-slate-900 font-bold' },
          ].map(c => (
            <div key={c.label} className="card p-4 text-center">
              <p className="text-xs text-slate-500 mb-1">{c.label}</p>
              <p className={`text-lg font-semibold ${c.color}`}>{egp(c.val)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Statement table */}
      <DataTable<SupplierTransaction>
        columns={TXNS_COLS}
        data={txns?.data ?? []}
        loading={isLoading}
        total={txns?.total ?? 0}
        page={page}
        pageSize={100}
        onPage={setPage}
        rowKey={r => r.id}
        emptyText="لا توجد معاملات لهذا المورد"
      />
    </div>
  )
}
