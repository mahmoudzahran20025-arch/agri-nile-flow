import { useState, useEffect } from 'react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { Users, Briefcase, Receipt, Info, TrendingDown, TrendingUp } from 'lucide-react'
import Modal from '../ui/Modal'
import { treasuryApi, suppliersApi, configApi, employeesApi, fieldsApi, glApi } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'

function egp(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}

export interface CashTransactionPrefill {
  supplier_code?: number
  supplier_name?: string
  amount?: number
  narration?: string
  document_type?: string
  document_number?: string
  direction?: 'م' | 'د'
  /** AP invoice id — stored in notes for traceability */
  invoice_id?: number
  invoice_number?: string
}

interface Props {
  open: boolean
  onClose: () => void
  prefill?: CashTransactionPrefill
  /** If provided, shown as a locked context banner (e.g. "سداد فاتورة AP #5") */
  contextLabel?: string
}

type BeneficiaryType = 'supplier' | 'employee' | 'partner' | 'general'

const today = () => new Date().toISOString().slice(0, 10)

const BENEFICIARY_TYPES: { value: BeneficiaryType; label: string; icon: React.ReactNode; desc: string }[] = [
  { value: 'supplier', label: 'مورد',        icon: <Users size={18} />,     desc: 'صرف أو تحصيل من مورد/عميل' },
  { value: 'partner',  label: 'شريك',        icon: <Briefcase size={18} />, desc: 'مسحوبات أو جاري شركاء' },
  { value: 'employee', label: 'موظف',        icon: <Briefcase size={18} />, desc: 'سلفة أو صرف لموظف' },
  { value: 'general',  label: 'مصروف عام',   icon: <Receipt size={18} />,   desc: 'إيجار، مرافق، مصروفات أخرى' },
]

const DOCUMENT_TYPES = ['فاتورة', 'شيك', 'تحويل بنكي', 'نقداً', 'إيصال', 'أخرى']

function cashNeedsOperationalDimensions(input: {
  direction: 'د' | 'م'
  center_code?: string
  supplier_code?: string
  partner_id?: string
  expense_code?: string
}) {
  if (input.direction !== 'م') return false
  if (input.center_code?.trim()) return true
  if (input.expense_code?.trim()) return true
  return !input.supplier_code?.trim() && !input.partner_id?.trim()
}

export default function AddCashTransactionModal({ open, onClose, prefill, contextLabel }: Props) {
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
    center_code:      '',
    field_id:         '',
    expense_code:     '',
    status:           'draft' as 'draft' | 'posted',
    financial_account_id: '',
    partner_id:       '',
  })
  const [beneficiaryType, setBeneficiaryType] = useState<BeneficiaryType>('supplier')

  // Reset form when modal opens, applying any prefill
  useEffect(() => {
    if (open) {
      const invoiceNote = prefill?.invoice_id
        ? `سداد فاتورة #${prefill.invoice_number ?? prefill.invoice_id}`
        : ''
      setForm({
        transaction_date: today(),
        direction:        prefill?.direction   ?? 'م',
        narration:        prefill?.narration   ?? '',
        amount:           prefill?.amount != null ? String(prefill.amount) : '',
        document_number:  prefill?.document_number ?? '',
        document_type:    prefill?.document_type   ?? '',
        recipient_name:   prefill?.supplier_name   ?? '',
        notes:            invoiceNote,
        supplier_code:    prefill?.supplier_code != null ? String(prefill.supplier_code) : '',
        season_id:        '',
        center_code:      '',
        field_id:         '',
        expense_code:     '',
        status:           'draft',
        financial_account_id: '',
        partner_id:       '',
      })
      setBeneficiaryType(prefill?.supplier_code != null ? 'supplier' : 'supplier')
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

  type CenterOption = { code: number; name: string }
  const { data: costCenters = [] } = useQuery({
    queryKey: ['config', 'cost_centers'],
    queryFn:  configApi.costCenters as () => Promise<CenterOption[]>,
    enabled:  open,
    staleTime: 120_000,
  })

  const { data: partners = [] } = useQuery({
    queryKey: ['treasury', 'partners'],
    queryFn:  () => treasuryApi.partners() as Promise<{ id: number; name: string }[]>,
    enabled:  open && beneficiaryType === 'partner',
    staleTime: 60_000,
  })

  const { data: accounts = [] } = useQuery({
    queryKey: ['finance', 'bank-accounts'],
    queryFn:  () => glApi.bankAccounts() as Promise<{ id: number; bank_name: string; account_name: string }[]>,
    enabled:  open,
    staleTime: 120_000,
  })

  type FieldOption = { id: number; name: string; code: string; area_feddan?: number }
  const { data: fields = [] } = useQuery({
    queryKey: ['fields-dropdown', form.season_id],
    queryFn:  () => fieldsApi.list(form.season_id ? { season_id: Number(form.season_id) } : {}) as Promise<FieldOption[]>,
    enabled:  open,
    staleTime: 120_000,
  })

  // Load supplier summary for balance display
  const { data: supplierSummary } = useQuery({
    queryKey: ['supplier-summary-mini', form.supplier_code],
    queryFn:  () => suppliersApi.summary(Number(form.supplier_code)),
    enabled:  open && beneficiaryType === 'supplier' && !!form.supplier_code,
    staleTime: 30_000,
  })

  // Auto-fill recipient name when supplier changes
  useEffect(() => {
    if (beneficiaryType === 'supplier' && form.supplier_code) {
      const sup = (suppliers as SupplierOption[]).find(s => String(s.code) === form.supplier_code)
      if (sup) {
        set('recipient_name', sup.name)
        // Auto-suggest narration if empty
        if (!form.narration) {
          const action = form.direction === 'م' ? 'سداد مستحقات' : 'تحصيل من'
          set('narration', `${action} ${sup.name}`)
        }
      }
    }
  }, [form.supplier_code, suppliers, beneficiaryType])

  // Auto-fill recipient name when employee selected
  useEffect(() => {
    if (beneficiaryType === 'employee' && form.supplier_code) {
      const emp = (employees as EmployeeOption[]).find(e => String(e.id) === form.supplier_code)
      if (emp) set('recipient_name', emp.name)
    }
  }, [form.supplier_code, employees, beneficiaryType])



  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const requiresOperationalDimensions = form.status === 'posted' && cashNeedsOperationalDimensions({
      direction: form.direction as 'د' | 'م',
      center_code: form.center_code,
      supplier_code: form.supplier_code,
      partner_id: form.partner_id,
      expense_code: form.expense_code,
    })
    if (!form.narration.trim() || !form.amount) { setError('البيان والمبلغ مطلوبان'); return }
    if (!form.financial_account_id) { setError('يجب اختيار الحساب (الخزينة أو البنك)'); return }
    if (requiresOperationalDimensions && !form.season_id) { setError('الموسم مطلوب عند الترحيل التشغيلي'); return }
    if (requiresOperationalDimensions && !form.center_code) { setError('مركز التكلفة مطلوب عند الترحيل التشغيلي'); return }
    if (form.narration.trim().length < 3) { setError('البيان يجب أن يكون 3 أحرف على الأقل'); return }
    if (Number(form.amount) <= 0) { setError('المبلغ يجب أن يكون أكبر من صفر'); return }
    if (form.status === 'posted' && form.direction === 'م' && !form.supplier_code && !form.partner_id && !form.expense_code) {
      setError('بند المصروف مطلوب للصرف بدون مورد أو شريك'); return
    }

    setSaving(true)
    try {
      const res = await treasuryApi.create({
        transaction_date: form.transaction_date,
        direction:        form.direction,
        narration:        form.narration.trim(),
        amount:           Number(form.amount),
        document_number:  form.document_number ? Number(form.document_number) : undefined,
        document_type:    form.document_type || undefined,
        recipient_name:   form.recipient_name.trim() || undefined,
        notes:            form.notes.trim() || undefined,
        supplier_code:    beneficiaryType === 'supplier' && form.supplier_code
                            ? Number(form.supplier_code) : undefined,
        season_id:        form.season_id ? Number(form.season_id) : undefined,
        center_code:      form.center_code ? Number(form.center_code) : undefined,
        field_id:         form.field_id ? Number(form.field_id) : undefined,
        expense_code:     form.expense_code ? Number(form.expense_code) : null,
        financial_account_id: form.financial_account_id ? Number(form.financial_account_id) : null,
        partner_id:       form.partner_id ? Number(form.partner_id) : null,
        status:           form.status,
      })
      if (!(res as { success: boolean }).success) {
        const rawErr = (res as { error: unknown }).error
        setError(typeof rawErr === 'string' ? rawErr : 'خطأ في التحقق من البيانات')
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
      if (beneficiaryType === 'supplier' && form.supplier_code) {
        // queryKey uses the raw string code (from useParams), not a number
        await qc.invalidateQueries({ queryKey: ['supplier-statement', form.supplier_code] })
        await qc.invalidateQueries({ queryKey: ['supplier-summary-mini', form.supplier_code] })
      }
      onClose()
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? String(err)
      // Surface actionable backend errors (e.g. CASH_EXPENSE_ACCOUNT_MISSING) verbatim
      setError(msg || 'حدث خطأ في الاتصال')
    } finally {
      setSaving(false)
    }
  }



  return (
    <Modal open={open} title={contextLabel ? contextLabel : 'إضافة حركة خزينة'} onClose={onClose} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">

        {/* ── Context banner (prefill mode) ────────────────── */}
        {contextLabel && (
          <div className="flex items-center gap-2 rounded-xl bg-indigo-50 border border-indigo-200 px-3 py-2.5 text-xs text-indigo-800">
            <Info size={13} className="shrink-0 text-indigo-500" />
            <span className="font-semibold">{contextLabel}</span>
            <span className="text-indigo-500 mr-auto">— البيانات مُعبَّأة تلقائياً، راجع وأكمل</span>
          </div>
        )}

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

        {/* ── Account Selector ─────────────────────────────── */}
        <div>
          <label className="label">الحساب (الخزينة/البنك) <span className="text-red-500">*</span></label>
          <select required className="input" value={form.financial_account_id}
            onChange={e => set('financial_account_id', e.target.value)}>
            <option value="">— اختر الحساب —</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.bank_name} - {a.account_name}</option>
            ))}
          </select>
        </div>

        {/* ── Beneficiary Type Toggle ─────────────────────── */}
        <div>
          <label className="label mb-2">نوع المستفيد</label>
          <div className="grid grid-cols-4 gap-2">
            {BENEFICIARY_TYPES.map(bt => (
              <button key={bt.value} type="button"
                className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 text-sm font-medium transition-all
                  ${beneficiaryType === bt.value
                    ? 'border-brand-500 bg-brand-50 text-brand-700 shadow-sm'
                    : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'}`}
                onClick={() => {
                  setBeneficiaryType(bt.value)
                  set('supplier_code', '')
                  set('partner_id', '')
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
          <div className="space-y-2">
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

            {/* Supplier balance indicator */}
            {form.supplier_code && supplierSummary && (
              <div className={`flex items-center justify-between rounded-xl px-3 py-2 text-xs border ${
                (supplierSummary.open_balance ?? 0) > 0
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-slate-50 border-slate-200 text-slate-600'
              }`}>
                <span className="flex items-center gap-1.5">
                  {(supplierSummary.open_balance ?? 0) > 0
                    ? <TrendingDown size={12} className="text-amber-600" />
                    : <TrendingUp   size={12} className="text-slate-400" />}
                  رصيد المورد الحالي (المستحق):
                </span>
                <span className="font-black tabular-nums">
                  {egp(supplierSummary.open_balance)}
                </span>
              </div>
            )}

            {/* Integration note */}
            {form.supplier_code && (
              <div className="flex items-start gap-2 rounded-xl bg-blue-50 border border-blue-200 px-3 py-2 text-[11px] text-blue-700">
                <Info size={12} className="mt-0.5 shrink-0 text-blue-500" />
                <span>
                  {form.direction === 'م'
                    ? 'هذه الحركة ستُسجَّل تلقائياً في كشف حساب المورد كدفعة (تخفيض المستحق)'
                    : 'هذه الحركة ستُسجَّل تلقائياً في كشف حساب المورد كتحصيل (زيادة المستحق)'}
                  {' — '}لا تُدخل نفس الحركة يدوياً في ملف المورد تجنباً للتكرار.
                </span>
              </div>
            )}
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

        {beneficiaryType === 'partner' && (
          <div className="space-y-2">
            <div>
              <label className="label">الشريك</label>
              <select className="input" value={form.partner_id}
                onChange={e => {
                  set('partner_id', e.target.value)
                  const p = (partners as { id: number; name: string }[]).find(x => x.id === Number(e.target.value))
                  if (p) set('recipient_name', p.name)
                }}>
                <option value="">— اختر الشريك —</option>
                {(partners as { id: number; name: string }[]).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            {form.direction === 'د' && (
              <div className="flex items-start gap-2 rounded-xl bg-blue-50 border border-blue-200 px-3 py-2 text-[11px] text-blue-700">
                <Info size={12} className="mt-0.5 shrink-0 text-blue-500" />
                <span>الوارد من الشريك يُصنَّف كحقوق ملكية (ضخ رأس مال) ويُرحَّل لحساب رأس المال أو الجاري.</span>
              </div>
            )}
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

        {/* ── Season + Field + Cost Center + Expense Type ── */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">الموسم الزراعي {form.status === 'posted' && <span className="text-red-500">*</span>}</label>
            <select className="input" value={form.season_id}
              onChange={e => { set('season_id', e.target.value); set('field_id', '') }}>
              <option value="">— بدون موسم —</option>
              {(seasons as SeasonOption[]).map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.status === 'active' ? ' ✓' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">قطعة الأرض <span className="text-slate-400 font-normal text-[10px]">(لربط بالميزانية)</span></label>
            <select className="input" value={form.field_id}
              onChange={e => set('field_id', e.target.value)}>
              <option value="">— بدون قطعة —</option>
              {(fields as FieldOption[]).map(f => (
                <option key={f.id} value={f.id}>
                  {f.name}{f.area_feddan ? ` (${f.area_feddan} ف)` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">مركز التكلفة {form.status === 'posted' && <span className="text-red-500">*</span>}</label>
            <select className="input" value={form.center_code}
              onChange={e => set('center_code', e.target.value)}>
              <option value="">— بدون مركز —</option>
              {(costCenters as CenterOption[]).map(cc => (
                <option key={cc.code} value={cc.code}>{cc.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">
              بند المصروف{' '}
              {form.status === 'posted' && form.direction === 'م' && !form.supplier_code && !form.partner_id
                ? <span className="text-red-500">*</span>
                : <span className="text-slate-400 font-normal text-[10px]">(موصى به)</span>}
            </label>
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
