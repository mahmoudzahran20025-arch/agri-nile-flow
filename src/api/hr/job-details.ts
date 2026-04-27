import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser, permissionGuard } from '../../middleware/auth'
import { logAudit } from '../../lib/audit'

const jobDetails = new Hono<{ Bindings: Env }>()

jobDetails.get('/job-details', permissionGuard('hr', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare(`SELECT ejd.*, b.name AS branch_name
              FROM employee_job_details ejd
              LEFT JOIN branches b ON b.id = ejd.branch_id AND b.company_id = ejd.company_id
              WHERE ejd.company_id = ?
              ORDER BY ejd.employee_id`)
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

jobDetails.get('/job-details/:employee_id', permissionGuard('hr', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const empId = Number(c.req.param('employee_id'))
  const row = await c.env.DB
    .prepare(`SELECT ejd.*, b.name AS branch_name
              FROM employee_job_details ejd
              LEFT JOIN branches b ON b.id = ejd.branch_id AND b.company_id = ejd.company_id
              WHERE ejd.employee_id = ? AND ejd.company_id = ?`)
    .bind(empId, company_id).first()
  return c.json({ success: true, data: row ?? null })
})

jobDetails.put('/job-details/:employee_id', permissionGuard('hr', 'admin'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const empId = Number(c.req.param('employee_id'))
  const b = await c.req.json<{
    department?: string; branch_id?: number; position_level?: string
    contract_type?: string; shift_type?: string; base_salary?: number
    housing_allow?: number; transport_allow?: number; other_allows?: number
    social_insur?: number; income_tax_pct?: number; bank_name?: string
    bank_iban?: string; start_date?: string; end_date?: string; notes?: string
  }>()

  const emp = await c.env.DB.prepare('SELECT id FROM employees WHERE id = ? AND company_id = ?')
    .bind(empId, company_id).first()
  if (!emp) return c.json({ success: false, error: 'الموظف غير موجود' }, 404)

  await c.env.DB.prepare(
    `INSERT INTO employee_job_details
     (employee_id, company_id, department, branch_id, position_level, contract_type, shift_type,
      base_salary, housing_allow, transport_allow, other_allows, social_insur, income_tax_pct,
      bank_name, bank_iban, start_date, end_date, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(employee_id) DO UPDATE SET
       department      = excluded.department,
       branch_id       = excluded.branch_id,
       position_level  = excluded.position_level,
       contract_type   = excluded.contract_type,
       shift_type      = excluded.shift_type,
       base_salary     = excluded.base_salary,
       housing_allow   = excluded.housing_allow,
       transport_allow = excluded.transport_allow,
       other_allows    = excluded.other_allows,
       social_insur    = excluded.social_insur,
       income_tax_pct  = excluded.income_tax_pct,
       bank_name       = excluded.bank_name,
       bank_iban       = excluded.bank_iban,
       start_date      = excluded.start_date,
       end_date        = excluded.end_date,
       notes           = excluded.notes`
  ).bind(
    empId, company_id, b.department ?? null, b.branch_id ?? null,
    b.position_level ?? 'junior', b.contract_type ?? 'full_time', b.shift_type ?? 'morning',
    b.base_salary ?? 0, b.housing_allow ?? 0, b.transport_allow ?? 0, b.other_allows ?? 0,
    b.social_insur ?? 0, b.income_tax_pct ?? 0, b.bank_name ?? null, b.bank_iban ?? null,
    b.start_date ?? new Date().toISOString().slice(0,10), b.end_date ?? null, b.notes ?? null
  ).run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'UPSERT', table_name: 'employee_job_details', record_id: empId })
  return c.json({ success: true, data: null })
})

export default jobDetails
