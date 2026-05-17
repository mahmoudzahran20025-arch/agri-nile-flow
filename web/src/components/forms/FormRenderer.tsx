import { useQuery } from '@tanstack/react-query'
import { schemaApi, type FormFieldDef, type FormSchema } from '../../api/schema'

interface FormRendererProps {
  serviceTypeCode: string
  values:          Record<string, unknown>
  onChange:        (key: string, value: unknown) => void
  errors?:         Record<string, string>
  disabled?:       boolean
}

// ── Single field renderer ──────────────────────────────────────────────────────

function FieldInput({
  field, value, onChange, error, disabled, serviceTypeCode,
}: {
  field:           FormFieldDef
  value:           unknown
  onChange:        (v: unknown) => void
  error?:          string
  disabled?:       boolean
  serviceTypeCode: string
}) {
  const { data: options } = useQuery({
    queryKey: ['form-field-options', serviceTypeCode, field.source_table],
    queryFn:  () => schemaApi.fieldOptions(serviceTypeCode, field.source_table!),
    enabled:  field.field_type === 'select' && field.source_table != null,
    staleTime: 5 * 60 * 1000,
  })

  const base = 'w-full rounded-xl border px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-50'
  const borderClass = error ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'

  const widthClass = field.width_hint === 'half'
    ? 'col-span-1'
    : field.width_hint === 'third'
    ? 'col-span-1'
    : 'col-span-2'

  let input: React.ReactNode

  if (field.field_type === 'select') {
    input = (
      <select
        className={`${base} ${borderClass}`}
        value={String(value ?? '')}
        onChange={e => onChange(e.target.value === '' ? null : e.target.value)}
        disabled={disabled}
      >
        <option value="">{field.placeholder_ar ?? `اختر ${field.label_ar}`}</option>
        {(options ?? []).map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    )
  } else if (field.field_type === 'textarea') {
    input = (
      <textarea
        rows={3}
        className={`${base} ${borderClass} resize-none`}
        placeholder={field.placeholder_ar ?? ''}
        value={String(value ?? '')}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
      />
    )
  } else if (field.field_type === 'checkbox') {
    return (
      <div className={`${widthClass} flex items-center gap-2 pt-6`}>
        <input
          type="checkbox"
          id={field.field_key}
          checked={Boolean(value)}
          onChange={e => onChange(e.target.checked)}
          disabled={disabled}
          className="h-4 w-4 rounded border-slate-300 text-emerald-600"
        />
        <label htmlFor={field.field_key} className="text-sm text-slate-700">{field.label_ar}</label>
      </div>
    )
  } else {
    input = (
      <input
        type={field.field_type === 'number' ? 'number' : field.field_type === 'date' ? 'date' : 'text'}
        className={`${base} ${borderClass}`}
        placeholder={field.placeholder_ar ?? ''}
        value={field.field_type === 'number' ? (value == null ? '' : Number(value)) : String(value ?? '')}
        onChange={e => onChange(field.field_type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
        disabled={disabled}
        min={field.validation?.min as number | undefined}
        max={field.validation?.max as number | undefined}
        step={field.field_type === 'number' ? (field.validation?.step as number | undefined ?? 0.01) : undefined}
      />
    )
  }

  return (
    <div className={widthClass}>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {field.label_ar}
        {field.is_required === 1 && <span className="text-red-500 mr-1">*</span>}
      </label>
      {input}
      {field.help_text_ar && !error && (
        <p className="mt-1 text-xs text-slate-400">{field.help_text_ar}</p>
      )}
      {error && (
        <p className="mt-1 text-xs text-red-500">{error}</p>
      )}
    </div>
  )
}

// ── Main FormRenderer ──────────────────────────────────────────────────────────

export function FormRenderer({ serviceTypeCode, values, onChange, errors = {}, disabled = false }: FormRendererProps) {
  const { data: schema, isLoading, error: loadError } = useQuery<FormSchema>({
    queryKey: ['form-schema', serviceTypeCode],
    queryFn:  () => schemaApi.formSchema(serviceTypeCode),
    enabled:  Boolean(serviceTypeCode),
    staleTime: 10 * 60 * 1000,
  })

  if (!serviceTypeCode) return null

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 animate-pulse">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-16 rounded-xl bg-slate-100" />
        ))}
      </div>
    )
  }

  if (loadError || !schema) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        تعذّر تحميل نموذج الخدمة: {serviceTypeCode}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {schema.service_type_name_ar && (
        <p className="text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg px-3 py-1.5">
          {schema.service_type_name_ar}
        </p>
      )}
      <div className="grid grid-cols-2 gap-4">
        {schema.fields.map(field => (
          <FieldInput
            key={field.field_key}
            field={field}
            value={values[field.field_key]}
            onChange={v => onChange(field.field_key, v)}
            error={errors[field.field_key]}
            disabled={disabled}
            serviceTypeCode={serviceTypeCode}
          />
        ))}
      </div>
    </div>
  )
}

export default FormRenderer
