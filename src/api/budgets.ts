import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'
import { logAudit } from '../lib/audit'

const budgets = new Hono<{ Bindings: Env }>()
budgets.use('*', authMiddleware)

// GET /api/budgets?season_id=
budgets.get('/', async (c) => {
  const { company_id } = getUser(c)
  const season_id = c.req.query('season_id')

  let sql = `
    SELECT fsb.*, f.name AS field_name, f.code AS field_code,
           f.area_feddan, f.crop_type, s.name AS season_name
    FROM field_season_budgets fsb
    LEFT JOIN fields  f ON f.id  = fsb.field_id  AND f.company_id  = fsb.company_id
    LEFT JOIN seasons s ON s.id  = fsb.season_id
    WHERE fsb.company_id = ?`
  const params: unknown[] = [company_id]

  if (season_id) { sql += ' AND fsb.season_id = ?'; params.push(Number(season_id)) }
  sql += ' ORDER BY f.code'

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ success: true, data: results })
})

// POST /api/budgets  — upsert by (company_id, field_id, season_id)
budgets.post('/', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    field_id: number; season_id: number
    budget_per_feddan: number; notes?: string
  }>()

  if (!b.field_id || !b.season_id || b.budget_per_feddan == null || b.budget_per_feddan < 0) {
    return c.json({ success: false, error: 'الحقل والموسم والميزانية مطلوبة' }, 400)
  }

  const result = await c.env.DB.prepare(`
    INSERT INTO field_season_budgets
      (company_id, field_id, season_id, budget_per_feddan, notes, created_by, updated_at)
    VALUES (?,?,?,?,?,?, datetime('now'))
    ON CONFLICT(company_id, field_id, season_id) DO UPDATE SET
      budget_per_feddan = excluded.budget_per_feddan,
      notes             = excluded.notes,
      updated_at        = datetime('now')
  `).bind(company_id, b.field_id, b.season_id, b.budget_per_feddan, b.notes ?? null, userId).run()

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'UPSERT',
    table_name: 'field_season_budgets', record_id: result.meta.last_row_id,
    new_value: { field_id: b.field_id, season_id: b.season_id, budget_per_feddan: b.budget_per_feddan },
  })

  return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201)
})

// DELETE /api/budgets/:id
budgets.delete('/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare(
    'DELETE FROM field_season_budgets WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).run()
  return c.json({ success: true, data: null })
})

export default budgets
