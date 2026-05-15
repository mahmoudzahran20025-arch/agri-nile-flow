import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'
import { FinanceCore } from '../lib/finance_core'
import { logAudit } from '../lib/audit'

const config = new Hono<{ Bindings: Env }>()
config.use('*', authMiddleware)

// ─── Generic CRUD factory for simple master tables ──────────
function masterRoutes(
  app: typeof config,
  table: string,
  pkField: string,
  requiredFields: string[],
  opts?: { nameField?: string },
) {
  const nameField = opts?.nameField ?? 'name'
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
      .prepare(`UPDATE ${table} SET ${nameField} = ? WHERE ${pkField} = ? AND company_id = ?`)
      .bind(name, code, company_id).run()

    return c.json({ success: true, data: null })
  })
}

masterRoutes(config, 'cost_centers',  'code', ['code', 'name_ar'], { nameField: 'name_ar' })
masterRoutes(config, 'accounts',      'code', ['code', 'name'])
masterRoutes(config, 'sub_locations', 'code', ['code', 'name'])

// ── Operation Types CRUD ─────────────────────────────────────
config.get('/operation_types', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare('SELECT id, name, sort_order, is_active FROM operation_types WHERE company_id = ? ORDER BY sort_order, name')
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

config.post('/operation_types', async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<{ name: string; sort_order?: number }>()
  if (!b.name?.trim()) return c.json({ success: false, error: 'الاسم مطلوب' }, 400)
  const sort = b.sort_order ?? 0
  try {
    const row = await c.env.DB
      .prepare('INSERT INTO operation_types (company_id, name, sort_order) VALUES (?, ?, ?) RETURNING id, name, sort_order, is_active')
      .bind(company_id, b.name.trim(), sort).first()
    return c.json({ success: true, data: row }, 201)
  } catch {
    return c.json({ success: false, error: 'الاسم موجود بالفعل' }, 409)
  }
})

config.patch('/operation_types/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const b = await c.req.json<{ name?: string; sort_order?: number; is_active?: number }>()
  if (!id) return c.json({ success: false, error: 'id غير صالح' }, 400)

  const parts: string[] = []
  const vals: unknown[]  = []
  if (b.name        !== undefined) { parts.push('name = ?');       vals.push(b.name.trim()) }
  if (b.sort_order  !== undefined) { parts.push('sort_order = ?'); vals.push(b.sort_order)  }
  if (b.is_active   !== undefined) { parts.push('is_active = ?');  vals.push(b.is_active)   }
  if (parts.length === 0) return c.json({ success: false, error: 'لا يوجد حقل للتحديث' }, 400)

  vals.push(id, company_id)
  await c.env.DB
    .prepare(`UPDATE operation_types SET ${parts.join(', ')} WHERE id = ? AND company_id = ?`)
    .bind(...vals).run()
  return c.json({ success: true, data: null })
})

config.delete('/operation_types/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  if (!id) return c.json({ success: false, error: 'id غير صالح' }, 400)
  // Soft-delete: mark inactive so existing work orders retain their type string
  await c.env.DB
    .prepare('UPDATE operation_types SET is_active = 0 WHERE id = ? AND company_id = ?')
    .bind(id, company_id).run()
  return c.json({ success: true, data: null })
})

// Expense Types — READ-ONLY audit view (deprecated; use service_types for new data)
// POST and PATCH removed: expense_types is frozen. Use service_types for all new classifications.
config.get('/expense_types', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB.prepare(
    'SELECT code, name, gl_account_code FROM expense_types WHERE company_id = ? AND is_deprecated = 0 ORDER BY code'
  ).bind(company_id).all()
  return c.json({ success: true, data: results })
})

// Items (extra fields)
config.get('/items', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare(`
      SELECT i.*, ic.name as category_name,
             CASE WHEN EXISTS (
               SELECT 1 FROM inventory_movements im
               WHERE im.item_code = i.code AND im.company_id = i.company_id
             ) THEN 1 ELSE 0 END AS has_movements
      FROM items i
      LEFT JOIN item_categories ic ON ic.id = i.category_id
      WHERE i.company_id = ?
      ORDER BY has_movements DESC, i.code
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
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const { status } = await c.req.json<{ status: string }>()
  const allowed = ['planning', 'active', 'harvesting', 'closed']
  if (!allowed.includes(status)) return c.json({ success: false, error: 'حالة غير صالحة' }, 400)

  const before = await c.env.DB.prepare('SELECT status FROM seasons WHERE id = ? AND company_id = ?')
    .bind(id, company_id).first<{ status: string }>()

  await c.env.DB
    .prepare('UPDATE seasons SET status = ? WHERE id = ? AND company_id = ?')
    .bind(status, id, company_id).run()

  void logAudit(c.env.DB, {
    user_id: Number(userId), company_id,
    action: 'UPDATE', table_name: 'seasons', record_id: id,
    old_value: before ? { status: before.status } : undefined,
    new_value: { status },
  })

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

    // Open AP balance: unmatched supplier invoices (entry_type='د', is_matched=0)
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(sal.net_ap_balance), 0) AS total
       FROM supplier_ap_ledger sal
       WHERE sal.company_id = ? AND sal.net_ap_balance > 0`
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

  let wipEntries: Array<{ field_id: number; crop_name: string; cost_balance: number }> = []
  try {
    // Carry forward any unfinished crops to next season
    wipEntries = await FinanceCore.carryForwardWIP(c.env.DB, {
      company_id,
      season_id: id,
      user_id: userId,
    })
  } catch (err: any) {
    console.warn('WIP carry-forward warning (non-fatal):', err.message)
    // Don't fail season close if WIP carry-forward fails
  }

  await c.env.DB.prepare(
    `UPDATE seasons
     SET status = 'closed', closed_at = datetime('now'), closed_by = ?, close_notes = ?
     WHERE id = ? AND company_id = ?`
  ).bind(userId, close_notes ?? null, id, company_id).run()

  void logAudit(c.env.DB, {
    user_id: userId, company_id,
    action: 'UPDATE', table_name: 'seasons', record_id: id,
    old_value: { status: season.status },
    new_value: { status: 'closed', wip_carried: wipEntries.length, close_notes: close_notes ?? null },
  })

  return c.json({ success: true, data: { id, status: 'closed', wip_carried: wipEntries.length, wip_details: wipEntries } })
})

// ── GET /config/wip — list WIP balances (pending carry-forwards) ─────────────
config.get('/wip', async (c) => {
  const { company_id } = getUser(c)
  const seasonId = c.req.query('season_id')
  const status   = c.req.query('status') ?? 'pending'

  const conditions = ['wb.company_id = ?']
  const params: (string | number)[] = [company_id]

  if (seasonId) { conditions.push('wb.from_season_id = ?'); params.push(Number(seasonId)) }
  if (status !== 'all') { conditions.push('wb.status = ?'); params.push(status) }

  const { results } = await c.env.DB.prepare(
    `SELECT
       wb.id, wb.from_season_id, wb.to_season_id, wb.field_id, wb.crop_name,
       wb.cost_balance, wb.journal_entry_id, wb.status, wb.created_at,
       f.name AS field_name,
       sf.name AS from_season_name,
       st.name AS to_season_name
     FROM wip_balances wb
     LEFT JOIN fields  f  ON f.id  = wb.field_id AND f.company_id = wb.company_id
     LEFT JOIN seasons sf ON sf.id = wb.from_season_id
     LEFT JOIN seasons st ON st.id = wb.to_season_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY wb.created_at DESC`
  ).bind(...params).all<{
    id: number; from_season_id: number; to_season_id: number | null
    field_id: number; crop_name: string; cost_balance: number
    journal_entry_id: number | null; status: string; created_at: string
    field_name: string | null; from_season_name: string | null; to_season_name: string | null
  }>()

  const total_cost = results.reduce((s, r) => s + r.cost_balance, 0)

  return c.json({ success: true, data: results, total_cost })
})

// ── POST /config/wip/:id/assign — assign WIP balance to next season ──────────
config.post('/wip/:id/assign', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const { to_season_id } = await c.req.json<{ to_season_id: number }>()

  if (!to_season_id) return c.json({ success: false, error: 'to_season_id required' }, 400)

  const wip = await c.env.DB.prepare(
    'SELECT id, status FROM wip_balances WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<{ id: number; status: string }>()

  if (!wip)                   return c.json({ success: false, error: 'WIP entry not found' }, 404)
  if (wip.status !== 'pending') return c.json({ success: false, error: 'يمكن تعيين الموسم فقط للقيود المعلقة' }, 422)

  const season = await c.env.DB.prepare(
    'SELECT id FROM seasons WHERE id = ? AND company_id = ?'
  ).bind(to_season_id, company_id).first<{ id: number }>()
  if (!season) return c.json({ success: false, error: 'الموسم المستهدف غير موجود' }, 404)

  await c.env.DB.prepare(
    `UPDATE wip_balances SET to_season_id = ?, status = 'carried' WHERE id = ? AND company_id = ?`
  ).bind(to_season_id, id, company_id).run()

  return c.json({ success: true, data: { id, status: 'carried', to_season_id } })
})

// ── POST /config/wip/carry-forward — trigger WIP carry-forward for a season ──
// Wraps FinanceCore.carryForwardWIP; safe to call multiple times (idempotent).
config.post('/wip/carry-forward', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const { season_id } = await c.req.json<{ season_id: number }>()
  if (!season_id) return c.json({ success: false, error: 'season_id مطلوب' }, 400)

  const season = await c.env.DB.prepare(
    'SELECT id, name FROM seasons WHERE id = ? AND company_id = ?'
  ).bind(season_id, company_id).first<{ id: number; name: string }>()
  if (!season) return c.json({ success: false, error: 'الموسم غير موجود' }, 404)

  try {
    const entries = await FinanceCore.carryForwardWIP(c.env.DB, {
      company_id, season_id, user_id: userId,
    })
    return c.json({ success: true, data: { entries_created: entries.length, entries } })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.json({ success: false, error: msg }, 500)
  }
})

// ── GL Integration Settings (Modular Control) ───────────────

config.get('/gl-integrations', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare('SELECT module_key, is_enabled FROM gl_integration_settings WHERE company_id = ?')
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

const ALLOWED_GL_INTEGRATION_KEYS = new Set(['inventory', 'operations', 'hr_payroll', 'harvest'])

async function moduleReadinessBlockers(db: Env['DB'], companyId: number, moduleKey: string): Promise<string[]> {
  const [
    catchAllGeneral,
    catchAllInventory,
    suppliersMissing,
    itemsMissing,
    warehousesMissing,
  ] = await Promise.all([
    db.prepare(
      'SELECT COUNT(*) AS n FROM posting_rules WHERE company_id = ? AND bus_posting_group_code IS NULL AND prod_posting_group_code IS NULL AND is_active = 1'
    ).bind(companyId).first<{ n: number }>(),
    db.prepare(
      'SELECT COUNT(*) AS n FROM inventory_posting_setup WHERE company_id = ? AND inv_posting_group_code IS NULL AND prod_posting_group_code IS NULL AND is_active = 1'
    ).bind(companyId).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM suppliers WHERE company_id = ? AND bus_posting_group_code IS NULL').bind(companyId).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM items WHERE company_id = ? AND prod_posting_group_code IS NULL').bind(companyId).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM warehouses WHERE company_id = ? AND inv_posting_group_code IS NULL').bind(companyId).first<{ n: number }>(),
  ])

  const hasGeneral = (catchAllGeneral?.n ?? 0) > 0
  const hasInventory = (catchAllInventory?.n ?? 0) > 0
  const suppliersMissingCount = suppliersMissing?.n ?? 0
  const itemsMissingCount = itemsMissing?.n ?? 0
  const warehousesMissingCount = warehousesMissing?.n ?? 0

  const blockers: string[] = []
  if (moduleKey === 'inventory') {
    if (!hasInventory) blockers.push('قاعدة المخزون الافتراضية (NULL×NULL) غير موجودة')
    if (itemsMissingCount > 0) blockers.push(`يوجد ${itemsMissingCount} صنف بدون Product Posting Group`)
    if (warehousesMissingCount > 0) blockers.push(`يوجد ${warehousesMissingCount} مستودع بدون Inventory Posting Group`)
    return blockers
  }

  if (!hasGeneral) blockers.push('قاعدة الترحيل العامة الافتراضية (NULL×NULL) غير موجودة')
  if (suppliersMissingCount > 0) blockers.push(`يوجد ${suppliersMissingCount} مورد بدون Business Posting Group`)
  return blockers
}

config.patch('/gl-integrations/:key', async (c) => {
  const { company_id, sub: userId, role } = getUser(c)
  const key = c.req.param('key')
  const force = c.req.query('force') === '1'
  const { is_enabled, reason } = await c.req.json<{ is_enabled: boolean; reason?: string }>()

  if (!ALLOWED_GL_INTEGRATION_KEYS.has(key)) {
    return c.json({ success: false, error: 'الموديول غير معروف في حوكمة الربط' }, 400)
  }

  if (typeof is_enabled !== 'boolean') {
    return c.json({ success: false, error: 'is_enabled يجب أن تكون true أو false' }, 400)
  }

  const blockers = is_enabled ? await moduleReadinessBlockers(c.env.DB, company_id, key) : []

  if (blockers.length > 0 && !force) {
    return c.json({
      success: false,
      error: 'لا يمكن تفعيل الموديول قبل اكتمال جاهزية الترحيل',
      blockers,
      hint: 'أكمل التهيئة من /gl/posting-setup أو استخدم force=1 بصلاحية super_admin مع سبب واضح',
    }, 409)
  }

  if (blockers.length > 0 && force) {
    if (role !== 'super_admin') {
      return c.json({ success: false, error: 'تفعيل force متاح فقط لصلاحية super_admin' }, 403)
    }
    if (!reason || reason.trim().length < 8) {
      return c.json({ success: false, error: 'عند force يجب إدخال سبب واضح لا يقل عن 8 أحرف' }, 400)
    }
  }

  await c.env.DB
    .prepare(`INSERT INTO gl_integration_settings (company_id, module_key, is_enabled) 
              VALUES (?, ?, ?) 
              ON CONFLICT(company_id, module_key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled`)
    .bind(company_id, key, is_enabled ? 1 : 0).run()

  void logAudit(c.env.DB, {
    user_id: userId,
    company_id,
    action: 'UPSERT',
    table_name: 'gl_integration_settings',
    record_id: null,
    new_value: {
      module_key: key,
      is_enabled,
      forced: force,
      reason: reason ?? null,
      blockers,
    },
  })

  return c.json({ success: true, data: null })
})

// ─── Equipment Types ────────────────────────────────────────
config.get('/equipment_types', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB.prepare(
    `SELECT id, code, name, category, asset_nature, default_life_months, is_active
     FROM equipment_types WHERE company_id = ? ORDER BY category, name`
  ).bind(company_id).all()
  return c.json({ success: true, data: results })
})

config.post('/equipment_types', async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<{
    code: string; name: string; category?: string
    asset_nature?: string; default_life_months?: number; notes?: string
  }>()

  if (!b.code || !b.name) {
    return c.json({ success: false, error: 'الكود والاسم مطلوبان' }, 400)
  }

  const allowed_nature = ['capital', 'consumable']
  if (b.asset_nature && !allowed_nature.includes(b.asset_nature)) {
    return c.json({ success: false, error: 'طبيعة الأصل غير صالحة (capital/consumable)' }, 400)
  }

  await c.env.DB.prepare(`
    INSERT INTO equipment_types
    (company_id, code, name, category, asset_nature, default_life_months, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    company_id, b.code, b.name,
    b.category ?? 'other',
    b.asset_nature ?? 'capital',
    b.default_life_months ?? 60,
    b.notes ?? null
  ).run()

  return c.json({ success: true, data: null }, 201)
})

config.patch('/equipment_types/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const b = await c.req.json<{
    name?: string; category?: string; asset_nature?: string
    default_life_months?: number; is_active?: number; notes?: string
  }>()

  const sets = []
  const binds = []

  if (b.name !== undefined) { sets.push('name = ?'); binds.push(b.name) }
  if (b.category !== undefined) { sets.push('category = ?'); binds.push(b.category) }
  if (b.asset_nature !== undefined) { sets.push('asset_nature = ?'); binds.push(b.asset_nature) }
  if (b.default_life_months !== undefined) { sets.push('default_life_months = ?'); binds.push(b.default_life_months) }
  if (b.is_active !== undefined) { sets.push('is_active = ?'); binds.push(b.is_active) }
  if (b.notes !== undefined) { sets.push('notes = ?'); binds.push(b.notes) }

  if (sets.length === 0) return c.json({ success: false, error: 'لا توجد بيانات للتحديث' }, 400)

  binds.push(id, company_id)
  await c.env.DB.prepare(
    `UPDATE equipment_types SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`
  ).bind(...binds).run()

  return c.json({ success: true, data: null })
})

export default config
