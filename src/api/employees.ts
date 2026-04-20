import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'

const employees = new Hono<{ Bindings: Env }>()
employees.use('*', authMiddleware)

// GET /api/employees
employees.get('/', async (c) => {
  const { company_id } = getUser(c)
  const q = c.req.query('q')
  let sql = 'SELECT * FROM employees WHERE company_id = ?'
  const params: unknown[] = [company_id]
  if (q) { sql += ' AND (name LIKE ? OR role_title LIKE ?)'; params.push(`%${q}%`, `%${q}%`) }
  sql += ' ORDER BY name'
  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ success: true, data: results })
})

// GET /api/employees/:id
employees.get('/:id', async (c) => {
  const { company_id } = getUser(c)
  const id  = Number(c.req.param('id'))
  const row = await c.env.DB
    .prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?')
    .bind(id, company_id).first()
  if (!row) return c.json({ success: false, error: 'الموظف غير موجود' }, 404)
  return c.json({ success: true, data: row })
})

// POST /api/employees
employees.post('/', async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<{
    name: string; national_id?: string; role_title?: string; phone?: string
    hire_date?: string; daily_wage?: number; notes?: string
  }>()
  if (!b.name) return c.json({ success: false, error: 'الاسم مطلوب' }, 400)

  const result = await c.env.DB.prepare(
    'INSERT INTO employees (company_id, national_id, name, role_title, phone, hire_date, daily_wage, notes) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(company_id, b.national_id ?? null, b.name, b.role_title ?? null,
     b.phone ?? null, b.hire_date ?? null, b.daily_wage ?? 0, b.notes ?? null).run()

  return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201)
})

// PATCH /api/employees/:id
employees.patch('/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const b  = await c.req.json<Record<string, unknown>>()

  const allowed = ['name','national_id','role_title','phone','hire_date','daily_wage','notes','is_active']
  const cols    = Object.keys(b).filter(k => allowed.includes(k))
  if (!cols.length) return c.json({ success: false, error: 'لا توجد حقول' }, 400)

  await c.env.DB.prepare(
    `UPDATE employees SET ${cols.map(f => `${f} = ?`).join(', ')} WHERE id = ? AND company_id = ?`
  ).bind(...cols.map(f => b[f]), id, company_id).run()

  return c.json({ success: true, data: null })
})

export default employees
