import { useState, useEffect } from 'react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { Users, Briefcase, Receipt } from 'lucide-react'
import Modal from '../ui/Modal'
import { treasuryApi, suppliersApi, configApi, employeesApi } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'

interface Props { open: boolean; onClose: () => void }

type BeneficiaryType = 'supplier' | 'employee' | 'general'

const today = () => new Date().toISOString().slice(0, 10)

const BENEFICIARY_TYPES: { value: BeneficiaryType; label: string; icon: React.ReactNode; desc: string }[] = [
  { value: 'supplier', label: 'مورد',        icon: <Users size={18} />,     desc: 'صرف أو تحصيل من مورد/عميل' },
  { value: 'employee', label: 'موظف',        icon: <Briefcase size={18} />, desc: 'سلفة أو صرف لموظف' },
  { value: 'general',  label: 'مصروف عام',   icon: <Receipt size={18} />,   desc: 'إيجار، مرافق، مصروفات أخرى' },
]

const DOCUMENT_TYPES = ['فاتورة', 'شيك', 'تحويل بنكي', 'نقداً', 'إيصال', 'أخرى']

export default function AddCashTransactionModal({ open, onClose }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [saving, setSaving]   = useState(false)
  const [error,  setError]    = useState('')
  const [form, setForm] = useState({
    transaction_date: today(),
    direction:        'م',
    narration:        '',
    amount:           '',
    document_number:  '',
    document_type:    '',
    recipient_name:   '',
    notes:            '',
    supplier_code:    '',
    season_id:        '',
    expense_code:     '',
    unit:             '',
    quantity:         '',
    unit_price:       '',
    status:           'draft' as 'draft' | 'posted',
  })
  const [beneficiaryType, setBeneficiaryType] = useState<BeneficiaryType>('supplier')

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setForm({
        transaction_date: today(), direction: 'م', narration: '', amount: '',
        document_number: '', document_type: '', recipient_name: '', notes: '',
        supplier_code: '', season_id: '', expense_code: '',
        unit: '', quantity: '', unit_price: '', status: 'draft',
      })
      setBeneficiaryType('supplier')
      setError('')
    }
  }, [open])

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  // ─── Data Queries ──────────────────────────────────────────
  type SupplierOption = { code: number; name: string; activity?: string }
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-list-dropdown'],
    queryFn:  () => suppliersApi.list({ size: 200 }) as Promise<{ data: SupplierOption[] }>,
    enabled:  open && beneficiaryType === 'supplier',
    staleTime: 60_000,
    select: res => (res as unknown as { data: SupplierOption[] }).data ?? res,
  })

  type EmployeeOption = { id: number; name: string; job_title?: string }
  const { data: employees = [] } = useQuery({
    queryKey: ['employees-dropdown'],
    queryFn:  () => employeesApi.list() as Promise<EmployeeOption[]>,
    enabled:  open && beneficiaryType === 'employee',
    staleTime: 60_000,
  })

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

  // Auto-fill recipient name when supplier changes
  useEffect(() => {
    if (beneficiaryType === 'supplier' && form.supplier_code) {
      const sup = (suppliers as SupplierOption[]).find(s => String(s.code) === form.supplier_code)
      if (sup) set('recipient_name', sup.name)
    }
  }, [form.supplier_code, suppliers, beneficiaryType])

  // Auto-fill recipient name when employee selected
  useEffect(() => {
    if (beneficiaryType === 'employee' && form.supplier_code) {
      const emp = (employees as EmployeeOption[]).find(e => String(e.id) === form.supplier_code)
      if (emp) set('recipient_name', emp.name)
    }
  }, [form.supplier_code, employees, beneficiaryType])

  // Auto-compute amount from qty × price
  useEffect(() => {
    const qty = Number(form.quantity)
    const price = Number(form.unit_price)
    if (qty > 0 && price > 0) {
      set('amount', String(qty * price))
    }
  }, [form.quantity, form.unit_price])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.narration.trim() || !form.amount) { setError('البيان والمبلغ مطلوبان'); return }
    if (Number(form.amount) <= 0) { setError('المبلغ يجب أن يكون أكبر من صفر'); return }

    setSaving(true)
    try {
      const res = await treasuryApi.create({
        transaction_date: form.transaction_date,
        direction:        form.direction,
        narration:        form.narration.trim(),
        amount:           Number(form.amount),
        document_number:  form.document_number ? Number(form.document_number) : undefined,
        recipient_name:   form.recipient_name.trim() || undefined,
        notes:            form.notes.trim() || undefined,
        supplier_code:    beneficiaryType === 'supplier' && form.supplier_code
                            ? Number(form.supplier_code) : undefined,
        season_id:        form.season_id ? Number(form.season_id) : undefined,
        expense_code:     form.expense_code ? Number(form.expense_code) : undefined,
        unit:             form.unit.trim() || undefined,
        quantity:         form.quantity ? Number(form.quantity) : undefined,
        unit_price:       form.unit_price ? Number(form.unit_price) : undefined,
        status:           form.status,
      })
      if (!(res as { success: boolean }).success) {
        setError((res as { error: string }).error ?? 'حدث خطأ')
        return
      }
      const data = (res as { data?: { gl_entry_id?: number; running_balance?: number } }).data
      const glMsg = data?.gl_entry_id ? ` — قيد GL #${data.gl_entry_id}` : ''
      toast(
        form.status === 'draft'
          ? `تم حفظ المسودة بنجاح`
          : `تم ترحيل الحركة بنجاح${glMsg}`,
        'success'
      )
      await qc.invalidateQueries({ queryKey: ['treasury'] })
      onClose()
    } catch {
      setError('حدث خطأ في الاتصال')
    } finally {
      setSaving(false)
    }
  }

  const computedAmount = Number(form.quantity) > 0 && Number(form.unit_price) > 0
    ? (Number(form.quantity) * Number(form.unit_price)).toLocaleString('ar-EG', { style: 'currency', currency: 'EGP' })
    : null

  return (
    <Modal open={open} title="إضافة حركة خزينة" onClose={onClose} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">

        {/* ── Row 1: Date + Direction + Status ────────────── */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">التاريخ <span className="text-red-500">*</span></label>
            <input type="date" className="input" value={form.transaction_date}
              onChange={e => set('transaction_date', e.target.value)} required />
          </div>
          <div>
            <label className="label">الاتجاه <span className="text-red-500">*</span></label>
            <select className="input" value={form.direction} onChange={e => set('direction', e.target.value)}>
              <option value="م">↑ منصرف (م)</option>
              <option value="د">↓ وارد (د)</option>
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

        {/* ── Beneficiary Type Toggle ─────────────────────── */}
        <div>
          <label className="label mb-2">نوع المستفيد</label>
          <div className="grid grid-cols-3 gap-2">
            {BENEFICIARY_TYPES.map(bt => (
              <button key={bt.value} type="button"
                className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 text-sm font-medium transition-all
                  ${beneficiaryType === bt.value
                    ? 'border-brand-500 bg-brand-50 text-brand-700 shadow-sm'
                    : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'}`}
                onClick={() => {
                  setBeneficiaryType(bt.value)
                  set('supplier_code', '')
                  set('recipient_name', '')
                }}>
                {bt.icon}
                <span>{bt.label}</span>
                <span className="text-[10px] opacity-70 leading-tight">{bt.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Beneficiary Details ─────────────────────────── */}
        {beneficiaryType === 'supplier' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">المورد / العميل</label>
              <select className="input" value={form.supplier_code}
                onChange={e => set('supplier_code', e.target.value)}>
                <option value="">— اختر المورد —</option>
                {(suppliers as SupplierOption[]).map(s => (
                  <option key={s.code} value={s.code}>
                    {s.name}{s.activity ? ` (${s.activity})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">اسم المستلم / المسلم</label>
              <input className="input" placeholder="يتم تعبئته تلقائياً..."
                value={form.recipient_name}
                onChange={e => set('recipient_name', e.target.value)} />
            </div>
          </div>
        )}

        {beneficiaryType === 'employee' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">الموظف</label>
              <select className="input" value={form.supplier_code}
                onChange={e => set('supplier_code', e.target.value)}>
                <option value="">— اختر الموظف —</option>
                {(employees as EmployeeOption[]).map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}{emp.job_title ? ` — ${emp.job_title}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">اسم المستلم</label>
              <input className="input" placeholder="يتم تعبئته تلقائياً..."
                value={form.recipient_name}
                onChange={e => set('recipient_name', e.target.value)} />
            </div>
          </div>
        )}

        {beneficiaryType === 'general' && (
          <div>
            <label className="label">اسم المستفيد / الجهة <span className="text-red-500">*</span></label>
            <input className="input" placeholder="مثال: شركة الكهرباء، إيجار، نقل..."
              value={form.recipient_name}
              onChange={e => set('recipient_name', e.target.value)} required />
          </div>
        )}

        {/* ── Narration ──────────────────────────────────── */}
        <div>
          <label className="label">البيان <span className="text-red-500">*</span></label>
          <input className="input" placeholder="وصف الحركة..." value={form.narration}
            onChange={e => set('narration', e.target.value)} required />
        </div>

        {/* ── Season + Expense Type ──────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">الموسم الزراعي</label>
            <select className="input" value={form.season_id}
              onChange={e => set('season_id', e.target.value)}>
              <option value="">— بدون موسم —</option>
              {(seasons as SeasonOption[]).map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.status === 'active' ? ' ✓' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">بند المصروف</label>
            <select className="input" value={form.expense_code}
              onChange={e => set('expense_code', e.target.value)}>
              <option value="">— بدون تصنيف —</option>
              {(expenseTypes as ExpenseOption[]).map(et => (
                <option key={et.code} value={et.code}>{et.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Amount + Document ───────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">المبلغ <span className="text-red-500">*</span></label>
            <input type="number" className="input font-semibold text-lg" placeholder="0.00" min="0.01" step="0.01"
              value={form.amount} onChange={e => set('amount', e.target.value)} required />
          </div>
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
            <label className="label">رقم المستند</label>
            <input type="number" className="input" placeholder="—" value={form.document_number}
              onChange={e => set('document_number', e.target.value)} />
          </div>
        </div>

        {/* ── Qty × Price (collapsible detail) ────────────── */}
        <details className="group rounded-xl border border-slate-200 bg-slate-50">
          <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer text-sm text-slate-500 hover:text-slate-700 select-none">
            <span className="text-xs font-semibold uppercase tracking-wide">تفاصيل الكمية والسعر</span>
            {computedAmount && (
              <span className="mr-auto text-xs font-medium text-brand-600">
                = {computedAmount}
              </span>
            )}
          </summary>
          <div className="grid grid-cols-3 gap-3 p-3 pt-2 border-t border-slate-200">
            <div>
              <label className="label text-xs">الوحدة</label>
              <select className="input text-sm" value={form.unit} onChange={e => set('unit', e.target.value)}>
                <option value="">—</option>
                <option value="طن">طن</option>
                <option value="كجم">كجم</option>
                <option value="فدان">فدان</option>
                <option value="لتر">لتر</option>
                <option value="عبوة">عبوة</option>
                <option value="قطعة">قطعة</option>
                <option value="كرتونة">كرتونة</option>
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
          </div>
        </details>

        {/* ── Notes ───────────────────────────────────────── */}
        <div>
          <label className="label">ملاحظات</label>
          <textarea className="input" rows={2} placeholder="ملاحظات إضافية..." value={form.notes}
            onChange={e => set('notes', e.target.value)} />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {/* ── Actions ─────────────────────────────────────── */}
        <div className="flex gap-3 pt-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose} disabled={saving}>
            إلغاء
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={saving}>
            {saving ? 'جاري الحفظ...' : form.status === 'draft' ? 'حفظ كمسودة' : 'حفظ وترحيل'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
