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
    irrigation_type?: string; landlord_name?: string; rent_per_feddan?: number; notes?: string
  }>()

  if (!b.code || !b.name) return c.json({ success: false, error: 'الكود والاسم مطلوبان' }, 400)

  const result = await c.env.DB.prepare(
    `INSERT INTO fields (company_id, season_id, code, name, area_feddan, location, crop_type,
     soil_type, irrigation_type, landlord_name, rent_per_feddan, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    company_id, b.season_id ?? null, b.code, b.name, b.area_feddan ?? 0,
    b.location ?? null, b.crop_type ?? null, b.soil_type ?? null,
    b.irrigation_type ?? null, b.landlord_name ?? null, b.rent_per_feddan ?? 0, b.notes ?? null
  ).run()

  return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201)
})

// PATCH /api/fields/:id
fields.patch('/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const b  = await c.req.json<Record<string, unknown>>()

  const allowed = ['name','area_feddan','location','crop_type','soil_type',
                   'irrigation_type','landlord_name','rent_per_feddan','notes','is_active','season_id']
  const fields_  = Object.keys(b).filter(k => allowed.includes(k))
  if (!fields_.length) return c.json({ success: false, error: 'لا توجد حقول للتحديث' }, 400)

  const sql    = `UPDATE fields SET ${fields_.map(f => `${f} = ?`).join(', ')} WHERE id = ? AND company_id = ?`
  const values = [...fields_.map(f => b[f]), id, company_id]
  await c.env.DB.prepare(sql).bind(...values).run()
  return c.json({ success: true, data: null })
})

export default fields
