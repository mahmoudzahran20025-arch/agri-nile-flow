import { useState, useCallback, useEffect, useMemo } from 'react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import {
  Plus, Trash2, AlertTriangle, CheckCircle,
  ChevronRight, ChevronLeft, Package, Warehouse, Info, Leaf, BookOpen,
} from 'lucide-react'
import Modal from '../ui/Modal'
import { inventoryApi, configApi, fieldsApi, operationsApi, suppliersApi } from '../../api/client'
import type { Item } from '../../types'

// ─── Types ────────────────────────────────────────────────────

interface LineItem {
  id:         string
  item_code:  string
  quantity:   string
  unit_price: string
  notes:      string
  // runtime
  available?: number
  item_name?: string
  item_unit?: string
  error?:     string
  loadingStock?: boolean
}

interface BatchForm {
  movement_date:   string
  movement_type:   'اضافة' | 'صرف'
  warehouse:       string
  supplier_code:   string
  document_number: string
  notes:           string
  season_id:       string
  field_id:        string
  work_order_id:   string
  center_code:     string
  payment_method:  'cash' | 'credit'
}

interface Props {
  open:              boolean
  onClose:           () => void
  defaultWarehouse?: string
}

// ─── Helpers ──────────────────────────────────────────────────

const today     = () => new Date().toISOString().slice(0, 10)
const uid       = () => Math.random().toString(36).slice(2, 9)
const newLine   = (): LineItem => ({ id: uid(), item_code: '', quantity: '', unit_price: '', notes: '' })

const EGP = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
const NUM = (n: number, dp = 3) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: dp }).format(n)

// ─── Step indicator ───────────────────────────────────────────

const STEPS = [
  { n: 1, label: 'بيانات الحركة' },
  { n: 2, label: 'الأصناف' },
  { n: 3, label: 'مراجعة وتأكيد' },
]

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center mb-6 select-none">
      {STEPS.map((s, idx) => (
        <div key={s.n} className="flex items-center flex-1 last:flex-none">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all
            ${current === s.n
              ? 'bg-brand-600 text-white shadow-sm'
              : current > s.n
              ? 'bg-green-500 text-white'
              : 'bg-slate-100 text-slate-400'
            }`}>
            <span className="w-5 h-5 rounded-full border border-current flex items-center justify-center text-xs font-bold shrink-0">
              {current > s.n ? '✓' : s.n}
            </span>
            <span className="hidden sm:inline">{s.label}</span>
          </div>
          {idx < STEPS.length - 1 && (
            <div className={`flex-1 h-0.5 mx-1.5 rounded transition-colors ${current > s.n ? 'bg-green-400' : 'bg-slate-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── GL Preview Panel (Step 3) ────────────────────────────────

interface GLPreviewPanelProps {
  warehouse:     string
  movementType:  'اضافة' | 'صرف'
  lines:         LineItem[]
  paymentMethod: 'cash' | 'credit'
  centerCode?:   number
}

function GLPreviewPanel({ warehouse, movementType, lines, paymentMethod, centerCode }: GLPreviewPanelProps) {
  const [expanded, setExpanded] = useState(false)

  // Preview the first non-zero line as a representative sample
  const sampleLine = useMemo(() => lines.find(l => l.item_code && Number(l.quantity) > 0), [lines])

  const totalValue = useMemo(() =>
    lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0),
  [lines])

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['gl-preview', warehouse, movementType, sampleLine?.item_code, sampleLine?.quantity, sampleLine?.unit_price, paymentMethod],
    queryFn: () => inventoryApi.glPreview({
      warehouse,
      item_code:      Number(sampleLine!.item_code),
      movement_type:  movementType,
      quantity:       Number(sampleLine!.quantity),
      unit_price:     sampleLine!.unit_price ? Number(sampleLine!.unit_price) : undefined,
      payment_method: paymentMethod,
      center_code:    centerCode,
    }),
    enabled: !!sampleLine && !!warehouse,
    staleTime: 30_000,
  })

  if (!sampleLine || !warehouse) return null

  const warnings = preview?.warnings ?? []
  const hasWarnings = warnings.length > 0

  return (
    <div className={`rounded-xl border ${hasWarnings ? 'border-amber-200 bg-amber-50' : 'border-indigo-200 bg-indigo-50'} p-3`}>
      <button
        type="button"
        className="w-full flex items-center gap-2 text-sm font-semibold"
        onClick={() => setExpanded(e => !e)}
      >
        <BookOpen size={14} className={hasWarnings ? 'text-amber-600' : 'text-indigo-600'} />
        <span className={hasWarnings ? 'text-amber-800' : 'text-indigo-800'}>
          القيد المحاسبي التلقائي {hasWarnings ? '⚠' : '✓'}
        </span>
        <span className="mr-auto text-xs font-normal opacity-70">
          {previewLoading ? 'جاري التحميل...' : expanded ? 'إخفاء ▲' : 'عرض ▼'}
        </span>
      </button>

      {expanded && !previewLoading && preview && (
        <div className="mt-3 space-y-2">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-100 rounded-lg px-2.5 py-1.5">
              <AlertTriangle size={11} className="shrink-0 mt-0.5" />
              {w}
            </div>
          ))}

          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-500 flex justify-between">
              <span>القيد المولَّد (نموذج — لكل صنف)</span>
              <span className={preview.is_balanced ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                {preview.is_balanced ? '✓ متوازن' : '✗ غير متوازن'}
              </span>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="px-3 py-1.5 text-right text-slate-400">الجانب</th>
                  <th className="px-3 py-1.5 text-right text-slate-400">الحساب</th>
                  <th className="px-3 py-1.5 text-right text-slate-400">البيان</th>
                  <th className="px-3 py-1.5 text-right text-slate-400">المبلغ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {preview.lines.map((line, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5">
                      <span className={`font-bold ${line.side === 'DR' ? 'text-blue-600' : 'text-red-600'}`}>
                        {line.side}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-slate-600">{line.account_code}</td>
                    <td className="px-3 py-1.5 text-slate-500 truncate max-w-[180px]">{line.account_label}</td>
                    <td className="px-3 py-1.5 font-semibold text-slate-700">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(line.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalValue > 0 && (
            <p className="text-xs text-indigo-700 bg-indigo-100 rounded-lg px-2.5 py-1.5">
              القيمة الكلية للدفعة: <strong>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(totalValue)}</strong>
              {' '}— سيتم إنشاء قيد مستقل لكل صنف
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────

export default function AddInventoryBatchModal({ open, onClose, defaultWarehouse }: Props) {
  const qc = useQueryClient()

  const [step,   setStep]   = useState<1 | 2 | 3>(1)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const [form, setForm] = useState<BatchForm>({
    movement_date:   today(),
    movement_type:   'اضافة',
    warehouse:       defaultWarehouse ?? '',
    supplier_code:   '',
    document_number: '',
    notes:           '',
    season_id:       '',
    field_id:        '',
    work_order_id:   '',
    center_code:     '',
    payment_method:  'credit',
  })

  const [lines, setLines] = useState<LineItem[]>([newLine()])

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setStep(1)
      setError('')
      setForm({
        movement_date:   today(),
        movement_type:   'اضافة',
        warehouse:       defaultWarehouse ?? '',
        supplier_code:   '',
        document_number: '',
        notes:           '',
        season_id:       '',
        field_id:        '',
        work_order_id:   '',
        center_code:     '',
        payment_method:  'credit',
      })
      setLines([newLine()])
    }
  }, [open, defaultWarehouse])

  // When warehouse changes, clear stock for all lines
  useEffect(() => {
    setLines(ls => ls.map(l => ({ ...l, available: undefined, error: undefined })))
  }, [form.warehouse])

  // ─── Data queries ──────────────────────────────────────────

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn:  inventoryApi.warehouses,
    enabled:  open,
    staleTime: 60_000,
  })

  const { data: items = [] } = useQuery({
    queryKey: ['config', 'items'],
    queryFn:  configApi.items as () => Promise<Item[]>,
    enabled:  open,
    staleTime: 60_000,
  })

  const { data: seasons = [] } = useQuery({
    queryKey: ['config', 'seasons'],
    queryFn:  configApi.seasons as () => Promise<{ id: number; name: string; status: string }[]>,
    enabled:  open,
    staleTime: 120_000,
  })

  const { data: fields = [] } = useQuery({
    queryKey: ['fields', 'list', form.season_id || null],
    queryFn:  () => fieldsApi.list(form.season_id ? { season_id: Number(form.season_id) } : undefined) as Promise<{ id: number; name: string; code: string; area_feddan: number }[]>,
    enabled:  open,
    staleTime: 60_000,
  })

  type WorkOrderItem = { id: number; name: string; operation_type: string; status: string }
  const { data: workOrders = [] } = useQuery({
    queryKey: ['operations', 'orders', form.season_id || null, form.field_id || null],
    queryFn:  () => operationsApi.listOrders({
      season_id: form.season_id ? Number(form.season_id) : undefined,
      field_id:  form.field_id  ? Number(form.field_id)  : undefined,
      size: 100,
    }) as Promise<{ data: WorkOrderItem[] }>,
    enabled:  open && form.movement_type === 'صرف',
    staleTime: 60_000,
    select: (res) => (res as { data: WorkOrderItem[] }).data ?? [],
  })

  type CostCenterOption = { code: number; name: string }
  const { data: costCenters = [] } = useQuery({
    queryKey: ['config', 'cc'],
    queryFn:  configApi.costCenters as () => Promise<CostCenterOption[]>,
    enabled:  open,
    staleTime: 120_000,
  })

  type SupplierOption = { code: number; name: string; activity?: string }
  const { data: suppliersList = [] } = useQuery({
    queryKey: ['suppliers-list-dropdown'],
    queryFn:  () => suppliersApi.list({ size: 200 }) as Promise<{ data: SupplierOption[] }>,
    enabled:  open && form.movement_type === 'اضافة',
    staleTime: 60_000,
    select: res => (res as unknown as { data: SupplierOption[] }).data ?? res,
  })

  // ─── Form helpers ──────────────────────────────────────────

  const setF = (k: keyof BatchForm, v: string) =>
    setForm(f => ({ ...f, [k]: v }))

  const updateLine = (id: string, patch: Partial<LineItem>) =>
    setLines(ls => ls.map(l => l.id === id ? { ...l, ...patch } : l))

  const addLine    = () => setLines(ls => [...ls, newLine()])
  const removeLine = (id: string) =>
    setLines(ls => ls.length > 1 ? ls.filter(l => l.id !== id) : ls)

  // Fetch stock when item + warehouse are selected
  const fetchStock = useCallback(async (lineId: string, itemCode: string) => {
    if (!itemCode || !form.warehouse) return
    updateLine(lineId, { loadingStock: true, available: undefined })
    try {
      const result = await inventoryApi.itemStock(Number(itemCode), form.warehouse)
      updateLine(lineId, { available: result.total_qty, loadingStock: false })
    } catch {
      updateLine(lineId, { loadingStock: false })
    }
  }, [form.warehouse])

  const handleItemChange = useCallback((lineId: string, itemCode: string) => {
    const info = items.find(i => String(i.code) === itemCode)
    updateLine(lineId, {
      item_code: itemCode,
      item_name: info?.name,
      item_unit: info?.unit ?? undefined,
      available: undefined,
      error:     undefined,
    })
    if (itemCode) fetchStock(lineId, itemCode)
  }, [items, fetchStock])

  // ─── Validation ────────────────────────────────────────────

  const validateLines = (): boolean => {
    let ok = true
    const updated = lines.map(l => {
      if (!l.item_code) return { ...l, error: 'اختر الصنف' }
      const qty = Number(l.quantity)
      if (!l.quantity || qty <= 0) return { ...l, error: 'الكمية مطلوبة وأكبر من صفر' }
      if (form.movement_type === 'صرف' && l.available !== undefined && qty > l.available) {
        ok = false
        return { ...l, error: `الرصيد المتاح: ${NUM(l.available)}` }
      }
      return { ...l, error: undefined }
    })
    setLines(updated)
    return ok && updated.every(l => !l.error)
  }

  // Check duplicates
  const hasDuplicates = () => {
    const codes = lines.filter(l => l.item_code).map(l => l.item_code)
    return codes.length !== new Set(codes).size
  }

  // ─── Navigation ────────────────────────────────────────────

  const goNext = () => {
    if (step === 1) {
      if (!form.movement_date || !form.warehouse) {
        setError('التاريخ والمخزن مطلوبان')
        return
      }
      setError(''); setStep(2)
    } else if (step === 2) {
      if (hasDuplicates()) {
        setError('يوجد أصناف مكررة في القائمة')
        return
      }
      if (!validateLines()) {
        setError('يوجد أخطاء في بعض الأصناف، راجع البنود المحددة بالأحمر')
        return
      }
      setError(''); setStep(3)
    }
  }

  const goBack = () => {
    setError('')
    if (step === 2) setStep(1)
    else if (step === 3) setStep(2)
  }

  // ─── Submit ────────────────────────────────────────────────

  const handleSubmit = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await inventoryApi.createBatch({
        movement_date:   form.movement_date,
        movement_type:   form.movement_type,
        warehouse:       form.warehouse,
        supplier_code:   form.supplier_code   ? Number(form.supplier_code)   : undefined,
        document_number: form.document_number ? Number(form.document_number) : undefined,
        season_id:       form.season_id       ? Number(form.season_id)       : undefined,
        field_id:        form.field_id        ? Number(form.field_id)        : undefined,
        work_order_id:   form.work_order_id   ? Number(form.work_order_id)   : undefined,
        payment_method:  form.payment_method,
        center_code:     form.center_code     ? Number(form.center_code)     : undefined,
        notes:           form.notes || undefined,
        items: lines.map(l => ({
          item_code:  Number(l.item_code),
          quantity:   Number(l.quantity),
          unit_price: l.unit_price ? Number(l.unit_price) : undefined,
          notes:      l.notes || undefined,
        })),
      })

      if (!(res as { success: boolean }).success) {
        setError((res as { error: string }).error ?? 'حدث خطأ')
        return
      }

      await qc.invalidateQueries({ queryKey: ['inventory'] })
      onClose()
    } catch {
      setError('حدث خطأ في الاتصال، تحقق من الشبكة وأعد المحاولة')
    } finally {
      setSaving(false)
    }
  }

  // ─── Computed ──────────────────────────────────────────────

  const filledLines  = lines.filter(l => l.item_code && Number(l.quantity) > 0)
  const totalQty     = filledLines.reduce((s, l) => s + Number(l.quantity), 0)
  const totalVal     = filledLines.reduce((s, l) => s + Number(l.quantity) * (Number(l.unit_price) || 0), 0)

  const typeIsAdd    = form.movement_type === 'اضافة'

  // ─── Render ────────────────────────────────────────────────

  return (
    <Modal open={open} title="حركة مخزنية جديدة" onClose={onClose} size="xl">
      <StepBar current={step} />

      {/* ───── STEP 1 : Movement header ──────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">

          {/* Movement type toggle */}
          <div>
            <label className="label mb-2">نوع الحركة <span className="text-red-500">*</span></label>
            <div className="grid grid-cols-2 gap-3">
              <button type="button"
                className={`flex flex-col items-center gap-1.5 p-4 rounded-xl border-2 font-medium transition-all
                  ${typeIsAdd
                    ? 'border-green-500 bg-green-50 text-green-700 shadow-sm'
                    : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'}`}
                onClick={() => setF('movement_type', 'اضافة')}>
                <span className="text-2xl">↓</span>
                <span className="text-sm">إضافة (وارد)</span>
                <span className="text-xs opacity-70">استلام بضاعة للمخزن</span>
              </button>
              <button type="button"
                className={`flex flex-col items-center gap-1.5 p-4 rounded-xl border-2 font-medium transition-all
                  ${!typeIsAdd
                    ? 'border-red-500 bg-red-50 text-red-700 shadow-sm'
                    : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'}`}
                onClick={() => setF('movement_type', 'صرف')}>
                <span className="text-2xl">↑</span>
                <span className="text-sm">صرف (منصرف)</span>
                <span className="text-xs opacity-70">إخراج بضاعة من المخزن</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">التاريخ <span className="text-red-500">*</span></label>
              <input type="date" className="input" value={form.movement_date}
                onChange={e => setF('movement_date', e.target.value)} required />
            </div>
            <div>
              <label className="label">المخزن <span className="text-red-500">*</span></label>
              {warehouses.length > 0 ? (
                <select className="input" value={form.warehouse}
                  onChange={e => setF('warehouse', e.target.value)} required>
                  <option value="">-- اختر المخزن --</option>
                  {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
                </select>
              ) : (
                <input className="input" placeholder="اسم المخزن" value={form.warehouse}
                  onChange={e => setF('warehouse', e.target.value)} required />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">رقم المستند</label>
              <input type="number" className="input" placeholder="اختياري"
                value={form.document_number}
                onChange={e => setF('document_number', e.target.value)} />
            </div>
            <div>
              <label className="label">المورد</label>
              {form.movement_type === 'اضافة' && (suppliersList as SupplierOption[]).length > 0 ? (
                <select className="input" value={form.supplier_code}
                  onChange={e => setF('supplier_code', e.target.value)}>
                  <option value="">— اختياري —</option>
                  {(suppliersList as SupplierOption[]).map(s => (
                    <option key={s.code} value={s.code}>
                      {s.name}{s.activity ? ` (${s.activity})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input type="number" className="input" placeholder="كود المورد (اختياري)"
                  value={form.supplier_code}
                  onChange={e => setF('supplier_code', e.target.value)} />
              )}
            </div>
          </div>

          {/* Payment Method (for Additions only) */}
          {typeIsAdd && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <label className="label text-xs mb-2">طريقة الدفع للمخزون</label>
              <div className="flex gap-2">
                <button type="button"
                  className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-all flex items-center justify-center gap-2
                    ${form.payment_method === 'credit'
                      ? 'bg-white border-brand-500 text-brand-700 shadow-sm'
                      : 'bg-transparent border-slate-200 text-slate-400 hover:border-slate-300'}`}
                  onClick={() => setF('payment_method', 'credit')}>
                  <span>💳 آجل (على حساب المورد)</span>
                </button>
                <button type="button"
                  className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-all flex items-center justify-center gap-2
                    ${form.payment_method === 'cash'
                      ? 'bg-white border-green-500 text-green-700 shadow-sm'
                      : 'bg-transparent border-slate-200 text-slate-400 hover:border-slate-300'}`}
                  onClick={() => setF('payment_method', 'cash')}>
                  <span>💵 نقدي (من الخزينة)</span>
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-2 px-1">
                {form.payment_method === 'cash'
                  ? 'سيتم خصم قيمة المشتريات من رصيد الخزينة مباشرة.'
                  : 'سيتم إضافة القيمة لمديونية المورد وسحبها لاحقاً عبر سداد الموردين.'}
              </p>
            </div>
          )}

          {/* Season + Field — Agricultural Context */}
          <div className="rounded-xl border border-brand-100 bg-brand-50 p-3 space-y-3">
            <div className="flex items-center gap-2 text-brand-700 text-xs font-semibold">
              <Leaf size={13} />
              السياق الزراعي (اختياري)
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label text-xs">الموسم الزراعي</label>
                <select className="input text-sm" value={form.season_id}
                  onChange={e => { setF('season_id', e.target.value); setF('field_id', ''); setF('work_order_id', '') }}>
                  <option value="">— بدون موسم —</option>
                  {(seasons as { id: number; name: string; status: string }[]).map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.status === 'active' ? ' ✓' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label text-xs">الأرض / الحقل</label>
                <select className="input text-sm" value={form.field_id}
                  onChange={e => { setF('field_id', e.target.value); setF('work_order_id', '') }}>
                  <option value="">— بدون حقل —</option>
                  {(fields as { id: number; name: string; code: string; area_feddan: number }[]).map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.area_feddan} فدان)
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {!typeIsAdd && (
              <div>
                <label className="label text-xs">أمر العمل</label>
                <select className="input text-sm" value={form.work_order_id}
                  onChange={e => setF('work_order_id', e.target.value)}>
                  <option value="">— بدون أمر عمل —</option>
                  {(workOrders as WorkOrderItem[]).filter(wo => !['cancelled', 'costed'].includes(wo.status)).map(wo => (
                    <option key={wo.id} value={wo.id}>
                      {wo.name} — {wo.operation_type}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="label text-xs">مركز التكلفة</label>
              <select className="input text-sm" value={form.center_code}
                onChange={e => setF('center_code', e.target.value)}>
                <option value="">— بدون مركز —</option>
                {(costCenters as CostCenterOption[]).map(cc => (
                  <option key={cc.code} value={cc.code}>{cc.code} — {cc.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">ملاحظات عامة</label>
            <input type="text" className="input" placeholder="تُطبَّق على كل الأصناف (اختياري)"
              value={form.notes}
              onChange={e => setF('notes', e.target.value)} />
          </div>
        </div>
      )}

      {/* ───── STEP 2 : Line items ────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-3">
          {/* Context bar */}
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-slate-500">
                <Warehouse size={14} />
                <span className="font-semibold text-slate-700">{form.warehouse}</span>
              </span>
              <span className={`font-semibold ${typeIsAdd ? 'text-green-600' : 'text-red-600'}`}>
                {typeIsAdd ? '↓ إضافة' : '↑ صرف'}
              </span>
              <span className="text-slate-400">{form.movement_date}</span>
            </div>
            <button type="button"
              className="btn-secondary text-xs gap-1 py-1.5 px-3"
              onClick={addLine}>
              <Plus size={13} /> إضافة صنف
            </button>
          </div>

          {/* Column headers */}
          <div className="grid text-xs font-semibold text-slate-400 uppercase tracking-wide px-2"
            style={{ gridTemplateColumns: '2fr 90px 100px 120px 28px' }}>
            <span>الصنف</span>
            <span className="text-center">الكمية</span>
            <span className="text-center">سعر الوحدة</span>
            <span className="text-center">{!typeIsAdd ? 'الرصيد المتاح' : 'ملاحظة'}</span>
            <span></span>
          </div>

          {/* Lines */}
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {lines.map((line) => {
              const qty       = Number(line.quantity) || 0
              const hasErr    = !!line.error
              const stockWarn = !typeIsAdd && line.available !== undefined && qty > line.available
              return (
                <div key={line.id}
                  className={`grid gap-2 items-start p-2.5 rounded-xl border transition-colors
                    ${hasErr ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50 hover:bg-white'}`}
                  style={{ gridTemplateColumns: '2fr 90px 100px 120px 28px' }}>

                  {/* Item selector */}
                  <div>
                    <select
                      className={`input text-sm py-1.5 w-full ${hasErr && !line.item_code ? 'border-red-400' : ''}`}
                      value={line.item_code}
                      onChange={e => handleItemChange(line.id, e.target.value)}>
                      <option value="">-- اختر الصنف --</option>
                      {items.map(i => (
                        <option key={i.code} value={i.code}>
                          {i.name}{i.unit ? ` (${i.unit})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Quantity */}
                  <input
                    type="number" min="0.001" step="any"
                    className={`input text-sm py-1.5 text-center
                      ${stockWarn ? 'border-red-400 bg-red-50' : ''}`}
                    placeholder="0"
                    value={line.quantity}
                    onChange={e => updateLine(line.id, { quantity: e.target.value, error: undefined })} />

                  {/* Unit price */}
                  <input
                    type="number" min="0" step="any"
                    className="input text-sm py-1.5 text-center"
                    placeholder="سعر الوحدة"
                    value={line.unit_price}
                    onChange={e => updateLine(line.id, { unit_price: e.target.value })} />

                  {/* Stock info / notes */}
                  <div className="text-xs pt-1.5">
                    {!typeIsAdd && line.item_code && (
                      <div className={`flex items-center gap-1 font-medium
                        ${line.loadingStock ? 'text-slate-400' : (line.available ?? 0) > 0 ? 'text-slate-600' : 'text-red-600'}`}>
                        <Package size={11} />
                        {line.loadingStock
                          ? <span>جاري...</span>
                          : line.available !== undefined
                          ? <span>{NUM(line.available)} {line.item_unit ?? ''}</span>
                          : <span className="text-slate-400">—</span>
                        }
                      </div>
                    )}
                    {typeIsAdd && (
                      <input type="text" className="input text-xs py-1 w-full"
                        placeholder="ملاحظة الصنف"
                        value={line.notes}
                        onChange={e => updateLine(line.id, { notes: e.target.value })} />
                    )}
                    {line.error && (
                      <div className="text-red-600 flex items-center gap-0.5 mt-0.5">
                        <AlertTriangle size={10} className="shrink-0" />
                        <span>{line.error}</span>
                      </div>
                    )}
                  </div>

                  {/* Remove */}
                  <button type="button"
                    className="p-1 text-slate-300 hover:text-red-500 transition-colors mt-1.5 rounded"
                    onClick={() => removeLine(line.id)}
                    disabled={lines.length === 1}
                    title="حذف هذا الصنف">
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>

          {/* Summary bar */}
          <div className="flex items-center justify-between bg-brand-50 border border-brand-200 rounded-xl px-4 py-2.5 text-sm">
            <span className="text-slate-600">
              الأصناف: <span className="font-bold text-slate-800">{filledLines.length} / {lines.length}</span>
            </span>
            <span className="text-slate-600">
              الكمية الكلية: <span className="font-bold text-slate-800">{NUM(totalQty)}</span>
            </span>
            {totalVal > 0 && (
              <span className="text-slate-600">
                القيمة: <span className="font-bold text-brand-700">{EGP(totalVal)}</span>
              </span>
            )}
          </div>

          {hasDuplicates() && (
            <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-sm">
              <Info size={15} />
              تحذير: يوجد أصناف مكررة في القائمة
            </div>
          )}
        </div>
      )}

      {/* ───── STEP 3 : Review ────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-4">
          {/* Header summary card */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <h3 className="font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <Warehouse size={15} /> ملخص الحركة
            </h3>
            <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
              <div className="flex gap-2">
                <span className="text-slate-500">التاريخ:</span>
                <span className="font-medium">{form.movement_date}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-slate-500">النوع:</span>
                <span className={`font-bold ${typeIsAdd ? 'text-green-600' : 'text-red-600'}`}>
                  {typeIsAdd ? '↓ إضافة (وارد)' : '↑ صرف (منصرف)'}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="text-slate-500">المخزن:</span>
                <span className="font-medium">{form.warehouse}</span>
              </div>
              {form.document_number && (
                <div className="flex gap-2">
                  <span className="text-slate-500">المستند:</span>
                  <span className="font-medium">#{form.document_number}</span>
                </div>
              )}
              {form.supplier_code && (
                <div className="flex gap-2">
                  <span className="text-slate-500">المورد:</span>
                  <span className="font-medium">#{form.supplier_code}</span>
                </div>
              )}
              {typeIsAdd && (
                <div className="flex gap-2">
                  <span className="text-slate-500">طريقة الدفع:</span>
                  <span className={`font-bold ${form.payment_method === 'cash' ? 'text-green-600' : 'text-brand-600'}`}>
                    {form.payment_method === 'cash' ? '💵 نقدي' : '💳 آجل'}
                  </span>
                </div>
              )}
              {form.season_id && (
                <div className="flex gap-2">
                  <span className="text-slate-500">الموسم:</span>
                  <span className="font-medium text-brand-700">
                    {(seasons as { id: number; name: string }[]).find(s => String(s.id) === form.season_id)?.name ?? `#${form.season_id}`}
                  </span>
                </div>
              )}
              {form.field_id && (
                <div className="flex gap-2">
                  <span className="text-slate-500">الحقل:</span>
                  <span className="font-medium text-brand-700 flex items-center gap-1">
                    <Leaf size={12} />
                    {(fields as { id: number; name: string }[]).find(f => String(f.id) === form.field_id)?.name ?? `#${form.field_id}`}
                  </span>
                </div>
              )}
              {form.work_order_id && (
                <div className="flex gap-2">
                  <span className="text-slate-500">أمر العمل:</span>
                  <span className="font-medium text-amber-700">
                    {(workOrders as WorkOrderItem[]).find(wo => String(wo.id) === form.work_order_id)?.name ?? `#${form.work_order_id}`}
                  </span>
                </div>
              )}
              {form.notes && (
                <div className="col-span-2 flex gap-2">
                  <span className="text-slate-500">ملاحظات:</span>
                  <span>{form.notes}</span>
                </div>
              )}
            </div>
          </div>

          {/* Items table */}
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="text-right py-2 px-3 text-slate-600 font-semibold">#</th>
                  <th className="text-right py-2 px-3 text-slate-600 font-semibold">الصنف</th>
                  <th className="text-right py-2 px-3 text-slate-600 font-semibold">الكمية</th>
                  <th className="text-right py-2 px-3 text-slate-600 font-semibold">سعر الوحدة</th>
                  <th className="text-right py-2 px-3 text-slate-600 font-semibold">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {filledLines.map((line, idx) => {
                  const item  = items.find(i => String(i.code) === line.item_code)
                  const qty   = Number(line.quantity)
                  const price = Number(line.unit_price) || 0
                  return (
                    <tr key={line.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="py-2 px-3 text-slate-400 text-center">{idx + 1}</td>
                      <td className="py-2 px-3 font-medium">
                        {item?.name ?? `#${line.item_code}`}
                        {item?.unit ? <span className="text-slate-400 text-xs mr-1">({item.unit})</span> : null}
                      </td>
                      <td className="py-2 px-3">{NUM(qty)}</td>
                      <td className="py-2 px-3 text-slate-500">{price > 0 ? EGP(price) : '—'}</td>
                      <td className="py-2 px-3 font-semibold text-brand-700">
                        {price > 0 ? EGP(qty * price) : '—'}
                      </td>
                    </tr>
                  )
                })}
                {/* Totals */}
                <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold">
                  <td colSpan={2} className="py-2.5 px-3 text-slate-700">
                    الإجمالي ({filledLines.length} صنف)
                  </td>
                  <td className="py-2.5 px-3">{NUM(totalQty)}</td>
                  <td></td>
                  <td className="py-2.5 px-3 text-brand-700">
                    {totalVal > 0 ? EGP(totalVal) : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* GL Preview Panel */}
          <GLPreviewPanel
            warehouse={form.warehouse}
            movementType={form.movement_type as 'اضافة' | 'صرف'}
            lines={filledLines}
            paymentMethod={form.payment_method as 'cash' | 'credit'}
            centerCode={form.center_code ? Number(form.center_code) : undefined}
          />

          <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
            <CheckCircle size={16} className="shrink-0" />
            <span>
              جاهز للحفظ — سيتم إنشاء <strong>{filledLines.length}</strong> حركة مخزنية
              {typeIsAdd ? ' (إضافة)' : ' (صرف)'}
              {' '}في مخزن <strong>{form.warehouse}</strong>
            </span>
          </div>
        </div>
      )}

      {/* ───── Error message ─────────────────────────────────── */}
      {error && (
        <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* ───── Footer navigation ─────────────────────────────── */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100">
        <div>
          {step > 1 && (
            <button type="button" className="btn-secondary gap-1.5" onClick={goBack} disabled={saving}>
              <ChevronRight size={15} /> السابق
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            إلغاء
          </button>
          {step < 3 ? (
            <button type="button" className="btn-primary gap-1.5" onClick={goNext}>
              التالي <ChevronLeft size={15} />
            </button>
          ) : (
            <button type="button"
              className={`btn-primary gap-2 ${typeIsAdd ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
              onClick={handleSubmit}
              disabled={saving}>
              {saving
                ? <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span> جاري الحفظ...</>
                : <><CheckCircle size={15} /> تأكيد الحفظ ({filledLines.length} صنف)</>
              }
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
