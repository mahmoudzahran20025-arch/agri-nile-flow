import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'

const config = new Hono<{ Bindings: Env }>()
config.use('*', authMiddleware)

// ─── Generic CRUD factory for simple master tables ──────────
function masterRoutes(
  app: typeof config,
  table: string,
  pkField: string,
  requiredFields: string[],
) {
  // GET list
  app.get(`/${table}`, async (c) => {
    const { company_id } = getUser(c)
    const { results } = await c.env.DB
      .prepare(`SELECT * FROM ${table} WHERE company_id = ? ORDER BY ${pkField}`)
      .bind(company_id).all()
    return c.json({ success: true, data: results })
  })

  // POST create
  app.post(`/${table}`, async (c) => {
    const { company_id } = getUser(c)
    const body = await c.req.json<Record<string, unknown>>()

    for (const f of requiredFields) {
      if (!body[f]) return c.json({ success: false, error: `الحقل ${f} مطلوب` }, 400)
    }

    const cols  = ['company_id', ...requiredFields]
    const vals  = [company_id, ...requiredFields.map(f => body[f])]
    const qs    = cols.map(() => '?').join(', ')

    await c.env.DB
      .prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${qs})`)
      .bind(...vals).run()

    return c.json({ success: true, data: null }, 201)
  })

  // PATCH update (name only for simplicity)
  app.patch(`/${table}/:code`, async (c) => {
    const { company_id } = getUser(c)
    const code = c.req.param('code')
    const { name } = await c.req.json<{ name: string }>()

    if (!name) return c.json({ success: false, error: 'الاسم مطلوب' }, 400)
    await c.env.DB
      .prepare(`UPDATE ${table} SET name = ? WHERE ${pkField} = ? AND company_id = ?`)
      .bind(name, code, company_id).run()

    return c.json({ success: true, data: null })
  })
}

masterRoutes(config, 'cost_centers',  'code', ['code', 'name'])
masterRoutes(config, 'accounts',      'code', ['code', 'name'])
masterRoutes(config, 'expense_types', 'code', ['code', 'name'])
masterRoutes(config, 'sub_locations', 'code', ['code', 'name'])

// Items (extra fields)
config.get('/items', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare('SELECT * FROM items WHERE company_id = ? ORDER BY code')
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

config.post('/items', async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<{ code: number; name: string; unit?: string; warehouse?: string; reorder_threshold?: number }>()

  if (!b.code || !b.name) return c.json({ success: false, error: 'الكود والاسم مطلوبان' }, 400)

  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO items (code, company_id, name, unit, warehouse, reorder_threshold) VALUES (?,?,?,?,?,?)'
  ).bind(b.code, company_id, b.name, b.unit ?? null, b.warehouse ?? null, b.reorder_threshold ?? 0).run()

  return c.json({ success: true, data: null }, 201)
})

// Seasons
config.get('/seasons', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare('SELECT * FROM seasons WHERE company_id = ? ORDER BY start_date DESC')
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

config.post('/seasons', async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<{ name: string; season_type?: string; start_date: string; end_date: string; notes?: string }>()

  if (!b.name || !b.start_date || !b.end_date) {
    return c.json({ success: false, error: 'الاسم وتواريخ الموسم مطلوبة' }, 400)
  }

  await c.env.DB.prepare(
    'INSERT INTO seasons (company_id, name, season_type, start_date, end_date, notes) VALUES (?,?,?,?,?,?)'
  ).bind(company_id, b.name, b.season_type ?? 'winter', b.start_date, b.end_date, b.notes ?? null).run()

  return c.json({ success: true, data: null }, 201)
})

config.patch('/seasons/:id/status', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const { status } = await c.req.json<{ status: string }>()
  const allowed = ['planning', 'active', 'harvesting', 'closed']
  if (!allowed.includes(status)) return c.json({ success: false, error: 'حالة غير صالحة' }, 400)

  await c.env.DB
    .prepare('UPDATE seasons SET status = ? WHERE id = ? AND company_id = ?')
    .bind(status, id, company_id).run()

  return c.json({ success: true, data: null })
})

// Companies list (for company selector on login)
config.get('/companies', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT id, code, name FROM companies WHERE is_active = 1 ORDER BY name')
    .all()
  return c.json({ success: true, data: results })
})

export default config
