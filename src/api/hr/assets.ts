import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser } from '../../middleware/auth'
import { logAudit } from '../../lib/audit'

const assets = new Hono<{ Bindings: Env }>()

assets.get('/assets', async (c) => {
  const { company_id } = getUser(c)
  const empId = c.req.query('employee_id')

  let where = 'WHERE ea.company_id = ?'
  const p: unknown[] = [company_id]
  if (empId) { where += ' AND ea.employee_id = ?'; p.push(Number(empId)) }

  const { results } = await c.env.DB.prepare(
    `SELECT ea.*, e.name AS employee_name
     FROM employee_assets ea
     JOIN employees e ON e.id = ea.employee_id
     ${where}
     ORDER BY ea.assigned_date DESC LIMIT 200`
  ).bind(...p).all()
  return c.json({ success: true, data: results })
})

assets.post('/assets', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    employee_id: number; asset_name: string; asset_type?: string
    serial_number?: string; assigned_date: string; condition_in?: string; notes?: string
  }>()
  if (!b.employee_id || !b.asset_name || !b.assigned_date) {
    return c.json({ success: false, error: 'الموظف والأصل وتاريخ التسليم مطلوبة' }, 400)
  }
  const r = await c.env.DB.prepare(
    `INSERT INTO employee_assets (employee_id, company_id, asset_name, asset_type, serial_number, assigned_date, condition_in, notes)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(b.employee_id, company_id, b.asset_name, b.asset_type ?? null, b.serial_number ?? null,
         b.assigned_date, b.condition_in ?? null, b.notes ?? null).run()
  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'CREATE', table_name: 'employee_assets', record_id: r.meta.last_row_id })
  return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
})

assets.patch('/assets/:id/return', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const { return_date, condition_out, notes } = await c.req.json<{
    return_date: string; condition_out?: string; notes?: string
  }>()
  await c.env.DB.prepare(
    `UPDATE employee_assets SET return_date = ?, condition_out = ?, notes = ?
     WHERE id = ? AND company_id = ?`
  ).bind(return_date, condition_out ?? null, notes ?? null, id, company_id).run()
  return c.json({ success: true, data: null })
})

export default assets
