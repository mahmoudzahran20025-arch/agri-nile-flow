import { useState, useEffect } from 'react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import Modal from '../ui/Modal'
import { suppliersApi, configApi, financeApi } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'

interface Props { open: boolean; onClose: () => void; supplierCode: number; supplierName: string }

const today = () => new Date().toISOString().slice(0, 10)

const DOCUMENT_TYPES = ['فاتورة', 'شيك', 'تحويل بنكي', 'نقداً', 'إيصال', 'أمر شراء', 'أخرى']
const UNITS = ['طن', 'كجم', 'فدان', 'لتر', 'عبوة', 'قطعة', 'كرتونة', 'متر', 'شيكارة', 'ساعة', 'يوم']

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
    equipment_usage_mode: '',
    unit:             '',
    quantity:         '',
    unit_price:       '',
    notes:            '',
    season_id:        '',
    center_code:      '',
    financial_account_id: '',
    status:           'posted' as 'draft' | 'posted',
  })

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setForm({
        transaction_date: today(), entry_type: 'م', amount: '',
        document_type: '', document_number: '', expense_category: '',
        equipment_type_id: '', equipment_usage_mode: '',
        unit: '', quantity: '', unit_price: '', notes: '',
        season_id: '', center_code: '', financial_account_id: '', status: 'posted',
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

  type BankAccountOption = { id: number; bank_name: string; account_name: string; is_active: number }
  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['finance', 'bank_accounts'],
    queryFn: financeApi.getBankAccounts as () => Promise<BankAccountOption[]>,
    enabled: open,
    staleTime: 120_000,
  })

  const selectedEquipmentType = equipmentTypes.find(et => String(et.id) === form.equipment_type_id)


  // Auto-compute amount from qty × price
  useEffect(() => {
    const qty = Number(form.quantity)
    const price = Number(form.unit_price)
    if (qty > 0 && price > 0) {
      set('amount', String(Math.round(qty * price * 100) / 100))
    }
  }, [form.quantity, form.unit_price])

  useEffect(() => {
    // Owned capital equipment must be posted to trigger fixed asset creation.
    if (form.entry_type === 'د' && form.equipment_type_id && form.equipment_usage_mode === 'owned' && form.status !== 'posted') {
      setForm(f => ({ ...f, status: 'posted' }))
    }
  }, [form.entry_type, form.equipment_type_id, form.equipment_usage_mode, form.status])

  useEffect(() => {
    // Selecting equipment means this is a supplier invoice path (credit/AP increase).
    if (form.equipment_type_id && form.entry_type !== 'د') {
      setForm(f => ({ ...f, entry_type: 'د', document_type: f.document_type || 'فاتورة' }))
    }
  }, [form.equipment_type_id, form.entry_type])

  useEffect(() => {
    if (!form.equipment_type_id && form.equipment_usage_mode) {
      setForm(f => ({ ...f, equipment_usage_mode: '' }))
    }
  }, [form.equipment_type_id, form.equipment_usage_mode])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.amount || Number(form.amount) <= 0) { setError('المبلغ مطلوب وأكبر من صفر'); return }
    if (form.status === 'posted' && !form.season_id) { setError('الموسم مطلوب عند الترحيل'); return }
    if (form.status === 'posted' && !form.center_code) { setError('مركز التكلفة مطلوب عند الترحيل'); return }
    if (form.entry_type === 'م' && form.status === 'posted' && !form.financial_account_id) {
      setError('حساب الخزينة / البنك مطلوب عند ترحيل سداد المورد')
      return
    }
    if (form.equipment_type_id && !form.equipment_usage_mode) {
      setError('حدد هل هذه المعدة إيجار أم مملوكة للشركة')
      return
    }

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
        equipment_usage_mode: form.equipment_usage_mode || undefined,
        unit:             form.unit || undefined,
        quantity:         form.quantity ? Number(form.quantity) : undefined,
        unit_price:       form.unit_price ? Number(form.unit_price) : undefined,
        notes:            form.notes.trim() || undefined,
        season_id:        form.season_id ? Number(form.season_id) : undefined,
        center_code:      form.center_code ? Number(form.center_code) : undefined,
        financial_account_id: form.financial_account_id ? Number(form.financial_account_id) : undefined,
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

        {form.entry_type === 'د' && !!form.equipment_type_id && form.equipment_usage_mode === 'owned' && selectedEquipmentType?.asset_nature === 'capital' && (
          <div className="flex gap-2 rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
            <div>
              <span className="font-semibold">تكامل الأصل الثابت:</span> هذا القيد سيُرحّل مباشرة مع إنشاء أصل ثابت وربطه
              بحركة المورد تلقائياً.
            </div>
          </div>
        )}

        {form.equipment_type_id && form.equipment_usage_mode === 'rental' && (
          <div className="flex gap-2 rounded-md bg-sky-50 border border-sky-200 p-3 text-sm text-sky-800">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-sky-500" />
            <div>
              <span className="font-semibold">معدات بالإيجار:</span> ستظهر في إحصائيات المعدات التشغيلية، ولن يتم إنشاء أصل ثابت لها.
            </div>
          </div>
        )}

        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <span className="font-semibold text-slate-700">توضيح سريع:</span>
          <span className="ml-2">"دائن (د)" = فاتورة/مستحقات تزيد رصيد المورد، "مدين (م)" = سداد يقلل رصيد المورد.</span>
        </div>

        {/* ── Row 1: Date + Entry Type + Status ──────────── */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">التاريخ <span className="text-red-500">*</span></label>
            <input type="date" className="input" value={form.transaction_date}
              onChange={e => set('transaction_date', e.target.value)} required />
          </div>
          <div>
            <label className="label">نوع القيد <span className="text-red-500">*</span></label>
            <select
              className="input"
              value={form.entry_type}
              onChange={e => set('entry_type', e.target.value)}
              disabled={!!form.equipment_type_id}
            >
              <option value="د">دائن (د) — فاتورة مورد / زيادة مستحقات</option>
              <option value="م">مدين (م) — سداد مورد / تقليل مستحقات</option>
            </select>
            {!!form.equipment_type_id && (
              <p className="mt-1 text-[11px] text-amber-700">تم قفل النوع على "دائن" لأن مسار المعدات يعتمد على فاتورة مورد.</p>
            )}
          </div>
          <div>
            <label className="label">الحالة</label>
            <select className="input" value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="draft" disabled={form.entry_type === 'د' && !!form.equipment_type_id && form.equipment_usage_mode === 'owned'}>مسودة</option>
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
            <label className="label">نوع المعدة</label>
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

        {form.equipment_type_id && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">طريقة التعامل مع المعدة <span className="text-red-500">*</span></label>
              <select className="input" value={form.equipment_usage_mode}
                onChange={e => set('equipment_usage_mode', e.target.value)}>
                <option value="">— اختر —</option>
                <option value="rental">إيجار / تشغيل للغير</option>
                <option value="owned">تملك الشركة</option>
              </select>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">التأثير المحاسبي:</span>{' '}
              {form.equipment_usage_mode === 'owned'
                ? (selectedEquipmentType?.asset_nature === 'capital'
                  ? 'سيتم إنشاء أصل ثابت عند الترحيل.'
                  : 'سيبقى القيد تشغيليًا لأن نوع المعدة غير رأسمالي.')
                : form.equipment_usage_mode === 'rental'
                  ? 'سيُعامل كمصروف/خدمة تشغيلية بدون إنشاء أصل ثابت.'
                  : 'اختر الطريقة لتحديد هل الحركة أصل ثابت أم استخدام تشغيلي.'}
            </div>
          </div>
        )}

        <div>
          <label className="label">رقم المستند</label>
          <input type="number" className="input" placeholder="—" value={form.document_number}
            onChange={e => set('document_number', e.target.value)} />
        </div>

        {form.entry_type === 'م' && (
          <div>
            <label className="label">حساب الخزينة / البنك {form.status === 'posted' && <span className="text-red-500">*</span>}</label>
            <select className="input" value={form.financial_account_id}
              onChange={e => set('financial_account_id', e.target.value)}>
              <option value="">— اختر الحساب —</option>
              {bankAccounts.filter(acc => acc.is_active === 1).map(acc => (
                <option key={acc.id} value={acc.id}>{acc.bank_name} — {acc.account_name}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">هذا الحساب يُستخدم في قيد السداد وفي رصيد الخزينة الفعلي.</p>
          </div>
        )}

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
