import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, SlidersHorizontal, Download, Leaf } from 'lucide-react'
import { inventoryApi, configApi, fieldsApi, operationsApi, downloadCsv } from '../../api/client'
import DataTable, { type Column, type SortState } from '../../components/ui/DataTable'
import AddInventoryBatchModal from '../../components/forms/AddInventoryBatchModal'
import type { InventoryMovement } from '../../types'
import { usePermission } from '../../hooks/usePermission'

function egp(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}
function num(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n)
}

const COLUMNS: Column<InventoryMovement & { field_name?: string }>[] = [
  { key: 'movement_date', header: 'التاريخ', width: '105px', sortable: true,
    render: r => new Date(r.movement_date).toLocaleDateString('en-US') },
  { key: 'warehouse', header: 'المخزن', width: '120px', sortable: true },
  {
    key: 'movement_type', header: 'النوع', width: '80px', sortable: true,
    render: r => (
      <span className={r.movement_type === 'اضافة' ? 'badge-green' : 'badge-red'}>
        {r.movement_type === 'اضافة' ? 'وارد' : 'منصرف'}
      </span>
    ),
  },
  { key: 'item_name',  header: 'الصنف', sortable: true, render: r => (
    <span className="font-medium text-brand-700 hover:underline cursor-pointer">
      {r.item_name ?? `#${r.item_code}`}
    </span>
  )},
  { key: 'unit',       header: 'الوحدة', width: '70px',  render: r => r.unit ?? '—' },
  { key: 'quantity',   header: 'الكمية', width: '80px',  sortable: true, render: r => num(r.quantity) },
  { key: 'unit_price', header: 'سعر الوحدة', width: '100px', sortable: true, render: r => egp(r.unit_price) },
  {
    key: 'qty_in', header: 'وارد / منصرف', width: '110px',
    render: r => r.qty_in
      ? <span className="text-green-700 font-medium">{num(r.qty_in)}</span>
      : <span className="text-red-600 font-medium">{num(r.qty_out)}</span>,
  },
  { key: 'balance_qty', header: 'رصيد الكمية', width: '100px', sortable: true,
    render: r => <span className="font-bold">{num(r.balance_qty)}</span> },
  { key: 'balance_value', header: 'قيمة الرصيد', width: '110px', sortable: true,
    render: r => <span className="font-bold text-brand-700">{egp(r.balance_value)}</span> },
  {
    key: 'field_name', header: 'الحقل', width: '110px',
    render: (r: InventoryMovement & { field_name?: string }) => r.field_name
      ? <span className="flex items-center gap-1 text-brand-700 text-xs font-medium"><Leaf size={11} />{r.field_name}</span>
      : <span className="text-slate-300">—</span>,
  },
  { key: 'work_order_id', header: 'أمر العمل', width: '120px',
    render: r => (r as InventoryMovement & { work_order_name?: string }).work_order_name
      ? <span className="text-amber-700 text-xs font-medium">{(r as InventoryMovement & { work_order_name?: string }).work_order_name}</span>
      : r.work_order_id ? <span className="text-slate-400 text-xs">#{r.work_order_id}</span> : <span className="text-slate-300">—</span>,
  },
  { key: 'document_number', header: 'المستند', width: '85px', render: r => r.document_number ?? '—' },
  { key: 'notes', header: 'ملاحظات', render: r => r.notes ?? '—' },
]

function thisMonthStart() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function today() { return new Date().toISOString().slice(0, 10) }

export default function InventoryMovementsPage() {
  const { canWrite } = usePermission()
  const navigate     = useNavigate()
  const [page,      setPage]      = useState(1)
  const [warehouse, setWarehouse] = useState('')
  const [movType,   setMovType]   = useState('')
  const [itemCode,  setItemCode]  = useState('')
  const [fieldId,      setFieldId]      = useState('')
  const [workOrderId,  setWorkOrderId]  = useState('')
  const [seasonId,     setSeasonId]     = useState('')
  const [startDate, setStart]     = useState(thisMonthStart())
  const [endDate,   setEnd]       = useState(today())
  const [addOpen,   setAddOpen]   = useState(false)
  const [sort,      setSort]      = useState<SortState | undefined>(undefined)

  const reset = () => {
    setWarehouse(''); setMovType(''); setItemCode(''); setFieldId(''); setWorkOrderId(''); setSeasonId('')
    setStart(thisMonthStart()); setEnd(today()); setPage(1); setSort(undefined)
  }
  const isDirty = warehouse || movType || itemCode || fieldId || workOrderId || seasonId || startDate !== thisMonthStart() || endDate !== today()

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn:  inventoryApi.warehouses,
  })
  const { data: items = [] } = useQuery({
    queryKey: ['config-items'],
    queryFn:  configApi.items,
  })
  const { data: fieldsList = [] } = useQuery({
    queryKey: ['fields', 'list'],
    queryFn:  () => fieldsApi.list() as Promise<{ id: number; name: string; code: string }[]>,
    staleTime: 120_000,
  })

  const { data: seasonsList = [] } = useQuery({
    queryKey: ['seasons'],
    queryFn:  configApi.seasons as () => Promise<{ id: number; name: string }[]>,
    staleTime: 120_000,
  })

  type WOOption = { id: number; name: string; operation_type: string }
  const { data: workOrdersList = [] } = useQuery({
    queryKey: ['operations', 'orders', 'all'],
    queryFn:  () => (operationsApi.listOrders({ size: 200 }) as Promise<{ data: WOOption[] }>)
      .then(r => r.data ?? []),
    staleTime: 60_000,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'movements', page, warehouse, movType, itemCode, fieldId, workOrderId, seasonId, startDate, endDate],
    queryFn:  () => inventoryApi.list({
      page, size: 100,
      warehouse:      warehouse     || undefined,
      type:           movType       || undefined,
      item_code:      itemCode      ? Number(itemCode)     : undefined,
      field_id:       fieldId       ? Number(fieldId)      : undefined,
      work_order_id:  workOrderId   ? Number(workOrderId)  : undefined,
      season_id:      seasonId      ? Number(seasonId)     : undefined,
      start:          startDate     || undefined,
      end:            endDate       || undefined,
    } as Parameters<typeof inventoryApi.list>[0]) as Promise<{ data: InventoryMovement[]; total: number; page: number; page_size: number; has_more: boolean }>,
  })

  const sortedData = useMemo(() => {
    const rows = data?.data ?? []
    if (!sort) return rows
    const k = sort.key as keyof InventoryMovement
    return [...rows].sort((a, b) => {
      const av = a[k] ?? ''
      const bv = b[k] ?? ''
      const cmp = typeof av === 'string' ? av.localeCompare(String(bv), 'ar') : Number(av) - Number(bv)
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [data, sort])

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">حركات المخزون</h1>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary gap-2"
            onClick={() => downloadCsv('/inventory/movements', 'حركات_المخزون', {
              warehouse: warehouse || undefined,
              type:      movType   || undefined,
            })}
          >
            <Download size={16} /> تصدير CSV
          </button>
          {canWrite('inventory') && (
            <button className="btn-primary gap-2" onClick={() => setAddOpen(true)}>
              <Plus size={16} />
              حركة جديدة
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <SlidersHorizontal size={16} className="text-slate-400 flex-shrink-0" />

          {/* Date range */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-500">من</label>
            <input
              type="date"
              className="input w-36"
              value={startDate}
              onChange={e => { setStart(e.target.value); setPage(1) }}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-500">إلى</label>
            <input
              type="date"
              className="input w-36"
              value={endDate}
              onChange={e => { setEnd(e.target.value); setPage(1) }}
            />
          </div>

          {/* Warehouse */}
          <select className="input w-40" value={warehouse} onChange={e => { setWarehouse(e.target.value); setPage(1) }}>
            <option value="">كل المخازن</option>
            {(warehouses ?? []).map(w => <option key={w} value={w}>{w}</option>)}
          </select>

          {/* Movement type */}
          <select className="input w-32" value={movType} onChange={e => { setMovType(e.target.value); setPage(1) }}>
            <option value="">كل الحركات</option>
            <option value="اضافة">وارد</option>
            <option value="صرف">منصرف</option>
          </select>

          {/* Item */}
          <select className="input w-44" value={itemCode} onChange={e => { setItemCode(e.target.value); setPage(1) }}>
            <option value="">كل الأصناف</option>
            {(items as { code: number; name: string }[]).map(i => (
              <option key={i.code} value={i.code}>{i.name}</option>
            ))}
          </select>

          {/* Field */}
          {fieldsList.length > 0 && (
            <select className="input w-44" value={fieldId} onChange={e => { setFieldId(e.target.value); setPage(1) }}>
              <option value="">كل الحقول</option>
              {fieldsList.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}

          {/* Season */}
          {seasonsList.length > 0 && (
            <select className="input w-40" value={seasonId} onChange={e => { setSeasonId(e.target.value); setPage(1) }}>
              <option value="">كل المواسم</option>
              {seasonsList.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}

          {/* Work order */}
          {workOrdersList.length > 0 && (
            <select className="input w-48" value={workOrderId} onChange={e => { setWorkOrderId(e.target.value); setPage(1) }}>
              <option value="">كل أوامر العمل</option>
              {(workOrdersList as WOOption[]).map(wo => (
                <option key={wo.id} value={wo.id}>{wo.name}</option>
              ))}
            </select>
          )}

          {isDirty && (
            <button className="btn-ghost text-sm" onClick={reset}>
              مسح الفلاتر
            </button>
          )}
          <div className="flex-1 text-left text-sm text-slate-400">
            {data ? `${(data?.total ?? 0).toLocaleString('en-US')} حركة` : ''}
          </div>
        </div>
      </div>

      <DataTable<InventoryMovement>
        columns={COLUMNS}
        data={sortedData}
        loading={isLoading}
        total={data?.total ?? 0}
        page={page}
        pageSize={100}
        onPage={setPage}
        rowKey={r => r.id}
        onRowClick={r => navigate(`/inventory/item/${r.item_code}`)}
        sort={sort}
        onSort={setSort}
        emptyText="لا توجد حركات مخزنية في هذه الفترة"
      />

      <AddInventoryBatchModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        defaultWarehouse={warehouse || undefined}
      />
    </div>
  )
}
