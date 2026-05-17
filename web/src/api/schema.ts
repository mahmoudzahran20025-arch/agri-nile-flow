import { api, unwrap } from './core'

export interface FormFieldDef {
  id:              number
  field_key:       string
  label_ar:        string
  field_type:      'text' | 'number' | 'date' | 'select' | 'textarea' | 'checkbox'
  is_required:     number
  sort_order:      number
  default_value:   string | null
  source_table:    string | null
  source_filter:   string | null
  placeholder_ar:  string | null
  help_text_ar:    string | null
  width_hint:      'full' | 'half' | 'third' | null
  validation:      Record<string, unknown> | null
}

export interface FormSchemaDimensions {
  field:     boolean
  season:    boolean
  supplier:  boolean
  equipment: boolean
}

export interface UnitType {
  code:            string
  name_ar:         string
  quantity_based:  number
}

export interface FormSchema {
  service_type_code:     string
  service_type_name_ar:  string
  amount_formula:        string | null
  default_unit_code:     string | null
  dimensions:            FormSchemaDimensions
  target_api_endpoint:   string | null
  notes:                 string | null
  fields:                FormFieldDef[]
  unit_types:            UnitType[]
}

export const schemaApi = {
  formTemplates: () =>
    unwrap(api.get<FormSchema[]>('/schema/forms')),

  formSchema: (serviceTypeCode: string) =>
    unwrap(api.get<FormSchema>(`/schema/forms/${encodeURIComponent(serviceTypeCode)}`)),

  fieldOptions: (serviceTypeCode: string, sourceTable: string) =>
    unwrap(api.get<Array<{ value: string | number; label: string }>>(
      `/schema/forms/${encodeURIComponent(serviceTypeCode)}/options/${encodeURIComponent(sourceTable)}`
    )),
}
