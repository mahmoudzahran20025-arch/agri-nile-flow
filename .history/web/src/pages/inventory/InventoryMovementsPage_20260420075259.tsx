import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, SlidersHorizontal } from 'lucide-react'
import { inventoryApi } from '../../api/client'
import DataTable, { type Column } from '../../components/ui/DataTable'
import AddInventoryMovementModal from '../../components/forms/AddInventoryMovementModal'
import type { InventoryMovement } from '../../types'

function egp(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}
function num(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 3 }).format(n)
}

const COLUMNS: Column<InventoryMovement>[] = [
  { key: 'movement_date', header: 'التاريخ', width: '105px',
    render: r => new Date(r.movement_date).toLocaleDateString('ar-EG') },
  { key: 'warehouse', header: 'المخزن', width: '120px' },
  {
    key: 'movement_type', header: 'النوع', width: '80px',
    render: r => (
      <span className={r.movement_type === 'اضافة' ? 'badge-green' : 'badge-red'}>
        {r.movement_type === 'اضافة' ? 'وارد' : 'منصرف'}
      </span>
    ),
  },
  { key: 'item_name',  header: 'الصنف',  render: r => r.item_name ?? `#${r.item_code}` },
  { key: 'unit',       header: 'الوحدة', width: '70px',  render: r => r.unit ?? '—' },
  { key: 'quantity',   header: 'الكمية', width: '80px',  render: r => num(r.quantity) },
  { key: 'unit_price', header: 'سعر الوحدة', width: '100px', render: r => egp(r.unit_price) },
  {
    key: 'qty_in', header: 'وارد / منصرف', width: '110px',
    render: r => r.qty_in
      ? <span className="text-green-700 font-medium">{num(r.qty_in)}</span>
      : <span className="text-red-600 font-medium">{num(r.qty_out)}</span>,
  },
  { key: 'balance_qty', header: 'رصيد الكمية', width: '100px',
    render: r => <span className="font-bold">{num(r.balance_qty)}</span> },
  { key: 'balance_value', header: 'قيمة الرصيد', width: '110px',
    render: r => <span className="font-bold text-brand-700">{egp(r.balance_value)}</span> },
  { key: 'document_number', header: 'المستند', width: '85px', render: r => r.document_number ?? '—' },
  { key: 'notes', header: 'ملاحظات', render: r => r.notes ?? '—' },
]

export default function InventoryMovementsPage() {
  const [page,      setPage]      = useState(1)
  const [warehouse, setWarehouse] = useState('')
  const [movType,   setMovType]   = useState('')
  const [addOpen,   setAddOpen]   = useState(false)

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn:  inventoryApi.warehouses,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'movements', page, warehouse, movType],
    queryFn:  () => inventoryApi.list({
      page, size: 100,
      warehouse: warehouse || undefined,
      type:      movType   || undefined,
    }) as Promise<{ data: InventoryMovement[]; total: number; page: number; page_size: number; has_more: boolean }>,
  })

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">حركات المخزون</h1>
        <button className="btn-primary gap-2" onClick={() => setAddOpen(true)}>
          <Plus size={16} />
          حركة جديدة
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-3 items-center">
        <SlidersHorizontal size={16} className="text-slate-400" />
        <select className="input w-44" value={warehouse} onChange={e => { setWarehouse(e.target.value); setPage(1) }}>
          <option value="">كل المخازن</option>
          {(warehouses ?? []).map(w => <option key={w} value={w}>{w}</option>)}
        </select>

        <select className="input w-36" value={movType} onChange={e => { setMovType(e.target.value); setPage(1) }}>
          <option value="">كل الحركات</option>
          <option value="اضافة">وارد</option>
          <option value="صرف">منصرف</option>
        </select>

        {(warehouse || movType) && (
          <button className="btn-ghost text-sm" onClick={() => { setWarehouse(''); setMovType(''); setPage(1) }}>
            مسح الفلاتر
          </button>
        )}
        <div className="flex-1 text-left text-sm text-slate-400">
          {data ? `${(data?.total ?? 0).toLocaleString('ar-EG')} حركة` : ''}
        </div>
      </div>

      <DataTable<InventoryMovement>
        columns={COLUMNS}
        data={data?.data ?? []}
        loading={isLoading}
        total={data?.total ?? 0}
        page={page}
        pageSize={100}
        onPage={setPage}
        rowKey={r => r.id}
        emptyText="لا توجد حركات مخزنية"
      />

      <AddInventoryMovementModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        defaultWarehouse={warehouse || undefined}
      />
    </div>
  )
}
