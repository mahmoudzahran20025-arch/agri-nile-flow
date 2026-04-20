import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'

const operations = new Hono<{ Bindings: Env }>()
operations.use('*', authMiddleware)

// ── Work Orders ──────────────────────────────────────────────

// GET /api/operations/orders
operations.get('/orders', async (c) => {
  const { company_id } = getUser(c)
  const season_id = c.req.query('season_id')
  const field_id  = c.req.query('field_id')
  const status    = c.req.query('status')
  const page      = Math.max(1, Number(c.req.query('page') ?? 1))
  const size      = Math.min(100, Number(c.req.query('size') ?? 50))
  const offset    = (page - 1) * size

  let sql = `SELECT wo.*, f.name AS field_name, s.name AS season_name
             FROM work_orders wo
             LEFT JOIN fields f ON f.id = wo.field_id
             LEFT JOIN seasons s ON s.id = wo.season_id
             WHERE wo.company_id = ?`
  const params: unknown[] = [company_id]

  if (season_id) { sql += ' AND wo.season_id = ?'; params.push(Number(season_id)) }
  if (field_id)  { sql += ' AND wo.field_id = ?';  params.push(Number(field_id)) }
  if (status)    { sql += ' AND wo.status = ?';    params.push(status) }

  const countRow = await c.env.DB.prepare(sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) AS n FROM').split('LIMIT')[0]).bind(...params).first<{ n: number }>()

  sql += ` ORDER BY wo.planned_date DESC LIMIT ? OFFSET ?`
  params.push(size, offset)

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ success: true, data: results, total: countRow?.n ?? 0, page, page_size: size })
})

// GET /api/operations/orders/:id  (with tasks)
operations.get('/orders/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const order = await c.env.DB.prepare(
    `SELECT wo.*, f.name AS field_name, f.area_feddan, s.name AS season_name
     FROM work_orders wo
     LEFT JOIN fields f ON f.id = wo.field_id
     LEFT JOIN seasons s ON s.id = wo.season_id
     WHERE wo.id = ? AND wo.company_id = ?`
  ).bind(id, company_id).first()
  if (!order) return c.json({ success: false, error: 'أمر العمل غير موجود' }, 404)

  const { results: tasks } = await c.env.DB.prepare(
    `SELECT wt.*, e.name AS employee_name FROM work_tasks wt
     LEFT JOIN employees e ON e.id = wt.employee_id
     WHERE wt.work_order_id = ? ORDER BY wt.task_date`
  ).bind(id).all()

  const totalCost = tasks.reduce((s: number, t: Record<string, unknown>) => s + (Number(t.total_cost) || 0), 0)
  return c.json({ success: true, data: { ...order, tasks, total_cost: totalCost } })
})

// POST /api/operations/orders
operations.post('/orders', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    name: string; operation_type: string; planned_date: string
    season_id?: number; field_id?: number; area_feddan?: number; notes?: string
  }>()
  if (!b.name || !b.operation_type || !b.planned_date) {
    return c.json({ success: false, error: 'الاسم والنوع والتاريخ مطلوبة' }, 400)
  }
  const result = await c.env.DB.prepare(
    `INSERT INTO work_orders (company_id, season_id, field_id, name, operation_type,
     planned_date, area_feddan, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(company_id, b.season_id ?? null, b.field_id ?? null, b.name, b.operation_type,
     b.planned_date, b.area_feddan ?? null, b.notes ?? null, userId).run()
  return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201)
})

// PATCH /api/operations/orders/:id/status
operations.patch('/orders/:id/status', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const { status, actual_date } = await c.req.json<{ status: string; actual_date?: string }>()
  const allowed = ['pending','in_progress','done','cancelled']
  if (!allowed.includes(status)) return c.json({ success: false, error: 'حالة غير صالحة' }, 400)
  await c.env.DB.prepare(
    'UPDATE work_orders SET status = ?, actual_date = ? WHERE id = ? AND company_id = ?'
  ).bind(status, actual_date ?? null, id, company_id).run()
  return c.json({ success: true, data: null })
})

// ── Work Tasks ───────────────────────────────────────────────

// POST /api/operations/orders/:id/tasks
operations.post('/orders/:id/tasks', async (c) => {
  const { company_id } = getUser(c)
  const orderId = Number(c.req.param('id'))
  const b = await c.req.json<{
    task_date: string; description: string; employee_id?: number
    quantity?: number; unit?: string; unit_cost?: number; notes?: string
  }>()
  if (!b.task_date || !b.description) {
    return c.json({ success: false, error: 'التاريخ والوصف مطلوبان' }, 400)
  }
  const result = await c.env.DB.prepare(
    `INSERT INTO work_tasks (work_order_id, company_id, employee_id, task_date, description,
     quantity, unit, unit_cost, notes) VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(orderId, company_id, b.employee_id ?? null, b.task_date, b.description,
     b.quantity ?? null, b.unit ?? null, b.unit_cost ?? 0, b.notes ?? null).run()
  return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201)
})

// DELETE /api/operations/tasks/:id
operations.delete('/tasks/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM work_tasks WHERE id = ? AND company_id = ?').bind(id, company_id).run()
  return c.json({ success: true, data: null })
})

// GET /api/operations/summary  (by season/field)
operations.get('/summary', async (c) => {
  const { company_id } = getUser(c)
  const season_id = c.req.query('season_id')

  let sql = `SELECT wo.operation_type,
               COUNT(*) AS order_count,
               SUM(CASE WHEN wo.status = 'done' THEN 1 ELSE 0 END) AS done_count,
               COALESCE(SUM(wt.total_cost),0) AS total_cost
             FROM work_orders wo
             LEFT JOIN work_tasks wt ON wt.work_order_id = wo.id
             WHERE wo.company_id = ?`
  const params: unknown[] = [company_id]
  if (season_id) { sql += ' AND wo.season_id = ?'; params.push(Number(season_id)) }
  sql += ' GROUP BY wo.operation_type ORDER BY total_cost DESC'

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ success: true, data: results })
})

export default operations
