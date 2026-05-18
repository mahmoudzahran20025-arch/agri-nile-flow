import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser, roleGuard } from '../middleware/auth'
import { logAudit } from '../lib/audit'
import { FinanceCore } from '../lib/finance_core'

const cropCycles = new Hono<{ Bindings: Env }>()
cropCycles.use('*', authMiddleware)
cropCycles.use('*', roleGuard(['super_admin', 'company_admin', 'field_supervisor', 'accountant']))

// ── GET /api/crop-cycles ─────────────────────────────────────────────────────
// List crop cycles. Supports filtering by field, season, status.
cropCycles.get('/', async (c) => {
  const { company_id } = getUser(c)
  const field_id  = c.req.query('field_id')
  const season_id = c.req.query('season_id')
  const status    = c.req.query('status')

  let sql = `
    SELECT cc.*,
           f.name  AS field_name,
           f.code  AS field_code,
           s.name  AS season_name,
           COALESCE(wl.total_debit,  0) AS total_wip_cost,
           COALESCE(wl.total_credit, 0) AS total_settled,
           COALESCE(wl.total_debit - wl.total_credit, 0) AS wip_balance
    FROM crop_cycles cc
    JOIN fields  f ON f.id = cc.field_id  AND f.company_id  = cc.company_id
    JOIN seasons s ON s.id = cc.season_id AND s.company_id  = cc.company_id
    LEFT JOIN (
      SELECT crop_cycle_id,
             SUM(debit)  AS total_debit,
             SUM(credit) AS total_credit
      FROM wip_ledger
      WHERE company_id = ?
      GROUP BY crop_cycle_id
    ) wl ON wl.crop_cycle_id = cc.id
    WHERE cc.company_id = ?`

  const params: unknown[] = [company_id, company_id]

  if (field_id)  { sql += ' AND cc.field_id = ?';  params.push(Number(field_id)) }
  if (season_id) { sql += ' AND cc.season_id = ?'; params.push(Number(season_id)) }
  if (status)    { sql += ' AND cc.status = ?';    params.push(status) }

  sql += ' ORDER BY cc.planting_date DESC'

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ success: true, data: results })
})

// ── GET /api/crop-cycles/:id ─────────────────────────────────────────────────
cropCycles.get('/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const cycle = await c.env.DB.prepare(`
    SELECT cc.*,
           f.name  AS field_name,
           f.code  AS field_code,
           f.area_feddan AS field_area_feddan,
           s.name  AS season_name,
           s.status AS season_status,
           COALESCE(wl.total_debit,  0) AS total_wip_cost,
           COALESCE(wl.total_credit, 0) AS total_settled,
           COALESCE(wl.total_debit - wl.total_credit, 0) AS wip_balance
    FROM crop_cycles cc
    JOIN fields  f ON f.id = cc.field_id  AND f.company_id = cc.company_id
    JOIN seasons s ON s.id = cc.season_id AND s.company_id = cc.company_id
    LEFT JOIN (
      SELECT crop_cycle_id,
             SUM(debit)  AS total_debit,
             SUM(credit) AS total_credit
      FROM wip_ledger WHERE company_id = ?
      GROUP BY crop_cycle_id
    ) wl ON wl.crop_cycle_id = cc.id
    WHERE cc.id = ? AND cc.company_id = ?
  `).bind(company_id, id, company_id).first()

  if (!cycle) return c.json({ success: false, error: 'دورة المحصول غير موجودة' }, 404)

  // WIP ledger entries for this cycle
  const { results: ledger } = await c.env.DB.prepare(`
    SELECT wl.*, s.name AS season_name
    FROM wip_ledger wl
    JOIN seasons s ON s.id = wl.season_id AND s.company_id = wl.company_id
    WHERE wl.company_id = ? AND wl.crop_cycle_id = ?
    ORDER BY wl.transaction_date ASC, wl.id ASC
  `).bind(company_id, id).all()

  return c.json({ success: true, data: { ...cycle, ledger } })
})

// ── POST /api/crop-cycles ────────────────────────────────────────────────────
cropCycles.post('/', async (c) => {
  const { company_id, sub: user_id } = getUser(c)
  const body = await c.req.json<{
    field_id:              number
    season_id:             number
    crop_name:             string
    crop_type?:            'annual' | 'long_cycle' | 'perennial'
    planting_date:         string
    expected_harvest_date?: string
    area_feddan?:          number
    center_code?:          number
    notes?:                string
  }>()

  if (!body.field_id || !body.season_id || !body.crop_name?.trim() || !body.planting_date) {
    return c.json({ success: false, error: 'field_id وseason_id واسم المحصول وتاريخ الزراعة مطلوبة' }, 400)
  }

  // Verify field and season belong to company
  const field = await c.env.DB.prepare(
    'SELECT id, area_feddan FROM fields WHERE id = ? AND company_id = ?'
  ).bind(body.field_id, company_id).first<{ id: number; area_feddan: number }>()
  if (!field) return c.json({ success: false, error: 'القطعة غير موجودة' }, 404)

  const season = await c.env.DB.prepare(
    'SELECT id, status FROM seasons WHERE id = ? AND company_id = ?'
  ).bind(body.season_id, company_id).first<{ id: number; status: string }>()
  if (!season) return c.json({ success: false, error: 'الموسم غير موجود' }, 404)
  if (season.status === 'closed') {
    return c.json({ success: false, error: 'لا يمكن إنشاء دورة محصول في موسم مغلق' }, 422)
  }

  const { meta } = await c.env.DB.prepare(`
    INSERT INTO crop_cycles
      (company_id, field_id, season_id, crop_name, crop_type,
       planting_date, expected_harvest_date, area_feddan, center_code, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    company_id,
    body.field_id,
    body.season_id,
    body.crop_name.trim(),
    body.crop_type ?? 'annual',
    body.planting_date,
    body.expected_harvest_date ?? null,
    body.area_feddan ?? field.area_feddan ?? null,
    body.center_code ?? null,
    body.notes?.trim() ?? null,
    user_id,
  ).run()

  const newId = meta.last_row_id

  await logAudit(c.env.DB, {
    user_id, company_id,
    action:     'CREATE',
    table_name: 'crop_cycles',
    record_id:  newId,
    new_value:  body,
  })

  return c.json({ success: true, data: { id: newId } }, 201)
})

// ── PATCH /api/crop-cycles/:id ───────────────────────────────────────────────
// Update mutable fields. Status transitions handled separately via /status.
cropCycles.patch('/:id', async (c) => {
  const { company_id, sub: user_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{
    crop_name?:             string
    expected_harvest_date?: string
    area_feddan?:           number
    center_code?:           number
    notes?:                 string
  }>()

  const existing = await c.env.DB.prepare(
    'SELECT id, status FROM crop_cycles WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<{ id: number; status: string }>()
  if (!existing) return c.json({ success: false, error: 'دورة المحصول غير موجودة' }, 404)
  if (existing.status === 'harvested') {
    return c.json({ success: false, error: 'لا يمكن تعديل دورة محصول مكتملة' }, 422)
  }

  const sets: string[]   = ['updated_at = datetime(\'now\')']
  const params: unknown[] = []

  if (body.crop_name !== undefined)             { sets.push('crop_name = ?');             params.push(body.crop_name.trim()) }
  if (body.expected_harvest_date !== undefined) { sets.push('expected_harvest_date = ?'); params.push(body.expected_harvest_date) }
  if (body.area_feddan !== undefined)           { sets.push('area_feddan = ?');           params.push(body.area_feddan) }
  if (body.center_code !== undefined)           { sets.push('center_code = ?');           params.push(body.center_code) }
  if (body.notes !== undefined)                 { sets.push('notes = ?');                 params.push(body.notes?.trim() ?? null) }

  if (sets.length === 1) return c.json({ success: false, error: 'لا توجد حقول للتحديث' }, 400)

  params.push(id, company_id)
  await c.env.DB.prepare(
    `UPDATE crop_cycles SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`
  ).bind(...params).run()

  await logAudit(c.env.DB, {
    user_id, company_id,
    action:     'UPDATE',
    table_name: 'crop_cycles',
    record_id:  id,
    new_value:  body,
  })

  return c.json({ success: true })
})

// ── POST /api/crop-cycles/:id/status ─────────────────────────────────────────
// All terminal transitions now have dedicated accounting-aware endpoints.
// This endpoint is kept only to return clear redirect errors for legacy callers.
cropCycles.post('/:id/status', async (c) => {
  const body = await c.req.json<{ status?: string }>().catch(() => ({ status: undefined }))
  if (body.status === 'abandoned') {
    return c.json({
      success: false,
      error: 'استخدم POST /crop-cycles/:id/abandon لترك دورة المحصول — يُجري محاسبة GL كاملة وتصفية WIP.',
    }, 400)
  }
  return c.json({
    success: false,
    error: 'استخدم POST /crop-cycles/:id/write-off للشطب — يُجري محاسبة GL كاملة وتصفية WIP.',
  }, 400)
})

// ── GET /api/crop-cycles/:id/wip-summary ─────────────────────────────────────
// WIP balance breakdown by cost_category — used by settlement wizard and reports.
cropCycles.get('/:id/wip-summary', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const cycle = await c.env.DB.prepare(
    'SELECT id, crop_name, status FROM crop_cycles WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<{ id: number; crop_name: string; status: string }>()
  if (!cycle) return c.json({ success: false, error: 'دورة المحصول غير موجودة' }, 404)

  const { results: byCategory } = await c.env.DB.prepare(`
    SELECT cost_category,
           SUM(debit)  AS total_debit,
           SUM(credit) AS total_credit,
           SUM(debit)  - SUM(credit) AS balance
    FROM wip_ledger
    WHERE company_id = ? AND crop_cycle_id = ?
    GROUP BY cost_category
    ORDER BY balance DESC
  `).bind(company_id, id).all<{
    cost_category: string; total_debit: number; total_credit: number; balance: number
  }>()

  const { results: bySeason } = await c.env.DB.prepare(`
    SELECT wl.season_id, s.name AS season_name,
           SUM(wl.debit)  AS total_debit,
           SUM(wl.credit) AS total_credit,
           SUM(wl.debit)  - SUM(wl.credit) AS balance
    FROM wip_ledger wl
    JOIN seasons s ON s.id = wl.season_id AND s.company_id = wl.company_id
    WHERE wl.company_id = ? AND wl.crop_cycle_id = ?
    GROUP BY wl.season_id
    ORDER BY wl.season_id ASC
  `).bind(company_id, id).all<{
    season_id: number; season_name: string; total_debit: number; total_credit: number; balance: number
  }>()

  const { results: bySource } = await c.env.DB.prepare(`
    SELECT source_module,
           SUM(debit)  AS total_debit,
           SUM(credit) AS total_credit,
           SUM(debit)  - SUM(credit) AS balance
    FROM wip_ledger
    WHERE company_id = ? AND crop_cycle_id = ?
    GROUP BY source_module
    ORDER BY balance DESC
  `).bind(company_id, id).all<{
    source_module: string; total_debit: number; total_credit: number; balance: number
  }>()

  const totalWip = byCategory.reduce((s, r) => s + r.balance, 0)

  return c.json({
    success: true,
    data: {
      crop_cycle_id: id,
      crop_name:     cycle.crop_name,
      status:        cycle.status,
      total_wip:     Math.round(totalWip * 100) / 100,
      by_category:   byCategory,
      by_season:     bySeason,
      by_source:     bySource,
    },
  })
})

// ── POST /api/crop-cycles/:id/write-off — GL-posted write-off ────────────────
// Posts a loss entry to GL (agricultural_loss_writeoff account) and zeros WIP.
// Use this instead of /status for written_off transitions.
cropCycles.post('/:id/write-off', async (c) => {
  const { company_id, sub: user_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ writeoff_date?: string; notes?: string }>()

  const writeoff_date = body.writeoff_date ?? new Date().toISOString().slice(0, 10)

  try {
    const result = await FinanceCore.postCycleWriteOff(c.env.DB, {
      company_id,
      user_id,
      crop_cycle_id:  id,
      writeoff_date,
      notes:          body.notes,
    })

    await logAudit(c.env.DB, {
      user_id, company_id,
      action: 'UPDATE', table_name: 'crop_cycles', record_id: id,
      new_value: { status: 'written_off', writeoff_date, wip_written_off: result.wip_written_off },
    })

    return c.json({ success: true, data: result })
  } catch (err) {
    const msg = (err as Error).message
    const status = msg.startsWith('WRITEOFF:') ? 422 : 500
    return c.json({ success: false, error: msg }, status)
  }
})

// ── POST /api/crop-cycles/:id/abandon — GL-posted abandonment write-off ──────
// Posts a loss entry to GL and zeros out WIP ledger. Uses abandonment_policy
// from crop_cycles to select the correct loss account (operating vs extraordinary).
cropCycles.post('/:id/abandon', async (c) => {
  const { company_id, sub: user_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ abandonment_date?: string; notes?: string }>()

  const abandonment_date = body.abandonment_date ?? new Date().toISOString().slice(0, 10)

  try {
    const result = await FinanceCore.postCycleAbandonment(c.env.DB, {
      company_id,
      user_id,
      crop_cycle_id:   id,
      abandonment_date,
      notes:           body.notes,
    })

    await logAudit(c.env.DB, {
      user_id, company_id,
      action: 'UPDATE', table_name: 'crop_cycles', record_id: id,
      new_value: { status: 'abandoned', abandonment_date, wip_written_off: result.wip_written_off },
    })

    return c.json({ success: true, data: result })
  } catch (err) {
    const msg = (err as Error).message
    const status = msg.startsWith('ABANDONMENT:') ? 422 : 500
    return c.json({ success: false, error: msg }, status)
  }
})

export default cropCycles
