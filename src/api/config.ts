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
masterRoutes(config, 'sub_locations', 'code', ['code', 'name'])

// Custom Expense Types routes to support gl_account_code
config.get('/expense_types', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB.prepare('SELECT code, name, gl_account_code FROM expense_types WHERE company_id = ? ORDER BY code').bind(company_id).all()
  return c.json({ success: true, data: results })
})

config.post('/expense_types', async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<{ code: number; name: string; gl_account_code?: string }>()
  if (!b.code || !b.name) return c.json({ success: false, error: 'الكود والاسم مطلوبان' }, 400)
  await c.env.DB.prepare('INSERT OR IGNORE INTO expense_types (code, company_id, name, gl_account_code) VALUES (?, ?, ?, ?)').bind(b.code, company_id, b.name, b.gl_account_code || null).run()
  return c.json({ success: true, data: null }, 201)
})

config.patch('/expense_types/:code', async (c) => {
  const { company_id } = getUser(c)
  const code = c.req.param('code')
  const { name } = await c.req.json<{ name: string }>()
  if (!name) return c.json({ success: false, error: 'الاسم مطلوب' }, 400)
  await c.env.DB.prepare('UPDATE expense_types SET name = ? WHERE code = ? AND company_id = ?').bind(name, code, company_id).run()
  return c.json({ success: true, data: null })
})

// Items (extra fields)
config.get('/items', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare(`
      SELECT i.*, ic.name as category_name 
      FROM items i 
      LEFT JOIN item_categories ic ON ic.id = i.category_id 
      WHERE i.company_id = ? 
      ORDER BY i.code
    `)
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

config.post('/items', async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<{ 
    code: number; name: string; unit?: string; warehouse?: string; 
    reorder_threshold?: number; category_id?: number; track_lots?: number 
  }>()

  if (!b.code || !b.name) return c.json({ success: false, error: 'الكود والاسم مطلوبان' }, 400)

  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO items (code, company_id, name, unit, warehouse, reorder_threshold, category_id, track_lots) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(
    b.code, company_id, b.name, b.unit ?? null, b.warehouse ?? null, 
    b.reorder_threshold ?? 0, b.category_id ?? null, b.track_lots ?? 0
  ).run()

  return c.json({ success: true, data: null }, 201)
})

config.patch('/items/:code', async (c) => {
  const { company_id } = getUser(c)
  const code = Number(c.req.param('code'))
  const b = await c.req.json<{ 
    name?: string; unit?: string; warehouse?: string; 
    reorder_threshold?: number; category_id?: number; track_lots?: number 
  }>()

  const sets = []
  const binds = []
  if (b.name) { sets.push('name = ?'); binds.push(b.name) }
  if (b.unit !== undefined) { sets.push('unit = ?'); binds.push(b.unit) }
  if (b.warehouse !== undefined) { sets.push('warehouse = ?'); binds.push(b.warehouse) }
  if (b.reorder_threshold !== undefined) { sets.push('reorder_threshold = ?'); binds.push(b.reorder_threshold) }
  if (b.category_id !== undefined) { sets.push('category_id = ?'); binds.push(b.category_id) }
  if (b.track_lots !== undefined) { sets.push('track_lots = ?'); binds.push(b.track_lots) }

  if (sets.length === 0) return c.json({ success: false, error: 'لا توجد بيانات للتحديث' }, 400)

  binds.push(code, company_id)
  await c.env.DB.prepare(
    `UPDATE items SET ${sets.join(', ')} WHERE code = ? AND company_id = ?`
  ).bind(...binds).run()

  return c.json({ success: true })
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

// ── Season Close (E-3) ───────────────────────────────────────

// GET /config/seasons/:id/close-check — pre-close validation checklist
config.get('/seasons/:id/close-check', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const season = await c.env.DB.prepare(
    'SELECT * FROM seasons WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<{ name: string; status: string; start_date: string; end_date: string }>()
  if (!season) return c.json({ success: false, error: 'الموسم غير موجود' }, 404)

  const [openWO, openPO, unmatchedBank, unpaidInv] = await Promise.all([
    // Open work orders (still active)
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM work_orders
       WHERE company_id = ? AND season_id = ? AND status IN ('pending','in_progress')`
    ).bind(company_id, id).first<{ n: number }>(),

    // Open POs (not finalized)
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM purchase_orders
       WHERE company_id = ? AND status IN ('draft','sent','partial')`
    ).bind(company_id).first<{ n: number }>(),

    // Unmatched bank statements
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM bank_statements
       WHERE company_id = ? AND is_matched = 0
         AND statement_date BETWEEN ? AND ?`
    ).bind(company_id, season.start_date, season.end_date).first<{ n: number }>(),

    // Unpaid supplier invoices linked to this season's POs
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(si.total_amount - COALESCE(si.paid_amount,0)),0) AS total
       FROM supplier_invoices si
       JOIN purchase_orders po ON po.id = si.po_id AND po.company_id = si.company_id
       WHERE si.company_id = ? AND si.total_amount > COALESCE(si.paid_amount, 0)`
    ).bind(company_id).first<{ n: number; total: number }>(),
  ])

  const checks = [
    {
      key:    'open_work_orders',
      label:  'أوامر العمل المفتوحة',
      count:  openWO?.n ?? 0,
      amount: null,
      blocker: false,
      ok:     (openWO?.n ?? 0) === 0,
    },
    {
      key:    'open_po',
      label:  'طلبات الشراء غير المكتملة',
      count:  openPO?.n ?? 0,
      amount: null,
      blocker: false,
      ok:     (openPO?.n ?? 0) === 0,
    },
    {
      key:    'unmatched_bank',
      label:  'حركات بنكية غير مطابقة',
      count:  unmatchedBank?.n ?? 0,
      amount: null,
      blocker: false,
      ok:     (unmatchedBank?.n ?? 0) === 0,
    },
    {
      key:    'unpaid_invoices',
      label:  'فواتير موردين غير مسددة',
      count:  unpaidInv?.n ?? 0,
      amount: unpaidInv?.total ?? 0,
      blocker: false,
      ok:     (unpaidInv?.n ?? 0) === 0,
    },
  ]

  return c.json({
    success: true,
    data: {
      season: { id, name: season.name, status: season.status },
      checks,
      can_close: season.status !== 'closed',
    },
  })
})

// POST /config/seasons/:id/close — formal season close
config.post('/seasons/:id/close', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const { close_notes } = await c.req.json<{ close_notes?: string }>()

  const season = await c.env.DB.prepare(
    'SELECT status FROM seasons WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<{ status: string }>()
  if (!season) return c.json({ success: false, error: 'الموسم غير موجود' }, 404)
  if (season.status === 'closed') return c.json({ success: false, error: 'الموسم مغلق مسبقاً' }, 422)

  await c.env.DB.prepare(
    `UPDATE seasons
     SET status = 'closed', closed_at = datetime('now'), closed_by = ?, close_notes = ?
     WHERE id = ? AND company_id = ?`
  ).bind(userId, close_notes ?? null, id, company_id).run()

  return c.json({ success: true, data: { id, status: 'closed' } })
})

// ── GL Integration Settings (Modular Control) ───────────────

config.get('/gl-integrations', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare('SELECT module_key, is_enabled FROM gl_integration_settings WHERE company_id = ?')
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

config.patch('/gl-integrations/:key', async (c) => {
  const { company_id } = getUser(c)
  const key = c.req.param('key')
  const { is_enabled } = await c.req.json<{ is_enabled: boolean }>()

  await c.env.DB
    .prepare(`INSERT INTO gl_integration_settings (company_id, module_key, is_enabled) 
              VALUES (?, ?, ?) 
              ON CONFLICT(company_id, module_key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled`)
    .bind(company_id, key, is_enabled ? 1 : 0).run()

  return c.json({ success: true, data: null })
})

export default config
