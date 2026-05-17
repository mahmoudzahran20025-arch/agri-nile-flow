/**
 * src/api/gl/event-types.ts
 *
 * Phase 2 Task 2: Event Type Standardization
 *
 * Endpoints:
 *   GET  /api/gl/event-types             — list all event types (filter by module)
 *   GET  /api/gl/event-types/:code       — get single event type by code
 *   POST /api/gl/event-types             — create custom event type (super_admin only)
 *   GET  /api/gl/event-types/resolve/:eventType — resolve event from business_events
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, roleGuard } from '../../middleware/auth'
import type { EventType } from '../../types/posting_v2'

const eventTypes = new Hono<{ Bindings: Env }>()

eventTypes.use('*', authMiddleware)
eventTypes.use('*', roleGuard(['super_admin', 'company_admin', 'accountant', 'field_supervisor']))

// ── GET /api/gl/event-types ───────────────────────────────────────────────────
// List all event types — optionally filter by module_name
eventTypes.get('/', async (c) => {
  const module = c.req.query('module')
  const active = c.req.query('active') ?? '1'

  let query = 'SELECT * FROM md_event_types WHERE 1=1'
  const params: (string | number)[] = []

  if (active === '1') {
    query += ' AND is_active = 1'
  }

  if (module) {
    query += ' AND module_name = ?'
    params.push(module.toUpperCase())
  }

  query += ' ORDER BY module_name ASC, code ASC'

  const { results } = await c.env.DB.prepare(query).bind(...params).all()

  // Group by module for convenience
  const grouped: Record<string, EventType[]> = {}
  for (const row of (results as unknown as EventType[])) {
    if (!grouped[row.module_name ?? 'OTHER']) grouped[row.module_name ?? 'OTHER'] = []
    grouped[row.module_name ?? 'OTHER'].push(row)
  }

  return c.json({
    success: true,
    data: results as unknown as EventType[],
    grouped,
    meta: { count: results.length },
  })
})

// ── GET /api/gl/event-types/modules ──────────────────────────────────────────
// List distinct modules (must register BEFORE /:code)
eventTypes.get('/modules', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT DISTINCT module_name FROM md_event_types WHERE is_active = 1 ORDER BY module_name')
    .all()

  return c.json({
    success: true,
    data: results.map((r: Record<string, unknown>) => r.module_name),
  })
})

// ── GET /api/gl/event-types/for-event/:eventType ─────────────────────────────
// Look up an md_event_types row for a given business_events.event_type string
// Fuzzy match: exact first, then LIKE
eventTypes.get('/for-event/:eventType', async (c) => {
  const code = c.req.param('eventType').toUpperCase()

  const exact = await c.env.DB
    .prepare('SELECT * FROM md_event_types WHERE code = ? AND is_active = 1')
    .bind(code)
    .first<EventType>()

  if (exact) {
    return c.json({ success: true, data: exact, match: 'exact' })
  }

  // Fuzzy: try to find closest partial match
  const fuzzy = await c.env.DB
    .prepare("SELECT * FROM md_event_types WHERE code LIKE ? AND is_active = 1 LIMIT 1")
    .bind(`%${code.split('_')[0]}%`)
    .first<EventType>()

  if (fuzzy) {
    return c.json({ success: true, data: fuzzy, match: 'fuzzy' })
  }

  return c.json({ success: false, error: `نوع الحدث "${code}" غير موجود في الأنواع المعيارية` }, 404)
})

// ── GET /api/gl/event-types/:code ────────────────────────────────────────────
eventTypes.get('/:code', async (c) => {
  const code = c.req.param('code').toUpperCase()

  const row = await c.env.DB
    .prepare('SELECT * FROM md_event_types WHERE code = ?')
    .bind(code)
    .first<EventType>()

  if (!row) {
    return c.json({ success: false, error: `نوع الحدث "${code}" غير موجود` }, 404)
  }

  return c.json({ success: true, data: row })
})

// ── POST /api/gl/event-types ─────────────────────────────────────────────────
// Create a new custom event type (super_admin only)
eventTypes.post('/', roleGuard(['super_admin']), async (c) => {
  let body: {
    code: string
    name: string
    description?: string
    module_name?: string
    affects_inventory?: number
    affects_wip?: number
    affects_cogs?: number
    affects_revenue?: number
    affects_expense?: number
    debit_role?: string
    credit_role?: string
  }

  try {
    body = await c.req.json()
  } catch {
    return c.json({ success: false, error: 'بيانات JSON غير صحيحة' }, 400)
  }

  if (!body.code || !body.name) {
    return c.json({ success: false, error: 'الكود والاسم مطلوبان' }, 400)
  }

  const code = body.code.toUpperCase().replace(/\s+/g, '_')

  // Check duplicate
  const existing = await c.env.DB
    .prepare('SELECT id FROM md_event_types WHERE code = ?')
    .bind(code)
    .first()

  if (existing) {
    return c.json({ success: false, error: `نوع الحدث "${code}" موجود مسبقاً` }, 409)
  }

  const result = await c.env.DB
    .prepare(`
      INSERT INTO md_event_types
        (code, name, description, module_name, affects_inventory, affects_wip,
         affects_cogs, affects_revenue, affects_expense, debit_role, credit_role)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      code,
      body.name,
      body.description ?? null,
      (body.module_name ?? 'GL').toUpperCase(),
      body.affects_inventory ?? 0,
      body.affects_wip       ?? 0,
      body.affects_cogs      ?? 0,
      body.affects_revenue   ?? 0,
      body.affects_expense   ?? 0,
      body.debit_role        ?? null,
      body.credit_role       ?? null,
    )
    .run()

  return c.json({
    success: true,
    data: { id: result.meta?.last_row_id, ...body },
  }, 201)
})

export default eventTypes
