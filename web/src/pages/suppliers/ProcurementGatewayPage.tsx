import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ShoppingCart, FileText, Package, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react'
import { schemaApi } from '../../api/schema'
import { configApi, api } from '../../api/client'
import { suppliersApi } from '../../api/suppliers'
import { FormRenderer } from '../../components/forms/FormRenderer'
import { useGLPreview } from '../../hooks/useGLPreview'
import type { GlPreviewLine } from '../../api/gl'

// ── Transaction type definitions ───────────────────────────────────────────────

const TX_TYPES = [
  { key: 'GRN',      label_ar: 'استلام مخزون',  icon: Package,   event_type: 'supplier_invoice' },
  { key: 'ISSUE',    label_ar: 'صرف مخزون',      icon: ShoppingCart, event_type: 'inventory_issue' },
  { key: 'INVOICE',  label_ar: 'فاتورة مورد',    icon: FileText,  event_type: 'supplier_invoice' },
] as const

type TxTypeKey = typeof TX_TYPES[number]['key']

// ── GL Preview Panel ───────────────────────────────────────────────────────────

function GlPreviewPanel({ lines, balanced, warning, loading }: {
  lines:    GlPreviewLine[]
  balanced: boolean
  warning:  string | null
  loading:  boolean
}) {
  const [open, setOpen] = useState(true)

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 animate-pulse space-y-3">
        <div className="h-4 w-32 rounded bg-slate-100" />
        {[1, 2].map(i => <div key={i} className="h-8 rounded bg-slate-100" />)}
      </div>
    )
  }

  if (!lines.length) return null

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        <span>
          معاينة القيد المحاسبي
          {' '}
          {balanced
            ? <span className="text-emerald-600 font-normal text-xs mr-2">متوازن ✓</span>
            : <span className="text-red-500 font-normal text-xs mr-2">غير متوازن ✗</span>
          }
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {warning && (
            <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{warning}</span>
            </div>
          )}
          <table className="w-full text-xs text-right">
            <thead>
              <tr className="border-b text-slate-400">
                <th className="pb-1 font-medium">الحساب</th>
                <th className="pb-1 font-medium">اسم الحساب</th>
                <th className="pb-1 font-medium">مدين</th>
                <th className="pb-1 font-medium">دائن</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l, i) => (
                <tr key={i} className="text-slate-700">
                  <td className="py-1.5 font-mono text-xs">{l.account_code}</td>
                  <td className="py-1.5 text-slate-500 text-xs">{l.account_label ?? '—'}</td>
                  <td className="py-1.5 font-mono">{l.debit > 0 ? l.debit.toLocaleString('ar-EG') : '—'}</td>
                  <td className="py-1.5 font-mono">{l.credit > 0 ? l.credit.toLocaleString('ar-EG') : '—'}</td>
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

  const [txType, setTxType]               = useState<TxTypeKey>('GRN')
  const [serviceTypeCode, setServiceType] = useState<string>('')
  const [formValues, setFormValues]       = useState<Record<string, unknown>>({})
  const [errors, setErrors]               = useState<Record<string, string>>({})
  const [submitting, setSubmitting]       = useState(false)
  const [submitError, setSubmitError]     = useState<string | null>(null)

  const selectedTx = TX_TYPES.find(t => t.key === txType)!

  // Load service types for the dropdown
  const { data: serviceTypes } = useQuery({
    queryKey: ['schema-form-templates'],
    queryFn:  schemaApi.formTemplates,
    staleTime: 10 * 60 * 1000,
  })

  // Load context data for dimension pickers
  const { data: seasons }     = useQuery({ queryKey: ['seasons'],      queryFn: configApi.seasons })
  const { data: costCenters } = useQuery({ queryKey: ['cost_centers'], queryFn: configApi.costCenters })

  // GL preview — updates as user types amount
  const amount = Number(formValues['amount'] ?? formValues['unit_price'] ?? 0)
  const previewReq = useMemo(() => {
    if (!amount || amount <= 0) return null
    return {
      event_type:   selectedTx.event_type,
      amount,
      description:  String(formValues['statement_text'] ?? formValues['notes'] ?? ''),
      season_id:    formValues['season_id'] ? Number(formValues['season_id']) : undefined,
      center_code:  formValues['center_code'] ? Number(formValues['center_code']) : undefined,
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
      if (!formValues['season_id'])      errs['season_id']      = 'الموسم مطلوب'
      if (!formValues['supplier_code'])  errs['supplier_code']  = 'المورد مطلوب'
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

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-6" dir="rtl">
      <div>
        <h1 className="text-xl font-bold text-slate-800">بوابة المشتريات</h1>
        <p className="text-sm text-slate-500 mt-1">تسجيل معاملة جديدة مع معاينة أثرها المحاسبي</p>
      </div>

      {/* Transaction type selector */}
      <div className="grid grid-cols-3 gap-3">
        {TX_TYPES.map(t => {
          const Icon = t.icon
          const active = txType === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => { setTxType(t.key); setFormValues({}); setErrors({}) }}
              className={`flex flex-col items-center gap-2 rounded-2xl border-2 px-4 py-4 text-sm font-medium transition-all ${
                active
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              <Icon size={20} />
              {t.label_ar}
            </button>
          )
        })}
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Context dimensions — always shown */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700">أبعاد التصنيف</h2>
          <div className="grid grid-cols-2 gap-4">
            {/* Season */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                الموسم <span className="text-red-500">*</span>
              </label>
              <select
                className={`w-full rounded-xl border px-3 py-2 text-sm text-right ${errors['season_id'] ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}
                value={String(formValues['season_id'] ?? '')}
                onChange={e => handleFieldChange('season_id', e.target.value || null)}
              >
                <option value="">اختر الموسم</option>
                {(seasons as Array<{ id: number; name: string }> ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {errors['season_id'] && <p className="mt-1 text-xs text-red-500">{errors['season_id']}</p>}
            </div>

            {/* Cost Center */}
            {txType !== 'GRN' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  مركز التكلفة <span className="text-red-500">*</span>
                </label>
                <select
                  className={`w-full rounded-xl border px-3 py-2 text-sm text-right ${errors['center_code'] ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}
                  value={String(formValues['center_code'] ?? '')}
                  onChange={e => handleFieldChange('center_code', e.target.value || null)}
                >
                  <option value="">اختر مركز التكلفة</option>
                  {(costCenters as Array<{ code: number; name: string }> ?? []).map((cc) => (
                    <option key={cc.code} value={cc.code}>{cc.name}</option>
                  ))}
                </select>
                {errors['center_code'] && <p className="mt-1 text-xs text-red-500">{errors['center_code']}</p>}
              </div>
            )}
          </div>
        </div>

        {/* Service type selector → drives FormRenderer */}
        {txType === 'ISSUE' && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              نوع الخدمة <span className="text-red-500">*</span>
            </label>
            <select
              className={`w-full rounded-xl border px-3 py-2 text-sm text-right ${errors['service_type_code'] ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}
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
            {errors['service_type_code'] && <p className="mt-1 text-xs text-red-500">{errors['service_type_code']}</p>}
          </div>
        )}

        {/* Schema-driven form fields */}
        {serviceTypeCode && txType === 'ISSUE' && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <FormRenderer
              serviceTypeCode={serviceTypeCode}
              values={formValues}
              onChange={handleFieldChange}
              errors={errors}
              disabled={submitting}
            />
          </div>
        )}

        {/* Manual fields for GRN / INVOICE when not schema-driven */}
        {(txType === 'GRN' || txType === 'INVOICE') && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-700">تفاصيل المعاملة</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">المبلغ <span className="text-red-500">*</span></label>
                <input
                  type="number" step="0.01" min="0"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-right"
                  placeholder="0.00"
                  value={String(formValues['amount'] ?? '')}
                  onChange={e => handleFieldChange('amount', e.target.value ? Number(e.target.value) : null)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">رقم المستند <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  className={`w-full rounded-xl border px-3 py-2 text-sm text-right ${errors['document_number'] ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}
                  value={String(formValues['document_number'] ?? '')}
                  onChange={e => handleFieldChange('document_number', e.target.value ? Number(e.target.value) : null)}
                />
                {errors['document_number'] && <p className="mt-1 text-xs text-red-500">{errors['document_number']}</p>}
              </div>
              {txType === 'INVOICE' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">تاريخ الاستحقاق <span className="text-red-500">*</span></label>
                  <input
                    type="date"
                    className={`w-full rounded-xl border px-3 py-2 text-sm text-right ${errors['due_date'] ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}
                    value={String(formValues['due_date'] ?? '')}
                    onChange={e => handleFieldChange('due_date', e.target.value || null)}
                  />
                  {errors['due_date'] && <p className="mt-1 text-xs text-red-500">{errors['due_date']}</p>}
                </div>
              )}
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">ملاحظات</label>
                <textarea
                  rows={2}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-right resize-none"
                  value={String(formValues['notes'] ?? '')}
                  onChange={e => handleFieldChange('notes', e.target.value || null)}
                />
              </div>
            </div>
          </div>
        )}

        {/* GL Preview */}
        {(preview || previewLoading) && (
          <GlPreviewPanel
            lines={preview?.lines ?? []}
            balanced={preview?.balanced ?? false}
            warning={preview?.warning ?? null}
            loading={previewLoading}
          />
        )}

        {submitError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {submitError}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="btn-secondary"
            disabled={submitting}
          >
            إلغاء
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={submitting}
          >
            {submitting ? 'جارٍ الحفظ...' : 'حفظ المعاملة'}
          </button>
        </div>
      </form>
    </div>
  )
}
