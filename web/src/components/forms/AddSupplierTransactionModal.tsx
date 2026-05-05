import { useState, useEffect } from 'react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import Modal from '../ui/Modal'
import { suppliersApi, configApi } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'

interface Props { open: boolean; onClose: () => void; supplierCode: number; supplierName: string }

const today = () => new Date().toISOString().slice(0, 10)

const DOCUMENT_TYPES = ['فاتورة', 'شيك', 'تحويل بنكي', 'نقداً', 'إيصال', 'أمر شراء', 'أخرى']
const UNITS = ['طن', 'كجم', 'فدان', 'لتر', 'عبوة', 'قطعة', 'كرتونة', 'متر', 'شيكارة']

export default function AddSupplierTransactionModal({ open, onClose, supplierCode, supplierName }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [form, setForm] = useState({
    transaction_date: today(),
    entry_type:       'م',
    amount:           '',
    document_type:    '',
    document_number:  '',
    expense_category: '',
    equipment_type_id: '',
    unit:             '',
    quantity:         '',
    unit_price:       '',
    notes:            '',
    season_id:        '',
    center_code:      '',
    status:           'draft' as 'draft' | 'posted',
  })

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setForm({
        transaction_date: today(), entry_type: 'م', amount: '',
        document_type: '', document_number: '', expense_category: '',
        equipment_type_id: '', unit: '', quantity: '', unit_price: '', notes: '',
        season_id: '', center_code: '', status: 'draft',
      })
      setError('')
    }
  }, [open])

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  // ─── Data Queries ──────────────────────────────────────────
  type SeasonOption = { id: number; name: string; status: string }
  const { data: seasons = [] } = useQuery({
    queryKey: ['config', 'seasons'],
    queryFn:  configApi.seasons as () => Promise<SeasonOption[]>,
    enabled:  open,
    staleTime: 120_000,
  })

  type ExpenseOption = { code: number; name: string }
  const { data: expenseTypes = [] } = useQuery({
    queryKey: ['config', 'expense_types'],
    queryFn:  configApi.expenseTypes as () => Promise<ExpenseOption[]>,
    enabled:  open,
    staleTime: 120_000,
  })

  type CostCenterOption = { code: number; name: string }
  const { data: costCenters = [] } = useQuery({
    queryKey: ['config', 'cc'],
    queryFn:  configApi.costCenters as () => Promise<CostCenterOption[]>,
    enabled:  open,
    staleTime: 120_000,
  })

  type EquipmentTypeOption = { id: number; code: string; name: string; asset_nature: string }
  const { data: equipmentTypes = [] } = useQuery({
    queryKey: ['config', 'equipment_types'],
    queryFn:  configApi.equipmentTypes as () => Promise<EquipmentTypeOption[]>,
    enabled:  open,
    staleTime: 120_000,
  })


  // Auto-compute amount from qty × price
  useEffect(() => {
    const qty = Number(form.quantity)
    const price = Number(form.unit_price)
    if (qty > 0 && price > 0) {
      set('amount', String(Math.round(qty * price * 100) / 100))
    }
  }, [form.quantity, form.unit_price])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.amount || Number(form.amount) <= 0) { setError('المبلغ مطلوب وأكبر من صفر'); return }
    if (form.status === 'posted' && !form.season_id) { setError('الموسم مطلوب عند الترحيل'); return }
    if (form.status === 'posted' && !form.center_code) { setError('مركز التكلفة مطلوب عند الترحيل'); return }

    setSaving(true)
    try {
      const res = await suppliersApi.addTransaction(supplierCode, {
        transaction_date: form.transaction_date,
        entry_type:       form.entry_type,
        amount:           Number(form.amount),
        document_type:    form.document_type || undefined,
        document_number:  form.document_number ? Number(form.document_number) : undefined,
        expense_category: form.expense_category || undefined,
        equipment_type_id: form.equipment_type_id ? Number(form.equipment_type_id) : undefined,
        unit:             form.unit || undefined,
        quantity:         form.quantity ? Number(form.quantity) : undefined,
        unit_price:       form.unit_price ? Number(form.unit_price) : undefined,
        notes:            form.notes.trim() || undefined,
        season_id:        form.season_id ? Number(form.season_id) : undefined,
        center_code:      form.center_code ? Number(form.center_code) : undefined,
        status:           form.status,
      })
      if (!(res as { success: boolean }).success) {
        setError((res as { error: string }).error ?? 'حدث خطأ')
        return
      }
      toast(
        form.status === 'draft'
          ? `تم حفظ المسودة — ${supplierName}`
          : `تم ترحيل القيد بنجاح — ${supplierName}`,
        'success'
      )
      await qc.invalidateQueries({ queryKey: ['supplier-statement', String(supplierCode)] })
      await qc.invalidateQueries({ queryKey: ['supplier', String(supplierCode)] })
      await qc.invalidateQueries({ queryKey: ['suppliers'] })
      onClose()
    } catch {
      setError('حدث خطأ في الاتصال')
    } finally {
      setSaving(false)
    }
  }

  const computedAmount = Number(form.quantity) > 0 && Number(form.unit_price) > 0
    ? (Number(form.quantity) * Number(form.unit_price))
    : null

  const egp = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(n)

  return (
    <Modal open={open} title={`إضافة قيد — ${supplierName}`} onClose={onClose} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">

        {/* ── Payment + Treasury integration notice ─────── */}
        {form.entry_type === 'م' && form.status === 'posted' && (
          <div className="flex gap-2 rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
            <div>
              <span className="font-semibold">تكامل الخزينة:</span> عند ترحيل دفعة مرحّلة، سيُسجَّل المبلغ تلقائياً
              في حركات الخزينة لضمان تطابق الأرصدة. لا حاجة لإعادة الإدخال في فورم الخزينة.
            </div>
          </div>
        )}

        {/* ── Row 1: Date + Entry Type + Status ──────────── */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">التاريخ <span className="text-red-500">*</span></label>
            <input type="date" className="input" value={form.transaction_date}
              onChange={e => set('transaction_date', e.target.value)} required />
          </div>
          <div>
            <label className="label">نوع القيد <span className="text-red-500">*</span></label>
            <select className="input" value={form.entry_type} onChange={e => set('entry_type', e.target.value)}>
              <option value="م">مدين (م) — عليه</option>
              <option value="د">دائن (د) — له</option>
            </select>
          </div>
          <div>
            <label className="label">الحالة</label>
            <select className="input" value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="draft">مسودة</option>
              <option value="posted">مرحّل</option>
            </select>
          </div>
        </div>

        {/* ── Row 2: Season + Cost Center ─────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">الموسم الزراعي {form.status === 'posted' && <span className="text-red-500">*</span>}</label>
            <select className="input" value={form.season_id}
              onChange={e => set('season_id', e.target.value)}>
              <option value="">— بدون موسم —</option>
              {(seasons || []).map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.status === 'active' ? ' ✓' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">مركز التكلفة {form.status === 'posted' && <span className="text-red-500">*</span>}</label>
            <select className="input" value={form.center_code}
              onChange={e => set('center_code', e.target.value)}>
              <option value="">— بدون مركز —</option>
              {(costCenters || []).map(cc => (
                <option key={cc.code} value={cc.code}>{cc.code} — {cc.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Row 3: Document + Equipment ───────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">نوع المستند</label>
            <select className="input" value={form.document_type}
              onChange={e => set('document_type', e.target.value)}>
              <option value="">— اختياري —</option>
              {DOCUMENT_TYPES.map(dt => (
                <option key={dt} value={dt}>{dt}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">نوع المعدة {form.entry_type === 'د' && <span className="text-amber-600 text-xs font-semibold">(رأسمالية)</span>}</label>
            <select className="input" value={form.equipment_type_id}
              onChange={e => set('equipment_type_id', e.target.value)}>
              <option value="">— بدون معدات —</option>
              {(equipmentTypes || []).map(et => (
                <option key={et.id} value={et.id}>
                  {et.name} {et.asset_nature === 'capital' ? '🔴' : '📦'}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label">رقم المستند</label>
          <input type="number" className="input" placeholder="—" value={form.document_number}
            onChange={e => set('document_number', e.target.value)} />
        </div>

        <div>
          <label className="label">بند المصروف / الخدمة</label>
          <select className="input" value={form.expense_category}
            onChange={e => set('expense_category', e.target.value)}>
            <option value="">— اختياري —</option>
            {(expenseTypes || []).map(et => (
              <option key={et.code} value={et.name}>{et.name}</option>
            ))}
          </select>
        </div>

        {/* ── Row 4: Qty × Price → Amount ─────────────────── */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">الكمية والسعر</span>
            {computedAmount !== null && (
              <span className="text-sm font-bold text-brand-700">
                الإجمالي: {egp(computedAmount)}
              </span>
            )}
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="label text-xs">الوحدة</label>
              <select className="input text-sm" value={form.unit} onChange={e => set('unit', e.target.value)}>
                <option value="">—</option>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs">الكمية</label>
              <input type="number" className="input text-sm" placeholder="0" min="0" step="0.001"
                value={form.quantity} onChange={e => set('quantity', e.target.value)} />
            </div>
            <div>
              <label className="label text-xs">سعر الوحدة</label>
              <input type="number" className="input text-sm" placeholder="0.00" min="0" step="0.01"
                value={form.unit_price} onChange={e => set('unit_price', e.target.value)} />
            </div>
            <div>
              <label className="label text-xs">المبلغ <span className="text-red-500">*</span></label>
              <input type="number" className="input text-sm font-semibold" placeholder="0.00" min="0.01" step="0.01"
                value={form.amount} onChange={e => set('amount', e.target.value)} required />
            </div>
          </div>
        </div>

        {/* ── Notes ───────────────────────────────────────── */}
        <div>
          <label className="label">ملاحظات</label>
          <textarea className="input" rows={2} placeholder="ملاحظات..." value={form.notes}
            onChange={e => set('notes', e.target.value)} />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {/* ── Actions ─────────────────────────────────────── */}
        <div className="flex gap-3 pt-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="submit" className="btn-primary flex-1" disabled={saving}>
            {saving ? 'جاري الحفظ...' : form.status === 'draft' ? 'حفظ كمسودة' : 'حفظ وترحيل'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
