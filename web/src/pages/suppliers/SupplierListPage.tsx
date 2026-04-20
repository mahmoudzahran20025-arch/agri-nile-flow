import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, Plus } from 'lucide-react'
import { suppliersApi } from '../../api/client'
import DataTable, { type Column } from '../../components/ui/DataTable'
import type { Supplier } from '../../types'

function egp(n: number | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}

const COLUMNS: Column<Supplier>[] = [
  { key: 'code',     header: 'الكود',           width: '90px' },
  { key: 'name',     header: 'المورد / العميل' },
  { key: 'activity', header: 'النشاط',           render: r => r.activity ?? '—' },
  {
    key: 'total_credit', header: 'إجمالي الدائن',
    render: r => <span className="text-green-700 font-medium">{egp(r.total_credit)}</span>,
  },
  {
    key: 'total_debit', header: 'إجمالي المدين',
    render: r => <span className="text-red-600 font-medium">{egp(r.total_debit)}</span>,
  },
  {
    key: 'current_balance', header: 'الرصيد الحالي',
    render: r => {
      const b = r.current_balance ?? 0
      return (
        <span className={`font-bold ${b > 0 ? 'text-green-700' : b < 0 ? 'text-red-600' : 'text-slate-400'}`}>
          {egp(b)}
        </span>
      )
    },
  },
  {
    key: 'is_active', header: 'الحالة',
    render: r => (
      <span className={r.is_active ? 'badge-green' : 'badge-slate'}>
        {r.is_active ? 'نشط' : 'موقوف'}
      </span>
    ),
  },
]

export default function SupplierListPage() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [q,    setQ]    = useState('')
  const [qInput, setQInput] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', page, q],
    queryFn:  () => suppliersApi.list({ page, size: 50, q: q || undefined }) as Promise<{
      data: Supplier[]; total: number; page: number; page_size: number; has_more: boolean
    }>,
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setQ(qInput)
    setPage(1)
  }

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">الموردين والعملاء</h1>
        <button className="btn-primary">
          <Plus size={16} />
          إضافة مورد
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4">
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
      </div>

      {/* Stats row */}
      {data && (
        <div className="flex items-center gap-4 text-sm text-slate-500">
          <span>{data.total.toLocaleString('ar-EG')} مورد / عميل</span>
        </div>
      )}

      <DataTable<Supplier>
        columns={COLUMNS}
        data={data?.data ?? []}
        loading={isLoading}
        total={data?.total ?? 0}
        page={page}
        pageSize={50}
        onPage={setPage}
        rowKey={r => r.code}
        onRowClick={r => navigate(`/suppliers/${r.code}`)}
        emptyText="لا يوجد موردين أو عملاء مسجلين"
      />
    </div>
  )
}
