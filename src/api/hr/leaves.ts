import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser, permissionGuard } from '../../middleware/auth'
import { logAudit } from '../../lib/audit'

const leaves = new Hono<{ Bindings: Env }>()

// ── Leave Types ──────────────────────────────────────────────

leaves.get('/leave-types', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare('SELECT * FROM leave_types WHERE company_id = ? AND is_active = 1 ORDER BY name')
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

leaves.post('/leave-types', async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<{ name: string; days_per_year?: number; is_paid?: number }>()
  if (!b.name) return c.json({ success: false, error: 'الاسم مطلوب' }, 400)
  const r = await c.env.DB.prepare(
    'INSERT INTO leave_types (company_id, name, days_per_year, is_paid) VALUES (?,?,?,?)'
  ).bind(company_id, b.name, b.days_per_year ?? 0, b.is_paid ?? 1).run()
  return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
})

// ── Leave Requests ───────────────────────────────────────────

leaves.get('/leave-requests', async (c) => {
  const { company_id } = getUser(c)
  const status = c.req.query('status')
  const empId  = c.req.query('employee_id')

  let where = 'WHERE lr.company_id = ?'
  const p: unknown[] = [company_id]
  if (status) { where += ' AND lr.status = ?'; p.push(status) }
  if (empId)  { where += ' AND lr.employee_id = ?'; p.push(Number(empId)) }

  const { results } = await c.env.DB.prepare(
    `SELECT lr.*, e.name AS employee_name, lt.name AS leave_type_name,
            lt.is_paid, u.full_name AS approved_by_name
     FROM leave_requests lr
     JOIN employees  e  ON e.id  = lr.employee_id AND e.company_id = lr.company_id
     JOIN leave_types lt ON lt.id = lr.leave_type_id AND lt.company_id = lr.company_id
     LEFT JOIN users u  ON u.id  = lr.approved_by
     ${where}
     ORDER BY lr.created_at DESC LIMIT 200`
  ).bind(...p).all()
  return c.json({ success: true, data: results })
})

leaves.post('/leave-requests', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    employee_id: number; leave_type_id: number; start_date: string
    end_date: string; days_count: number; reason?: string
  }>()
  if (!b.employee_id || !b.leave_type_id || !b.start_date || !b.end_date) {
    return c.json({ success: false, error: 'بيانات ناقصة' }, 400)
  }
  const r = await c.env.DB.prepare(
    `INSERT INTO leave_requests
     (employee_id, company_id, leave_type_id, start_date, end_date, days_count, reason)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(b.employee_id, company_id, b.leave_type_id, b.start_date, b.end_date,
         b.days_count ?? 1, b.reason ?? null).run()
  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'CREATE', table_name: 'leave_requests', record_id: r.meta.last_row_id })
  return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
})

leaves.patch('/leave-requests/:id/approve', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare(
    `UPDATE leave_requests SET status = 'approved', approved_by = ?, approved_at = datetime('now')
     WHERE id = ? AND company_id = ? AND status = 'pending'`
  ).bind(userId, id, company_id).run()
  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'APPROVE', table_name: 'leave_requests', record_id: id })
  return c.json({ success: true, data: null })
})

leaves.patch('/leave-requests/:id/reject', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const { notes } = await c.req.json<{ notes?: string }>()
  await c.env.DB.prepare(
    `UPDATE leave_requests SET status = 'rejected', approved_by = ?, approved_at = datetime('now'), notes = ?
     WHERE id = ? AND company_id = ? AND status = 'pending'`
  ).bind(userId, notes ?? null, id, company_id).run()
  return c.json({ success: true, data: null })
})

// ── Salary Advances ──────────────────────────────────────────

leaves.get('/salary-advances', permissionGuard('hr', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const status = c.req.query('status')
  const empId  = c.req.query('employee_id')

  let where = 'WHERE sa.company_id = ?'
  const p: unknown[] = [company_id]
  if (status) { where += ' AND sa.status = ?'; p.push(status) }
  if (empId)  { where += ' AND sa.employee_id = ?'; p.push(Number(empId)) }

  const { results } = await c.env.DB.prepare(
    `SELECT sa.*, e.name AS employee_name, u.full_name AS approved_by_name
     FROM salary_advances sa
     JOIN employees e ON e.id = sa.employee_id AND e.company_id = sa.company_id
     LEFT JOIN users u ON u.id = sa.approved_by
     ${where}
     ORDER BY sa.created_at DESC LIMIT 200`
  ).bind(...p).all()
  return c.json({ success: true, data: results })
})

leaves.post('/salary-advances', permissionGuard('hr', 'write'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    employee_id: number; request_date: string; amount: number
    reason?: string; repay_months?: number
  }>()
  if (!b.employee_id || !b.amount || !b.request_date) {
    return c.json({ success: false, error: 'الموظف والمبلغ والتاريخ مطلوبة' }, 400)
  }
  const r = await c.env.DB.prepare(
    `INSERT INTO salary_advances (employee_id, company_id, request_date, amount, reason, repay_months)
     VALUES (?,?,?,?,?,?)`
  ).bind(b.employee_id, company_id, b.request_date, b.amount, b.reason ?? null, b.repay_months ?? 1).run()
  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'CREATE', table_name: 'salary_advances', record_id: r.meta.last_row_id })
  return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
})

leaves.patch('/salary-advances/:id/approve', permissionGuard('hr', 'admin'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare(
    `UPDATE salary_advances SET status = 'approved', approved_by = ?, approved_at = datetime('now')
     WHERE id = ? AND company_id = ? AND status = 'pending'`
  ).bind(userId, id, company_id).run()
  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'APPROVE', table_name: 'salary_advances', record_id: id })
  return c.json({ success: true, data: null })
})

leaves.patch('/salary-advances/:id/reject', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare(
    `UPDATE salary_advances SET status = 'rejected', approved_by = ?, approved_at = datetime('now')
     WHERE id = ? AND company_id = ? AND status = 'pending'`
  ).bind(userId, id, company_id).run()
  return c.json({ success: true, data: null })
})

export default leaves
