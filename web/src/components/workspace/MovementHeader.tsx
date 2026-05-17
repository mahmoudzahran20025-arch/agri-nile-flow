import { useQuery } from '@tanstack/react-query'
import { inventoryApi, suppliersApi } from '../../api/client'
import {
  type MovementHeader,
  type MovementType,
  MOVEMENT_TYPES,
  isSupplierType,
  isTransferType,
} from './types'

// ─── Subcomponents ───────────────────────────────────────────────────────────

function MovementTypeSelector({
  value,
  onChange,
}: {
  value: MovementType
  onChange: (t: MovementType) => void
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {MOVEMENT_TYPES.map(mt => {
        const active = value === mt.value
        const inbound = mt.isIn
        return (
          <button
            key={mt.value}
            type="button"
            onClick={() => onChange(mt.value)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border-2 text-[12px] font-bold transition-all ${
              active
                ? inbound
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                  : 'border-red-400 bg-red-50 text-red-800'
                : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <span className="text-base leading-none">{mt.icon}</span>
            <span>{mt.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface Props {
  header:    MovementHeader
  onChange:  (patch: Partial<MovementHeader>) => void
}

export default function MovementHeaderPanel({ header, onChange }: Props) {
  // Use warehousesSetup to get IDs
  const { data: whResponse } = useQuery({
    queryKey: ['warehousesSetup'],
    queryFn:  inventoryApi.warehousesSetup,
    staleTime: 120_000,
  })
  
  const warehouses = (whResponse as any)?.entities || []

  const showSupplier = isSupplierType(header.movement_type)
  const showTransfer = isTransferType(header.movement_type)

  type SupplierOption = { code: number; name: string; activity?: string }
  const { data: suppliersList = [] } = useQuery({
    queryKey: ['suppliers-list-dropdown'],
    queryFn:  () => suppliersApi.list({ size: 200 }) as Promise<{ data: SupplierOption[] }>,
    enabled:  showSupplier,
    staleTime: 120_000,
    select: (res: unknown) => ((res as { data: SupplierOption[] }).data ?? res) as SupplierOption[],
  })

  const showPayment = isSupplierType(header.movement_type)

  return (
    <div className="bg-white border-b border-slate-200 px-6 py-4 space-y-4 shrink-0">
      {/* Row 1: Movement type selector */}
      <MovementTypeSelector
        value={header.movement_type}
        onChange={t => onChange({
          movement_type: t,
          // Reset fields when switching types
          supplier_code: isSupplierType(t) ? header.supplier_code : null,
          target_warehouse_id: isTransferType(t) ? header.target_warehouse_id : null,
        })}
      />

      {/* Row 2: Core fields */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 items-end">
        {/* Date */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">
            التاريخ <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            className="input text-sm w-full"
            value={header.movement_date}
            onChange={e => onChange({ movement_date: e.target.value })}
          />
        </div>

        {/* Source Warehouse */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">
            {header.movement_type === 'TRANSFER_IN' ? 'مخزن الوصول' : 'المخزن (المصدر)'} <span className="text-red-500">*</span>
          </label>
          <select
            className="input text-sm w-full"
            value={header.warehouse_id ?? ''}
            onChange={e => onChange({ warehouse_id: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">— اختر المخزن —</option>
            {warehouses.map((w: any) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>

        {/* Target Warehouse (conditional) */}
        {showTransfer && (
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              {header.movement_type === 'TRANSFER_IN' ? 'من مخزن' : 'إلى مخزن'} <span className="text-red-500">*</span>
            </label>
            <select
              className="input text-sm w-full"
              value={header.target_warehouse_id ?? ''}
              onChange={e => onChange({ target_warehouse_id: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">— اختر المخزن الوجهة —</option>
              {warehouses.map((w: any) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Supplier (conditional) */}
        {showSupplier && (
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              المورد
            </label>
            <select
              className="input text-sm w-full"
              value={header.supplier_code ?? ''}
              onChange={e => onChange({ supplier_code: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">— اختياري —</option>
              {suppliersList.map((s: SupplierOption) => (
                <option key={s.code} value={s.code}>
                  {s.name}{s.activity ? ` (${s.activity})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Document number */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">
            {header.movement_type === 'RETURN_SUPPLIER' ? 'رقم GRN الأصلي' : 'رقم المستند'}
          </label>
          <input
            type="text"
            className="input text-sm w-full"
            placeholder="اختياري"
            value={header.document_number}
            onChange={e => onChange({ document_number: e.target.value })}
          />
        </div>

        {/* Payment method (conditional) */}
        {showPayment && (
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              طريقة الدفع
            </label>
            <div className="flex gap-1">
              {([
                { v: 'credit' as const, label: '💳 آجل',  cls: 'border-blue-500 bg-blue-50 text-blue-800' },
                { v: 'cash'   as const, label: '💵 نقدي', cls: 'border-emerald-500 bg-emerald-50 text-emerald-800' },
              ]).map(pm => (
                <button
                  key={pm.v}
                  type="button"
                  onClick={() => onChange({ payment_method: pm.v })}
                  className={`flex-1 py-1.5 px-2 rounded-lg border text-[11px] font-bold transition-all ${
                    header.payment_method === pm.v
                      ? pm.cls
                      : 'border-slate-200 text-slate-400 hover:border-slate-300'
                  }`}
                >
                  {pm.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div className={(showPayment || showTransfer) ? '' : 'md:col-span-2'}>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">
            ملاحظات عامة
          </label>
          <input
            type="text"
            className="input text-sm w-full"
            placeholder="تُطبَّق على كل الأصناف"
            value={header.notes}
            onChange={e => onChange({ notes: e.target.value })}
          />
        </div>
      </div>
    </div>
  )
}
