import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  ShoppingCart, FileText, Package, ChevronDown, ChevronUp,
  AlertCircle, CheckCircle2, Loader2, Info,
} from 'lucide-react'
import { schemaApi } from '../../api/schema'
import { configApi, api } from '../../api/client'
import { suppliersApi } from '../../api/suppliers'
import { FormRenderer } from '../../components/forms/FormRenderer'
import { useGLPreview } from '../../hooks/useGLPreview'
import type { GlPreviewLine } from '../../api/gl'

// ── Transaction type definitions ───────────────────────────────────────────────
const TX_TYPES = [
  { key: 'GRN',     label_ar: 'استلام مخزون',  desc: 'تسجيل استلام بضاعة من مورد', icon: Package,      event_type: 'supplier_invoice' },
  { key: 'ISSUE',   label_ar: 'صرف مخزون',      desc: 'صرف مواد لأمر عمل أو خدمة',  icon: ShoppingCart, event_type: 'inventory_issue' },
  { key: 'INVOICE', label_ar: 'فاتورة مورد',    desc: 'تسجيل فاتورة خدمة خارجية',   icon: FileText,     event_type: 'supplier_invoice' },
] as const

type TxTypeKey = typeof TX_TYPES[number]['key']

// ── Field wrapper ──────────────────────────────────────────────────────────────
function Field({ label, required, error, help, children }: {
  label: string; required?: boolean; error?: string; help?: string; children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-slate-600 mb-1">
        {label}{required && <span className="text-red-500 mr-0.5">*</span>}
      </label>
      {children}
      {error && (
        <p className="mt-1 text-[11px] text-red-500 flex items-center gap-1">
          <AlertCircle size={10} />{error}
        </p>
      )}
      {help && !error && (
        <p className="mt-1 text-[11px] text-slate-400 flex items-center gap-1">
          <Info size={10} />{help}
        </p>
      )}
    </div>
  )
}

const INPUT = (err?: string) =>
  `w-full rounded-lg border px-3 py-2 text-[13px] text-right focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C] ${
    err ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'
  }`

// ── Section card ───────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
        <h3 className="text-[12px] font-semibold text-slate-600 uppercase tracking-wide">{title}</h3>
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </div>
  )
}

// ── GL Preview ─────────────────────────────────────────────────────────────────
function GlPreviewPanel({ lines, balanced, warning, loading }: {
  lines: GlPreviewLine[]; balanced: boolean; warning: string | null; loading: boolean
}) {
  const [open, setOpen] = useState(true)

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 animate-pulse">
        <div className="h-3 w-28 rounded bg-slate-100" />
        {[1, 2].map(i => <div key={i} className="h-7 rounded bg-slate-100" />)}
      </div>
    )
  }
  if (!lines.length) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2">
          معاينة القيد المحاسبي
          {balanced
            ? <span className="text-emerald-600 font-normal text-[11px] flex items-center gap-1"><CheckCircle2 size={11} />متوازن</span>
            : <span className="text-red-500 font-normal text-[11px] flex items-center gap-1"><AlertCircle size={11} />غير متوازن</span>
          }
        </span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          {warning && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
              <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
              <span>{warning}</span>
            </div>
          )}
          <table className="w-full text-[11px] text-right">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                <th className="pb-1.5 font-medium">الحساب</th>
                <th className="pb-1.5 font-medium">اسم الحساب</th>
                <th className="pb-1.5 font-medium text-center">مدين</th>
                <th className="pb-1.5 font-medium text-center">دائن</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {lines.map((l, i) => (
                <tr key={i} className="text-slate-700">
                  <td className="py-1.5 font-mono text-[10px] text-slate-500">{l.account_code}</td>
                  <td className="py-1.5 text-slate-600">{l.account_label ?? '—'}</td>
                  <td className="py-1.5 text-center font-mono tabular-nums">{l.debit > 0 ? l.debit.toLocaleString() : <span className="text-slate-300">—</span>}</td>
                  <td className="py-1.5 text-center font-mono tabular-nums">{l.credit > 0 ? l.credit.toLocaleString() : <span className="text-slate-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function ProcurementGatewayPage() {
  const navigate = useNavigate()

  const [txType,        setTxType]       = useState<TxTypeKey>('GRN')
  const [serviceTypeCode, setServiceType] = useState<string>('')
  const [formValues,    setFormValues]   = useState<Record<string, unknown>>({})
  const [errors,        setErrors]       = useState<Record<string, string>>({})
  const [submitting,    setSubmitting]   = useState(false)
  const [submitError,   setSubmitError]  = useState<string | null>(null)

  const selectedTx = TX_TYPES.find(t => t.key === txType)!

  const { data: serviceTypes, isLoading: typesLoading, isError: typesError } = useQuery({
    queryKey: ['schema-form-templates'],
    queryFn:  schemaApi.formTemplates,
    staleTime: 10 * 60 * 1000,
  })

  const { data: seasons }     = useQuery({ queryKey: ['seasons'],      queryFn: configApi.seasons })
  const { data: costCenters } = useQuery({ queryKey: ['cost_centers'], queryFn: configApi.costCenters })

  const amount = Number(formValues['amount'] ?? formValues['unit_price'] ?? 0)
  const previewReq = useMemo(() => {
    if (!amount || amount <= 0) return null
    return {
      event_type:  selectedTx.event_type,
      amount,
      description: String(formValues['statement_text'] ?? formValues['notes'] ?? ''),
      season_id:   formValues['season_id'] ? Number(formValues['season_id']) : undefined,
      center_code: formValues['center_code'] ? Number(formValues['center_code']) : undefined,
    }
  }, [selectedTx.event_type, amount, formValues['statement_text'], formValues['notes'], formValues['season_id'], formValues['center_code']])

  const { data: preview, loading: previewLoading } = useGLPreview(previewReq)

  function handleFieldChange(key: string, value: unknown) {
    setFormValues(prev => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors(prev => { const n = { ...prev }; delete n[key]; return n })
  }

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (txType === 'GRN') {
      if (!formValues['season_id'])       errs['season_id']       = 'الموسم مطلوب'
      if (!formValues['supplier_code'])   errs['supplier_code']   = 'المورد مطلوب'
      if (!formValues['document_number']) errs['document_number'] = 'رقم المستند مطلوب'
    }
    if (txType === 'ISSUE') {
      if (!formValues['season_id'])          errs['season_id']          = 'الموسم مطلوب'
      if (!formValues['center_code'])        errs['center_code']        = 'مركز التكلفة مطلوب'
      if (!formValues['service_type_code'])  errs['service_type_code']  = 'نوع الخدمة مطلوب'
      if (!formValues['statement_text'])     errs['statement_text']     = 'البيان مطلوب'
    }
    if (txType === 'INVOICE') {
      if (!formValues['season_id'])          errs['season_id']          = 'الموسم مطلوب'
      if (!formValues['center_code'])        errs['center_code']        = 'مركز التكلفة مطلوب'
      if (!formValues['supplier_code'])      errs['supplier_code']      = 'المورد مطلوب'
      if (!formValues['document_number'])    errs['document_number']    = 'رقم المستند مطلوب'
      if (!formValues['service_type_code'])  errs['service_type_code']  = 'نوع الخدمة مطلوب'
      if (!formValues['due_date'])           errs['due_date']           = 'تاريخ الاستحقاق مطلوب'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      if (txType === 'GRN' || txType === 'ISSUE') {
        const body = {
          movement_date:     String(formValues['movement_date'] ?? new Date().toISOString().slice(0, 10)),
          warehouse:         String(formValues['warehouse'] ?? ''),
          movement_type:     txType,
          item_code:         Number(formValues['item_code']),
          quantity:          Number(formValues['quantity']),
          unit_price:        Number(formValues['unit_price'] ?? 0),
          supplier_code:     formValues['supplier_code'] ? Number(formValues['supplier_code']) : undefined,
          document_number:   formValues['document_number'] ? Number(formValues['document_number']) : undefined,
          season_id:         formValues['season_id'] ? Number(formValues['season_id']) : undefined,
          center_code:       formValues['center_code'] ? Number(formValues['center_code']) : undefined,
          field_id:          formValues['field_id'] ? Number(formValues['field_id']) : undefined,
          service_type_code: formValues['service_type_code'] ? String(formValues['service_type_code']) : undefined,
          statement_text:    formValues['statement_text'] ? String(formValues['statement_text']) : undefined,
          notes:             formValues['notes'] ? String(formValues['notes']) : undefined,
        }
        await api.post('/inventory/movements', body)
        navigate('/inventory/movements')
      } else if (txType === 'INVOICE') {
        const supplierCode = String(formValues['supplier_code'])
        await suppliersApi.addTransaction(Number(supplierCode), {
          transaction_date:  String(formValues['transaction_date'] ?? new Date().toISOString().slice(0, 10)),
          entry_type:        'د',
          amount:            Number(formValues['amount']),
          supplier_code:     Number(supplierCode),
          document_number:   formValues['document_number'] ? Number(formValues['document_number']) : undefined,
          due_date:          String(formValues['due_date']),
          season_id:         formValues['season_id'] ? Number(formValues['season_id']) : undefined,
          center_code:       formValues['center_code'] ? Number(formValues['center_code']) : undefined,
          service_type_code: String(formValues['service_type_code']),
          notes:             formValues['notes'] ? String(formValues['notes']) : undefined,
        })
        navigate('/suppliers')
      }
    } catch (err) {
      setSubmitError((err as Error).message ?? 'حدث خطأ أثناء الحفظ')
    } finally {
      setSubmitting(false)
    }
  }

  const errorCount = Object.keys(errors).length
  const hasAmount  = amount > 0

  return (
    <div className="h-full overflow-auto bg-[#f8fafc]" dir="rtl">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* Page header */}
        <div>
          <h1 className="text-[18px] font-bold text-[#0F2D5C]">بوابة المشتريات</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">تسجيل معاملة جديدة مع معاينة أثرها المحاسبي فورياً</p>
        </div>

        {/* Transaction type selector */}
        <div className="grid grid-cols-3 gap-3">
          {TX_TYPES.map(t => {
            const Icon   = t.icon
            const active = txType === t.key
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => { setTxType(t.key); setFormValues({}); setErrors({}); setServiceType('') }}
                className={`flex flex-col items-start gap-1.5 rounded-xl border-2 px-4 py-3.5 text-right transition-all ${
                  active
                    ? 'border-[#0F2D5C] bg-[#0F2D5C]/5 text-[#0F2D5C]'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <Icon size={18} />
                <span className="text-[13px] font-semibold">{t.label_ar}</span>
                <span className="text-[11px] text-slate-400 font-normal leading-tight">{t.desc}</span>
              </button>
            )
          })}
        </div>

        <form onSubmit={handleSubmit}>
          {/* Two-column layout: main form + sidebar */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5">

            {/* ── Left column: form sections ── */}
            <div className="space-y-4">

              {/* Dimensions */}
              <Section title="أبعاد التصنيف">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="الموسم" required error={errors['season_id']}>
                    <select
                      className={INPUT(errors['season_id'])}
                      value={String(formValues['season_id'] ?? '')}
                      onChange={e => handleFieldChange('season_id', e.target.value || null)}
                    >
                      <option value="">اختر الموسم</option>
                      {(seasons as Array<{ id: number; name: string }> ?? []).map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </Field>

                  {txType !== 'GRN' && (
                    <Field label="مركز التكلفة" required error={errors['center_code']}>
                      <select
                        className={INPUT(errors['center_code'])}
                        value={String(formValues['center_code'] ?? '')}
                        onChange={e => handleFieldChange('center_code', e.target.value || null)}
                      >
                        <option value="">اختر مركز التكلفة</option>
                        {(costCenters as Array<{ code: number; name: string }> ?? []).map(cc => (
                          <option key={cc.code} value={cc.code}>{cc.name}</option>
                        ))}
                      </select>
                    </Field>
                  )}
                </div>
              </Section>

              {/* Service type — ISSUE only */}
              {txType === 'ISSUE' && (
                <Section title="نوع الخدمة">
                  {typesError ? (
                    <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-[12px] text-red-700">
                      <AlertCircle size={14} className="shrink-0" />
                      <span>تعذّر تحميل أنواع الخدمات — تحقق من إعدادات قوالب النماذج</span>
                    </div>
                  ) : typesLoading ? (
                    <div className="flex items-center gap-2 text-[12px] text-slate-400 py-2">
                      <Loader2 size={14} className="animate-spin" />
                      جارٍ تحميل أنواع الخدمات...
                    </div>
                  ) : (
                    <Field label="نوع الخدمة" required error={errors['service_type_code']}>
                      <select
                        className={INPUT(errors['service_type_code'])}
                        value={serviceTypeCode}
                        onChange={e => { setServiceType(e.target.value); handleFieldChange('service_type_code', e.target.value || null) }}
                      >
                        <option value="">اختر نوع الخدمة</option>
                        {(serviceTypes ?? []).map(st => (
                          <option key={st.service_type_code} value={st.service_type_code}>
                            {st.service_type_name_ar ?? st.service_type_code}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                </Section>
              )}

              {/* Schema-driven fields */}
              {serviceTypeCode && txType === 'ISSUE' && (
                <Section title="تفاصيل الخدمة">
                  <FormRenderer
                    serviceTypeCode={serviceTypeCode}
                    values={formValues}
                    onChange={handleFieldChange}
                    errors={errors}
                    disabled={submitting}
                  />
                </Section>
              )}

              {/* Manual fields for GRN / INVOICE */}
              {(txType === 'GRN' || txType === 'INVOICE') && (
                <Section title="تفاصيل المعاملة">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="المبلغ" required help="القيمة الإجمالية للمعاملة">
                      <input
                        type="number" step="0.01" min="0"
                        className={INPUT()}
                        placeholder="0.00"
                        value={String(formValues['amount'] ?? '')}
                        onChange={e => handleFieldChange('amount', e.target.value ? Number(e.target.value) : null)}
                      />
                    </Field>
                    <Field label="رقم المستند" required error={errors['document_number']}>
                      <input
                        type="number"
                        className={INPUT(errors['document_number'])}
                        value={String(formValues['document_number'] ?? '')}
                        onChange={e => handleFieldChange('document_number', e.target.value ? Number(e.target.value) : null)}
                      />
                    </Field>
                    {txType === 'INVOICE' && (
                      <Field label="تاريخ الاستحقاق" required error={errors['due_date']}>
                        <input
                          type="date"
                          className={INPUT(errors['due_date'])}
                          value={String(formValues['due_date'] ?? '')}
                          onChange={e => handleFieldChange('due_date', e.target.value || null)}
                        />
                      </Field>
                    )}
                    <div className="col-span-2">
                      <Field label="ملاحظات">
                        <textarea
                          rows={2}
                          className={`${INPUT()} resize-none`}
                          value={String(formValues['notes'] ?? '')}
                          onChange={e => handleFieldChange('notes', e.target.value || null)}
                        />
                      </Field>
                    </div>
                  </div>
                </Section>
              )}

              {/* Error summary */}
              {errorCount > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>يرجى تصحيح {errorCount} حقل قبل الحفظ</span>
                </div>
              )}

              {submitError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-3 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  disabled={submitting}
                  className="px-5 py-2 text-[13px] border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 text-[13px] bg-[#0F2D5C] text-white rounded-lg hover:bg-[#0a2147] disabled:opacity-40 flex items-center gap-2 transition-colors font-medium"
                >
                  {submitting ? <><Loader2 size={14} className="animate-spin" />جارٍ الحفظ...</> : 'حفظ المعاملة'}
                </button>
              </div>
            </div>

            {/* ── Right sidebar ── */}
            <div className="space-y-4">
              {/* Summary card */}
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden sticky top-4">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                  <h3 className="text-[12px] font-semibold text-slate-600 uppercase tracking-wide">ملخص المعاملة</h3>
                </div>
                <div className="p-4 space-y-3">
                  {/* Type */}
                  <div className="flex justify-between text-[12px]">
                    <span className="text-slate-400">النوع</span>
                    <span className="font-semibold text-slate-700">{selectedTx.label_ar}</span>
                  </div>
                  {/* Season */}
                  {!!formValues['season_id'] && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-slate-400">الموسم</span>
                      <span className="font-medium text-slate-700 text-left">
                        {(seasons as Array<{ id: number; name: string }> ?? []).find(s => String(s.id) === String(formValues['season_id']))?.name ?? '—'}
                      </span>
                    </div>
                  )}
                  {/* Amount */}
                  {hasAmount && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-slate-400">القيمة</span>
                      <span className="font-bold text-slate-800 tabular-nums">
                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(amount)}
                      </span>
                    </div>
                  )}
                  {/* Doc number */}
                  {!!formValues['document_number'] && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-slate-400">رقم المستند</span>
                      <span className="font-mono text-slate-600">#{String(formValues['document_number'])}</span>
                    </div>
                  )}
                  {!hasAmount && !formValues['season_id'] && (
                    <p className="text-[11px] text-slate-300 text-center py-2">أدخل البيانات لعرض الملخص</p>
                  )}
                </div>

                {/* GL Preview in sidebar */}
                {(preview || previewLoading) && (
                  <div className="border-t border-slate-100 p-4">
                    <GlPreviewPanel
                      lines={preview?.lines ?? []}
                      balanced={preview?.balanced ?? false}
                      warning={preview?.warning ?? null}
                      loading={previewLoading}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
