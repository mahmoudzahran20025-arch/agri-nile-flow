import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser } from '../../middleware/auth'
import { logAudit } from '../../lib/audit'

const branches = new Hono<{ Bindings: Env }>()

branches.get('/branches', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare(`SELECT b.*, e.name AS manager_name
              FROM branches b
              LEFT JOIN employees e ON e.id = b.manager_id AND e.company_id = b.company_id
              WHERE b.company_id = ? ORDER BY b.code`)
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

branches.post('/branches', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    code: string; name: string; address?: string; city?: string
    phone?: string; manager_id?: number; lat?: number; lng?: number
    geofence_radius_m?: number
  }>()
  if (!b.code || !b.name) return c.json({ success: false, error: 'الكود والاسم مطلوبان' }, 400)
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO branches (company_id, code, name, address, city, phone, manager_id, lat, lng, geofence_radius_m)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(company_id, b.code, b.name, b.address ?? null, b.city ?? null,
           b.phone ?? null, b.manager_id ?? null, b.lat ?? null, b.lng ?? null,
           b.geofence_radius_m ?? 200).run()
    void logAudit(c.env.DB, { user_id: userId, company_id, action: 'CREATE', table_name: 'branches', record_id: r.meta.last_row_id })
    return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
  } catch {
    return c.json({ success: false, error: 'الكود موجود مسبقاً' }, 409)
  }
})

branches.patch('/branches/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const b  = await c.req.json<Record<string, unknown>>()
  const allowed = ['code','name','address','city','phone','manager_id','lat','lng','geofence_radius_m','is_active']
  const cols = Object.keys(b).filter(k => allowed.includes(k))
  if (!cols.length) return c.json({ success: false, error: 'لا توجد حقول' }, 400)
  await c.env.DB.prepare(
    `UPDATE branches SET ${cols.map(f => `${f} = ?`).join(', ')} WHERE id = ? AND company_id = ?`
  ).bind(...cols.map(f => b[f]), id, company_id).run()
  return c.json({ success: true, data: null })
})

export default branches
