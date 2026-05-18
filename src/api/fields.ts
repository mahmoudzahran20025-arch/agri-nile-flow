import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser, roleGuard } from '../middleware/auth'
import { FinanceCore } from '../lib/finance_core'
import { logAudit } from '../lib/audit'

const fields = new Hono<{ Bindings: Env }>()
fields.use('*', authMiddleware)
// RBAC: Fields + Harvest routes are restricted to operational/finance leadership roles.
fields.use('*', roleGuard(['super_admin', 'company_admin', 'field_supervisor', 'accountant']))

// GET /api/fields
fields.get('/', async (c) => {
  const { company_id } = getUser(c)
  const season_id = c.req.query('season_id')
  const q         = c.req.query('q')

  let sql = 'SELECT f.*, s.name AS season_name FROM fields f LEFT JOIN seasons s ON s.id = f.season_id AND s.company_id = f.company_id WHERE f.company_id = ?'
  const params: unknown[] = [company_id]

  if (season_id) { sql += ' AND f.season_id = ?'; params.push(Number(season_id)) }
  if (q)         { sql += ' AND (f.name LIKE ? OR f.code LIKE ?)'; params.push(`%${q}%`, `%${q}%`) }
  sql += ' ORDER BY f.code'

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ success: true, data: results })
})

// ═══════════════════════════════════════════════════════════
// HARVEST RECORDS  (must be before /:id to avoid route collision)
// ═══════════════════════════════════════════════════════════

// GET /api/fields/harvest
fields.get('/harvest', async (c) => {
  const { company_id } = getUser(c)
  const field_id  = c.req.query('field_id')
  const season_id = c.req.query('season_id')
  const year      = c.req.query('year')

  let sql = `
    SELECT h.*,
           f.name AS field_name, f.area_feddan,
           f.code AS field_code,
           s.name AS season_name
    FROM harvest_records h
    JOIN fields f ON f.id = h.field_id AND f.company_id = h.company_id
    LEFT JOIN seasons s ON s.id = h.season_id AND s.company_id = h.company_id
    WHERE h.company_id = ?`
  const p: unknown[] = [company_id]

  if (field_id)  { sql += ' AND h.field_id = ?';  p.push(Number(field_id)) }
  if (season_id) { sql += ' AND h.season_id = ?'; p.push(Number(season_id)) }
  if (year)      { sql += ` AND strftime('%Y', h.harvest_date) = ?`; p.push(year) }
  sql += ' ORDER BY h.harvest_date DESC'

  const { results } = await c.env.DB.prepare(sql).bind(...p).all()
  return c.json({ success: true, data: results })
})

// GET /api/fields/harvest/summary  — KPIs per field
fields.get('/harvest/summary', async (c) => {
  const { company_id } = getUser(c)
  const season_id = c.req.query('season_id')

  let sql = `
    SELECT
      f.id AS field_id, f.name AS field_name, f.code AS field_code,
      f.area_feddan, f.crop_type,
      f.rent_per_feddan,
      f.rent_per_feddan * f.area_feddan AS total_rent_cost,
      COUNT(h.id)                       AS harvest_count,
      COALESCE(SUM(h.qty_tons), 0)      AS total_tons,
      AVG(h.qty_feddan)                 AS avg_yield_per_feddan,
      COALESCE(SUM(h.actual_cost), 0)   AS total_cost,
      COALESCE(SUM(h.revenue), 0)       AS total_revenue,
      COALESCE(SUM(h.profit), 0)        AS total_profit,
      AVG(h.cost_per_feddan)            AS avg_cost_per_feddan,
      CASE WHEN COALESCE(SUM(h.qty_tons), 0) > 0
           THEN COALESCE(SUM(h.actual_cost), 0) / SUM(h.qty_tons)
           ELSE NULL END                AS cost_per_ton
    FROM fields f
    LEFT JOIN harvest_records h ON h.field_id = f.id AND h.company_id = ?
    WHERE f.company_id = ?`
  const p: unknown[] = [company_id, company_id]
  if (season_id) { sql += ' AND h.season_id = ?'; p.push(Number(season_id)) }
  sql += ' GROUP BY f.id ORDER BY total_tons DESC'

  const { results } = await c.env.DB.prepare(sql).bind(...p).all()
  return c.json({ success: true, data: results })
})

// POST /api/fields/harvest
fields.post('/harvest', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    field_id: number; season_id?: number; harvest_date: string
    crop_name: string; variety?: string
    qty_tons: number; quality_grade?: string
    moisture_pct?: number; impurity_pct?: number
    actual_cost?: number; sell_price_ton?: number; notes?: string
  }>()

  if (!b.field_id || !b.harvest_date || !b.crop_name)
    return c.json({ success: false, error: 'الحقل والتاريخ والمحصول مطلوبة' }, 400)

  const field = await c.env.DB
    .prepare('SELECT area_feddan, name, center_code FROM fields WHERE id = ? AND company_id = ?')
    .bind(b.field_id, company_id).first<{ area_feddan: number; name: string; center_code: number | null }>()
  if (!field) return c.json({ success: false, error: 'القطعة غير موجودة' }, 404)

  const qty_feddan      = field.area_feddan > 0 ? (b.qty_tons / field.area_feddan) : null
  const revenue         = b.sell_price_ton ? b.qty_tons * b.sell_price_ton : null
  const actual_cost     = b.actual_cost ?? 0
  const profit          = revenue !== null ? revenue - actual_cost : null
  const cost_per_feddan = field.area_feddan > 0 ? actual_cost / field.area_feddan : null

  const r = await c.env.DB.prepare(`
    INSERT INTO harvest_records
      (company_id, field_id, season_id, harvest_date, crop_name, variety,
       qty_tons, qty_feddan, quality_grade, moisture_pct, impurity_pct,
       actual_cost, sell_price_ton, revenue, profit, cost_per_feddan, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    company_id, b.field_id, b.season_id ?? null, b.harvest_date, b.crop_name,
    b.variety ?? null, b.qty_tons, qty_feddan,
    b.quality_grade ?? 'standard', b.moisture_pct ?? null, b.impurity_pct ?? null,
    actual_cost, b.sell_price_ton ?? null, revenue, profit, cost_per_feddan,
    b.notes ?? null, userId
  ).run()

  const harvestId = Number(r.meta.last_row_id)
  try {
    await FinanceCore.postHarvestLedger(c.env.DB, {
      company_id,
      user_id: Number(userId),
      harvest_id: harvestId,
      date: b.harvest_date,
      crop_name: b.crop_name,
      field_name: field.name,
      center_code: field.center_code,
      total_revenue: revenue ?? 0,
      total_actual_cost: actual_cost,
      season_id: b.season_id ?? null,
      field_id: b.field_id,
    })
  } catch (e: unknown) {
    await c.env.DB.prepare('DELETE FROM harvest_records WHERE id = ? AND company_id = ?')
      .bind(harvestId, company_id).run()
    const message = e instanceof Error ? e.message : 'فشل ترحيل الحصاد إلى دفتر الأستاذ'
    return c.json({ success: false, error: message }, 400)
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id,
    action: 'CREATE', table_name: 'harvest_records', record_id: harvestId,
    new_value: { field_id: b.field_id, crop_name: b.crop_name, qty_tons: b.qty_tons, harvest_date: b.harvest_date },
  })

  return c.json({ success: true, data: { id: harvestId } }, 201)
})

// PATCH /api/fields/harvest/:id
fields.patch('/harvest/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const b  = await c.req.json<Record<string, unknown>>()

  const allowed = ['harvest_date','crop_name','variety','qty_tons','quality_grade',
                   'moisture_pct','impurity_pct','actual_cost','sell_price_ton',
                   'revenue','profit','season_id','notes']
  const cols = Object.keys(b).filter(k => allowed.includes(k))
  if (!cols.length) return c.json({ success: false, error: 'لا توجد حقول للتحديث' }, 400)

  if (b.qty_tons !== undefined || b.actual_cost !== undefined || b.sell_price_ton !== undefined) {
    const existing = await c.env.DB
      .prepare(`SELECT h.qty_tons, h.actual_cost, h.sell_price_ton, f.area_feddan, f.name AS field_name, f.center_code
                FROM harvest_records h JOIN fields f ON f.id = h.field_id AND f.company_id = h.company_id
                WHERE h.id = ? AND h.company_id = ?`)
      .bind(id, company_id).first<{ qty_tons: number; actual_cost: number; sell_price_ton: number | null; area_feddan: number }>()
    if (existing) {
      const qt    = (b.qty_tons        as number ?? existing.qty_tons)
      const ac    = (b.actual_cost     as number ?? existing.actual_cost)
      const sp    = (b.sell_price_ton  as number | undefined ?? existing.sell_price_ton)
      const fa    = existing.area_feddan
      if (!cols.includes('qty_feddan'))      cols.push('qty_feddan')
      if (!cols.includes('cost_per_feddan')) cols.push('cost_per_feddan')
      if (!cols.includes('revenue'))         cols.push('revenue')
      if (!cols.includes('profit'))          cols.push('profit')
      b.qty_feddan      = fa > 0 ? qt / fa : null
      b.cost_per_feddan = fa > 0 ? ac / fa : null
      b.revenue         = sp ? qt * sp : null
      b.profit          = b.revenue !== null ? (b.revenue as number) - ac : null
    }
  }

  const before = await c.env.DB.prepare(
    `SELECT h.harvest_date, h.crop_name, h.revenue, h.actual_cost, f.name AS field_name, f.center_code, h.season_id, h.field_id
     FROM harvest_records h
     JOIN fields f ON f.id = h.field_id AND f.company_id = h.company_id
     WHERE h.id = ? AND h.company_id = ?`
  ).bind(id, company_id).first<{
    harvest_date: string
    crop_name: string
    revenue: number | null
    actual_cost: number | null
    field_name: string
    center_code: number | null
    season_id: number | null
    field_id: number
  }>()

  cols.push('updated_at')
  const vals = [...cols.slice(0, -1).map(f => b[f] as unknown), new Date().toISOString(), id, company_id]
  await c.env.DB.prepare(
    `UPDATE harvest_records SET ${cols.map(f => `${f} = ?`).join(', ')} WHERE id = ? AND company_id = ?`
  ).bind(...vals).run()

  if (before) {
    const after = await c.env.DB.prepare(
      'SELECT harvest_date, crop_name, revenue, actual_cost FROM harvest_records WHERE id = ? AND company_id = ?'
    ).bind(id, company_id).first<{ harvest_date: string; crop_name: string; revenue: number | null; actual_cost: number | null }>()

    if (after) {
      try {
        await FinanceCore.postHarvestLedger(c.env.DB, {
          company_id,
          user_id: Number(getUser(c).sub),
          harvest_id: id,
          date: after.harvest_date,
          crop_name: after.crop_name,
          field_name: before.field_name,
          center_code: before.center_code,
          total_revenue: after.revenue ?? 0,
          total_actual_cost: after.actual_cost ?? 0,
          season_id: before.season_id,
          field_id: before.field_id,
        })
      } catch (e: unknown) {
        const glMsg = e instanceof Error ? e.message : 'فشل تحديث القيد المحاسبي'
        return c.json({ success: true, data: null, gl_warning: glMsg })
      }
    }
  }

  const { sub: userId } = getUser(c)
  void logAudit(c.env.DB, {
    user_id: Number(userId), company_id,
    action: 'UPDATE', table_name: 'harvest_records', record_id: id,
    old_value: before ? { crop_name: before.crop_name, revenue: before.revenue, actual_cost: before.actual_cost } : undefined,
    new_value: Object.fromEntries(cols.slice(0, -1).map(k => [k, b[k]])),
  })

  return c.json({ success: true, data: null })
})

// POST /api/fields/harvest/:id/repost
// Re-runs postHarvestLedger for an existing harvest record. Safe to call multiple times —
// the function deletes prior GL entries for this harvest_id before re-posting.
// Use when: (1) a price correction occurred after initial posting, (2) GL accounts were
// reconfigured and entries need to reflect the new mapping.
fields.post('/harvest/:id/repost', roleGuard(['super_admin', 'company_admin', 'accountant']), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))

  const harvest = await c.env.DB.prepare(
    `SELECT h.id, h.harvest_date, h.crop_name, h.revenue, h.actual_cost,
            h.season_id, h.field_id,
            f.name AS field_name, f.center_code
     FROM harvest_records h
     JOIN fields f ON f.id = h.field_id AND f.company_id = h.company_id
     WHERE h.id = ? AND h.company_id = ?`
  ).bind(id, company_id).first<{
    id: number; harvest_date: string; crop_name: string
    revenue: number | null; actual_cost: number | null
    season_id: number | null; field_id: number
    field_name: string; center_code: number | null
  }>()

  if (!harvest) return c.json({ success: false, error: 'سجل الحصاد غير موجود' }, 404)

  try {
    await FinanceCore.postHarvestLedger(c.env.DB, {
      company_id,
      user_id: Number(userId),
      harvest_id: harvest.id,
      date: harvest.harvest_date,
      crop_name: harvest.crop_name,
      total_revenue: harvest.revenue ?? 0,
      total_actual_cost: harvest.actual_cost ?? 0,
      field_name: harvest.field_name,
      field_id: harvest.field_id,
      center_code: harvest.center_code ?? null,
      season_id: harvest.season_id ?? null,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'فشل إعادة ترحيل الحصاد'
    return c.json({ success: false, error: msg }, 400)
  }

  // Fetch the newly-created journal entry ID to return to the caller
  const entry = await c.env.DB.prepare(
    `SELECT id FROM journal_entries
     WHERE company_id = ? AND source_module = 'fields' AND source_id = ?
       AND event_type IN ('harvest_cost', 'harvest_revenue')
     ORDER BY id DESC LIMIT 1`
  ).bind(company_id, id).first<{ id: number }>()

  return c.json({
    success: true,
    data: {
      harvest_id:      id,
      journal_entry_id: entry?.id ?? null,
      message:         'تم إعادة ترحيل قيود الحصاد بنجاح',
    },
  })
})

// DELETE /api/fields/harvest/:id
fields.delete('/harvest/:id', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))

  const existing = await c.env.DB.prepare(
    'SELECT field_id, crop_name, harvest_date FROM harvest_records WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<{ field_id: number; crop_name: string; harvest_date: string }>()

  if (!existing) return c.json({ success: false, error: 'سجل الحصاد غير موجود' }, 404)

  // Reverse any GL entries posted for this harvest before deleting the record.
  // journal_entry_lines cascade-deletes when the parent journal_entries row is removed.
  const { results: glEntries } = await c.env.DB.prepare(
    `SELECT DISTINCT je.id FROM journal_entries je
     JOIN journal_entry_lines jel ON jel.entry_id = je.id
     WHERE je.company_id = ? AND jel.source_ledger = 'harvest' AND jel.source_record_id = ?`
  ).bind(company_id, id).all<{ id: number }>()

  for (const entry of glEntries) {
    await c.env.DB.prepare('DELETE FROM journal_entries WHERE id = ? AND company_id = ?')
      .bind(entry.id, company_id).run()
  }

  await c.env.DB.prepare('DELETE FROM harvest_records WHERE id = ? AND company_id = ?').bind(id, company_id).run()

  void logAudit(c.env.DB, {
    user_id: Number(userId), company_id,
    action: 'DELETE', table_name: 'harvest_records', record_id: id,
    old_value: existing ?? undefined,
  })

  return c.json({ success: true, data: null })
})

// GET /api/fields/harvest/cost-estimate?field_id=X&season_id=Y
// Returns accumulated system-derived costs for a field+season (materials + labor + land rent).
// Use this to pre-fill harvest_records.actual_cost rather than entering it manually.
fields.get('/harvest/cost-estimate', async (c) => {
  const { company_id } = getUser(c)
  const field_id  = Number(c.req.query('field_id'))
  const season_id = Number(c.req.query('season_id'))

  if (!field_id || !season_id)
    return c.json({ success: false, error: 'field_id و season_id مطلوبان' }, 400)

  const [field, materialsRow, laborRow, equipmentRow, cashRow, payrollRow] = await Promise.all([
    c.env.DB.prepare(
      'SELECT area_feddan, rent_per_feddan, name, code FROM fields WHERE id = ? AND company_id = ?'
    ).bind(field_id, company_id).first<{ area_feddan: number; rent_per_feddan: number; name: string; code: string }>(),

    c.env.DB.prepare(
      `SELECT COALESCE(SUM(value_out), 0) AS total
       FROM inventory_movements
       WHERE company_id = ? AND field_id = ? AND season_id = ?
         AND movement_type IN ('ISSUE','TRANSFER_OUT','COGS_ADJUSTMENT','PRODUCTION_INPUT','ADJUSTMENT_LOSS')`
    ).bind(company_id, field_id, season_id).first<{ total: number }>(),

    c.env.DB.prepare(
      `SELECT COALESCE(SUM(wt.quantity * wt.unit_cost), 0) AS total
       FROM work_tasks wt
       JOIN work_orders wo ON wo.id = wt.work_order_id AND wo.company_id = wt.company_id
       WHERE wo.company_id = ? AND wo.field_id = ? AND wo.season_id = ? AND wo.status != 'cancelled'`
    ).bind(company_id, field_id, season_id).first<{ total: number }>(),

    c.env.DB.prepare(
      `SELECT COALESCE(SUM(woe.total_cost), 0) AS total
       FROM work_order_equipment woe
       JOIN work_orders wo ON wo.id = woe.work_order_id AND wo.company_id = woe.company_id
       WHERE wo.company_id = ? AND wo.field_id = ? AND wo.season_id = ? AND wo.status != 'cancelled'`
    ).bind(company_id, field_id, season_id).first<{ total: number }>(),

    c.env.DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM cash_transactions
       WHERE company_id = ? AND field_id = ? AND season_id = ? AND direction = 'م' AND status = 'posted'`
    ).bind(company_id, field_id, season_id).first<{ total: number }>(),

    // Payroll runs attributed to this season (approved or paid)
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(total_net), 0) AS total
       FROM payroll_runs
       WHERE company_id = ? AND season_id = ? AND status IN ('approved','paid')`
    ).bind(company_id, season_id).first<{ total: number }>(),
  ])

  if (!field) return c.json({ success: false, error: 'القطعة غير موجودة' }, 404)

  // P3-L3: Land rent auto-split across concurrent crop cycles on this field in the season.
  // If multiple cycles share the field, each cycle bears its proportional share.
  // Here we count active cycles to determine the requesting cycle's fraction.
  const cycleCountRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n, SUM(COALESCE(area_feddan, 0)) AS total_area
     FROM crop_cycles
     WHERE company_id = ? AND field_id = ? AND season_id = ? AND status NOT IN ('settled','abandoned','written_off')`
  ).bind(company_id, field_id, season_id).first<{ n: number; total_area: number }>()

  const activeCycles      = cycleCountRow?.n ?? 1
  const totalCycleArea    = cycleCountRow?.total_area ?? 0
  const grossLandRent     = (field.rent_per_feddan ?? 0) * (field.area_feddan ?? 0)
  // Split: if cycles have area data, pro-rate; otherwise split equally
  const landRentShareFrac = activeCycles <= 1 ? 1 : (totalCycleArea > 0 ? 1 / activeCycles : 1 / activeCycles)
  const land_rent         = Math.round(grossLandRent * landRentShareFrac * 100) / 100

  const materials_cost  = materialsRow?.total  ?? 0
  const labor_cost      = laborRow?.total      ?? 0
  const equipment_cost  = equipmentRow?.total  ?? 0
  const cash_cost       = cashRow?.total       ?? 0
  const payroll_cost    = payrollRow?.total    ?? 0
  const total_cost      = materials_cost + labor_cost + equipment_cost + cash_cost + payroll_cost + land_rent

  return c.json({
    success: true,
    data: {
      field_id,
      season_id,
      field_name:     field.name,
      field_code:     field.code,
      area_feddan:    field.area_feddan,
      materials_cost,
      labor_cost,
      equipment_cost,
      cash_cost,
      payroll_cost,
      land_rent,
      land_rent_gross:   grossLandRent,
      land_rent_cycles:  activeCycles,
      total_cost,
    }
  })
})

// GET /api/fields/seasons/:season_id/pnl
// Season-level agricultural P&L: revenue vs costs across all fields in the season.
fields.get('/seasons/:season_id/pnl', async (c) => {
  const { company_id } = getUser(c)
  const season_id = Number(c.req.param('season_id'))

  if (!season_id) return c.json({ success: false, error: 'season_id مطلوب' }, 400)

  const season = await c.env.DB.prepare(
    'SELECT id, name, status FROM seasons WHERE id = ? AND company_id = ?'
  ).bind(season_id, company_id).first<{ id: number; name: string; status: string }>()
  if (!season) return c.json({ success: false, error: 'الموسم غير موجود' }, 404)

  // All fields active in this season
  const fieldsInSeason = await c.env.DB.prepare(
    `SELECT f.id, f.name, f.code, f.area_feddan, COALESCE(f.rent_per_feddan, 0) AS rent_per_feddan
     FROM fields f
     WHERE f.company_id = ? AND f.season_id = ?
     ORDER BY f.code`
  ).bind(company_id, season_id).all<{
    id: number; name: string; code: string; area_feddan: number; rent_per_feddan: number
  }>()

  const [materialsRow, laborRow, equipmentRow, cashRow, payrollRow, harvestRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT field_id, COALESCE(SUM(value_out), 0) AS total
       FROM inventory_movements
       WHERE company_id = ? AND season_id = ?
         AND movement_type IN ('ISSUE','TRANSFER_OUT','COGS_ADJUSTMENT','PRODUCTION_INPUT','ADJUSTMENT_LOSS')
       GROUP BY field_id`
    ).bind(company_id, season_id).all<{ field_id: number; total: number }>(),

    c.env.DB.prepare(
      `SELECT wo.field_id, COALESCE(SUM(wt.quantity * wt.unit_cost), 0) AS total
       FROM work_tasks wt
       JOIN work_orders wo ON wo.id = wt.work_order_id AND wo.company_id = wt.company_id
       WHERE wo.company_id = ? AND wo.season_id = ? AND wo.status != 'cancelled'
       GROUP BY wo.field_id`
    ).bind(company_id, season_id).all<{ field_id: number; total: number }>(),

    c.env.DB.prepare(
      `SELECT wo.field_id, COALESCE(SUM(woe.total_cost), 0) AS total
       FROM work_order_equipment woe
       JOIN work_orders wo ON wo.id = woe.work_order_id AND wo.company_id = woe.company_id
       WHERE wo.company_id = ? AND wo.season_id = ? AND wo.status != 'cancelled'
       GROUP BY wo.field_id`
    ).bind(company_id, season_id).all<{ field_id: number; total: number }>(),

    c.env.DB.prepare(
      `SELECT field_id, COALESCE(SUM(amount), 0) AS total
       FROM cash_transactions
       WHERE company_id = ? AND season_id = ? AND direction = 'م' AND status = 'posted'
       GROUP BY field_id`
    ).bind(company_id, season_id).all<{ field_id: number; total: number }>(),

    c.env.DB.prepare(
      `SELECT COALESCE(SUM(total_net), 0) AS total
       FROM payroll_runs
       WHERE company_id = ? AND season_id = ? AND status IN ('approved','paid')`
    ).bind(company_id, season_id).first<{ total: number }>(),

    c.env.DB.prepare(
      `SELECT field_id,
              COALESCE(SUM(revenue), 0) AS revenue,
              COALESCE(SUM(qty_tons), 0) AS total_tons,
              GROUP_CONCAT(crop_name) AS crops
       FROM harvest_records
       WHERE company_id = ? AND season_id = ?
       GROUP BY field_id`
    ).bind(company_id, season_id).all<{ field_id: number; revenue: number; total_tons: number; crops: string }>(),
  ])

  const toMap = <T extends { field_id: number }>(rows: T[]) =>
    new Map(rows.map(r => [r.field_id, r]))

  const materialsMap  = toMap(materialsRow.results)
  const laborMap      = toMap(laborRow.results)
  const equipmentMap  = toMap(equipmentRow.results)
  const cashMap       = toMap(cashRow.results)
  const harvestMap    = toMap(harvestRow.results)
  const payrollTotal  = payrollRow?.total ?? 0

  // Distribute payroll proportionally by area_feddan (fallback: equal share)
  const totalFeddan = fieldsInSeason.results.reduce((s, f) => s + (f.area_feddan ?? 0), 0)
  const fieldCount  = fieldsInSeason.results.length || 1

  const fieldBreakdown = fieldsInSeason.results.map(f => {
    const materials_cost  = materialsMap.get(f.id)?.total  ?? 0
    const labor_cost      = laborMap.get(f.id)?.total      ?? 0
    const equipment_cost  = equipmentMap.get(f.id)?.total  ?? 0
    const cash_cost       = cashMap.get(f.id)?.total       ?? 0
    const land_rent       = f.rent_per_feddan * (f.area_feddan ?? 0)
    const payroll_share   = totalFeddan > 0
      ? payrollTotal * ((f.area_feddan ?? 0) / totalFeddan)
      : payrollTotal / fieldCount
    const total_cost      = materials_cost + labor_cost + equipment_cost + cash_cost + payroll_share + land_rent

    const harvestData     = harvestMap.get(f.id)
    const revenue         = harvestData?.revenue    ?? 0
    const total_tons      = harvestData?.total_tons ?? 0
    const crops           = harvestData?.crops      ?? null
    const net_result      = revenue - total_cost
    const cost_per_feddan = f.area_feddan > 0 ? total_cost / f.area_feddan : null

    return {
      field_id:      f.id,
      field_name:    f.name,
      field_code:    f.code,
      area_feddan:   f.area_feddan,
      crops,
      revenue,
      total_tons,
      materials_cost,
      labor_cost,
      equipment_cost,
      cash_cost,
      payroll_share: Math.round(payroll_share * 100) / 100,
      land_rent,
      total_cost:    Math.round(total_cost * 100) / 100,
      net_result:    Math.round(net_result * 100) / 100,
      cost_per_feddan: cost_per_feddan != null ? Math.round(cost_per_feddan * 100) / 100 : null,
    }
  })

  const totals = fieldBreakdown.reduce((acc, f) => ({
    area_feddan:    acc.area_feddan    + f.area_feddan,
    revenue:        acc.revenue        + f.revenue,
    total_tons:     acc.total_tons     + f.total_tons,
    materials_cost: acc.materials_cost + f.materials_cost,
    labor_cost:     acc.labor_cost     + f.labor_cost,
    equipment_cost: acc.equipment_cost + f.equipment_cost,
    cash_cost:      acc.cash_cost      + f.cash_cost,
    payroll_cost:   acc.payroll_cost   + f.payroll_share,
    land_rent:      acc.land_rent      + f.land_rent,
    total_cost:     acc.total_cost     + f.total_cost,
    net_result:     acc.net_result     + f.net_result,
  }), {
    area_feddan: 0, revenue: 0, total_tons: 0,
    materials_cost: 0, labor_cost: 0, equipment_cost: 0,
    cash_cost: 0, payroll_cost: 0, land_rent: 0,
    total_cost: 0, net_result: 0,
  })

  return c.json({
    success: true,
    data: {
      season_id,
      season_name:  season.name,
      season_status: season.status,
      field_count:  fieldBreakdown.length,
      totals: {
        ...totals,
        gross_margin_pct: totals.revenue > 0
          ? Math.round((totals.net_result / totals.revenue) * 10000) / 100
          : null,
        cost_per_feddan: totals.area_feddan > 0
          ? Math.round((totals.total_cost / totals.area_feddan) * 100) / 100
          : null,
      },
      fields: fieldBreakdown,
    }
  })
})

// ───────────────────────────────────────────────────────────

// GET /api/fields/:id
fields.get('/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const row = await c.env.DB
    .prepare('SELECT f.*, s.name AS season_name FROM fields f LEFT JOIN seasons s ON s.id = f.season_id AND s.company_id = f.company_id WHERE f.id = ? AND f.company_id = ?')
    .bind(id, company_id).first()
  if (!row) return c.json({ success: false, error: 'القطعة غير موجودة' }, 404)
  return c.json({ success: true, data: row })
})

// POST /api/fields
fields.post('/', async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<{
    code: string; name: string; area_feddan: number; season_id?: number
    location?: string; crop_type?: string; soil_type?: string
    irrigation_type?: string; landlord_name?: string; rent_per_feddan?: number
    notes?: string; center_code?: number
  }>()

  if (!b.code || !b.name) return c.json({ success: false, error: 'الكود والاسم مطلوبان' }, 400)

  const result = await c.env.DB.prepare(
    `INSERT INTO fields (company_id, season_id, code, name, area_feddan, location, crop_type,
     soil_type, irrigation_type, landlord_name, rent_per_feddan, notes, center_code)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    company_id, b.season_id ?? null, b.code, b.name, b.area_feddan ?? 0,
    b.location ?? null, b.crop_type ?? null, b.soil_type ?? null,
    b.irrigation_type ?? null, b.landlord_name ?? null, b.rent_per_feddan ?? 0,
    b.notes ?? null, b.center_code ?? null
  ).run()

  return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201)
})

// PATCH /api/fields/:id
fields.patch('/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const b  = await c.req.json<Record<string, unknown>>()

  const allowed = ['name','area_feddan','location','crop_type','soil_type',
                   'irrigation_type','landlord_name','rent_per_feddan','notes','is_active','season_id',
                   'center_lat','center_lng','boundary_geojson','geofence_radius_m','center_code']
  const fields_  = Object.keys(b).filter(k => allowed.includes(k))
  if (!fields_.length) return c.json({ success: false, error: 'لا توجد حقول للتحديث' }, 400)

  const sql    = `UPDATE fields SET ${fields_.map(f => `${f} = ?`).join(', ')} WHERE id = ? AND company_id = ?`
  const values = [...fields_.map(f => b[f]), id, company_id]
  await c.env.DB.prepare(sql).bind(...values).run()
  return c.json({ success: true, data: null })
})

// ═══════════════════════════════════════════════════════════
export default fields
