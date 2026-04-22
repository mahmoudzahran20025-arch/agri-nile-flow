import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'

const fields = new Hono<{ Bindings: Env }>()
fields.use('*', authMiddleware)

// GET /api/fields
fields.get('/', async (c) => {
  const { company_id } = getUser(c)
  const season_id = c.req.query('season_id')
  const q         = c.req.query('q')

  let sql = 'SELECT f.*, s.name AS season_name FROM fields f LEFT JOIN seasons s ON s.id = f.season_id WHERE f.company_id = ?'
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
    JOIN fields f ON f.id = h.field_id
    LEFT JOIN seasons s ON s.id = h.season_id
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
      f.id AS field_id, f.name AS field_name, f.code AS field_code, f.area_feddan,
      COUNT(h.id)           AS harvest_count,
      SUM(h.qty_tons)       AS total_tons,
      AVG(h.qty_feddan)     AS avg_yield_per_feddan,
      SUM(h.actual_cost)    AS total_cost,
      SUM(h.revenue)        AS total_revenue,
      SUM(h.profit)         AS total_profit,
      AVG(h.cost_per_feddan) AS avg_cost_per_feddan
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
    .prepare('SELECT area_feddan FROM fields WHERE id = ? AND company_id = ?')
    .bind(b.field_id, company_id).first<{ area_feddan: number }>()
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

  return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
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
      .prepare(`SELECT h.qty_tons, h.actual_cost, h.sell_price_ton, f.area_feddan
                FROM harvest_records h JOIN fields f ON f.id = h.field_id
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

  cols.push('updated_at')
  const vals = [...cols.slice(0, -1).map(f => b[f] as unknown), new Date().toISOString(), id, company_id]
  await c.env.DB.prepare(
    `UPDATE harvest_records SET ${cols.map(f => `${f} = ?`).join(', ')} WHERE id = ? AND company_id = ?`
  ).bind(...vals).run()
  return c.json({ success: true, data: null })
})

// DELETE /api/fields/harvest/:id
fields.delete('/harvest/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM harvest_records WHERE id = ? AND company_id = ?').bind(id, company_id).run()
  return c.json({ success: true, data: null })
})

// ───────────────────────────────────────────────────────────

// GET /api/fields/:id
fields.get('/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const row = await c.env.DB
    .prepare('SELECT f.*, s.name AS season_name FROM fields f LEFT JOIN seasons s ON s.id = f.season_id WHERE f.id = ? AND f.company_id = ?')
    .bind(id, company_id).first()
  if (!row) return c.json({ success: false, error: 'القطعة غير موجودة' }, 404)
  return c.json({ success: true, data: row })
})

// POST /api/fields
fields.post('/', async (c) => {
  const { company_id, sub: userId } = getUser(c)
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
