import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser } from '../../middleware/auth'

const forms = new Hono<{ Bindings: Env }>()
forms.use('*', authMiddleware)

interface FormTemplate {
  id: number
  service_type_code: string
  service_type_name_ar: string
  amount_formula: string | null
  default_unit_code: string | null
  requires_field: number
  requires_season: number
  requires_supplier: number
  requires_equipment: number
  target_endpoint: string | null
  notes: string | null
}

interface FormField {
  id: number
  field_key: string
  label_ar: string
  field_type: string
  is_required: number
  sort_order: number
  default_value: string | null
  source_table: string | null
  source_filter: string | null
  validation_json: string | null
  placeholder_ar: string | null
  help_text_ar: string | null
  width_hint: string | null
}

interface UnitType {
  code: string
  name_ar: string
  quantity_based: number
}

// GET /schema/forms — list all available service_type_codes with their template summaries
forms.get('/', async (c) => {
  getUser(c) // auth check only — form_templates are global (not per-company)

  // Return only service types that are active for this company (via supplier_service_map)
  // plus the template metadata so frontend knows which forms are available
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT
       ft.id,
       ft.service_type_code,
       st.name_ar AS service_type_name_ar,
       ft.amount_formula,
       ft.default_unit_code,
       ft.requires_field,
       ft.requires_season,
       ft.requires_supplier,
       ft.requires_equipment,
       ft.target_endpoint,
       ft.notes
     FROM form_templates ft
     JOIN service_types st ON st.code = ft.service_type_code
     ORDER BY ft.service_type_code`
  ).all<FormTemplate>()

  return c.json({ success: true, data: results, count: results.length })
})

// GET /schema/forms/:service_type — full form schema for a given service_type_code
forms.get('/:service_type', async (c) => {
  getUser(c) // auth check only — form_templates are global (not per-company)
  const serviceTypeCode = c.req.param('service_type').toUpperCase()

  // Load template and fields in parallel
  const [template, fieldsResult, unitResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT
         ft.id,
         ft.service_type_code,
         st.name_ar AS service_type_name_ar,
         ft.amount_formula,
         ft.default_unit_code,
         ft.requires_field,
         ft.requires_season,
         ft.requires_supplier,
         ft.requires_equipment,
         ft.target_endpoint,
         ft.notes
       FROM form_templates ft
       JOIN service_types st ON st.code = ft.service_type_code
       WHERE ft.service_type_code = ?`
    ).bind(serviceTypeCode).first<FormTemplate>(),

    c.env.DB.prepare(
      `SELECT
         ff.id,
         ff.field_key,
         ff.label_ar,
         ff.field_type,
         ff.is_required,
         ff.sort_order,
         ff.default_value,
         ff.source_table,
         ff.source_filter,
         ff.validation_json,
         ff.placeholder_ar,
         ff.help_text_ar,
         ff.width_hint
       FROM form_fields ff
       JOIN form_templates ft ON ft.id = ff.template_id
       WHERE ft.service_type_code = ?
       ORDER BY ff.sort_order, ff.id`
    ).bind(serviceTypeCode).all<FormField>(),

    // Return unit types for any unit-selector fields
    c.env.DB.prepare(
      `SELECT code, name_ar, quantity_based FROM unit_types WHERE is_active = 1 ORDER BY code`
    ).all<UnitType>(),
  ])

  if (!template) {
    return c.json({ success: false, error: `نوع الخدمة "${serviceTypeCode}" غير موجود في قوالب النماذج` }, 404)
  }

  // Parse validation_json on each field (stored as JSON string in D1)
  const fields = fieldsResult.results.map(f => ({
    ...f,
    validation: f.validation_json ? (() => {
      try { return JSON.parse(f.validation_json!) }
      catch { return null }
    })() : null,
    validation_json: undefined, // drop raw string from response
  }))

  // Build dimension flags as structured object for frontend
  const dimensions = {
    field:     template.requires_field     === 1,
    season:    template.requires_season    === 1,
    supplier:  template.requires_supplier  === 1,
    equipment: template.requires_equipment === 1,
  }

  return c.json({
    success: true,
    data: {
      service_type_code:   template.service_type_code,
      service_type_name_ar: template.service_type_name_ar,
      amount_formula:      template.amount_formula,
      default_unit_code:   template.default_unit_code,
      dimensions,
      target_api_endpoint: template.target_endpoint,
      notes:               template.notes,
      fields,
      unit_types:          unitResult.results,
    },
  })
})

// GET /schema/forms/:service_type/options/:source_table — dynamic select options for a field
// Used by FormRenderer to populate <select> inputs from source_table metadata on each field
forms.get('/:service_type/options/:source_table', async (c) => {
  const { company_id } = getUser(c)
  const sourceTable = c.req.param('source_table')

  // Allowlist: only tables that the form schema references as source_table values
  const ALLOWED_SOURCE_TABLES: Record<string, string> = {
    fields:         `SELECT id AS value, name AS label FROM fields WHERE company_id = ? AND is_active = 1 ORDER BY name`,
    seasons:        `SELECT id AS value, name AS label FROM seasons WHERE company_id = ? ORDER BY start_date DESC`,
    suppliers:      `SELECT id AS value, name AS label FROM suppliers WHERE company_id = ? AND is_active = 1 ORDER BY name`,
    warehouses:     `SELECT id AS value, name AS label FROM warehouses WHERE company_id = ? ORDER BY name`,
    employees:      `SELECT id AS value, name AS label FROM employees WHERE company_id = ? AND is_active = 1 ORDER BY name`,
    cost_centers:   `SELECT code AS value, name_ar AS label FROM cost_centers WHERE company_id = ? ORDER BY code`,
    unit_types:     `SELECT code AS value, name_ar AS label FROM unit_types WHERE is_active = 1 ORDER BY code`,
    operation_types:`SELECT id AS value, name AS label FROM operation_types WHERE company_id = ? AND is_active = 1 ORDER BY sort_order, name`,
  }

  const query = ALLOWED_SOURCE_TABLES[sourceTable]
  if (!query) {
    return c.json({ success: false, error: `مصدر البيانات "${sourceTable}" غير مسموح به` }, 400)
  }

  // unit_types has no company_id filter
  const usesCompanyId = !['unit_types'].includes(sourceTable)

  const { results } = usesCompanyId
    ? await c.env.DB.prepare(query).bind(company_id).all<{ value: string | number; label: string }>()
    : await c.env.DB.prepare(query).all<{ value: string | number; label: string }>()

  return c.json({ success: true, data: results, count: results.length })
})

export default forms
