import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser, roleGuard } from '../middleware/auth'

const costCategories = new Hono<{ Bindings: Env }>()
costCategories.use('*', authMiddleware)
costCategories.use('*', roleGuard(['super_admin', 'company_admin', 'field_supervisor', 'accountant']))

// ── GET /api/cost-categories ─────────────────────────────────────────────────
// Returns all active cost categories for the company, ordered by sort_order.
// System categories (is_system=1) are always included; user categories are children.
costCategories.get('/', async (c) => {
  const { company_id } = getUser(c)
  const include_inactive = c.req.query('include_inactive') === '1'

  let sql = `
    SELECT
      cc.id, cc.company_id, cc.code, cc.name_ar, cc.name_en,
      cc.parent_id, cc.system_type, cc.is_system, cc.is_active,
      cc.sort_order, cc.created_at,
      p.code AS parent_code, p.name_ar AS parent_name_ar
    FROM cost_categories cc
    LEFT JOIN cost_categories p ON p.id = cc.parent_id AND p.company_id = cc.company_id
    WHERE cc.company_id = ?`

  const params: unknown[] = [company_id]

  if (!include_inactive) {
    sql += ' AND cc.is_active = 1'
  }

  sql += ' ORDER BY cc.sort_order ASC, cc.id ASC'

  const rows = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ success: true, data: rows.results })
})

// ── GET /api/cost-categories/:code ──────────────────────────────────────────
costCategories.get('/:code', async (c) => {
  const { company_id } = getUser(c)
  const code = c.req.param('code')

  const row = await c.env.DB.prepare(`
    SELECT cc.*, p.code AS parent_code, p.name_ar AS parent_name_ar
    FROM cost_categories cc
    LEFT JOIN cost_categories p ON p.id = cc.parent_id AND p.company_id = cc.company_id
    WHERE cc.company_id = ? AND cc.code = ?
  `).bind(company_id, code).first()

  if (!row) return c.json({ success: false, error: 'فئة التكلفة غير موجودة' }, 404)
  return c.json({ success: true, data: row })
})

// ── POST /api/cost-categories ────────────────────────────────────────────────
// Create user-defined sub-category under an existing system category.
costCategories.post('/', async (c) => {
  const { company_id } = getUser(c)
  const body = await c.req.json<{
    code: string; name_ar: string; name_en?: string
    parent_id: number; sort_order?: number
  }>()

  if (!body.code || !body.name_ar || !body.parent_id) {
    return c.json({ success: false, error: 'code و name_ar و parent_id مطلوبة' }, 400)
  }

  // Parent must be a system category belonging to this company
  const parent = await c.env.DB.prepare(
    'SELECT id, system_type FROM cost_categories WHERE id = ? AND company_id = ? AND is_system = 1'
  ).bind(body.parent_id, company_id).first<{ id: number; system_type: string }>()

  if (!parent) {
    return c.json({ success: false, error: 'الفئة الأصلية غير موجودة أو ليست فئة نظام' }, 400)
  }

  const { meta } = await c.env.DB.prepare(`
    INSERT INTO cost_categories (company_id, code, name_ar, name_en, parent_id, system_type, is_system, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).bind(
    company_id,
    body.code,
    body.name_ar,
    body.name_en ?? null,
    body.parent_id,
    parent.system_type,
    body.sort_order ?? 100,
  ).run()

  return c.json({ success: true, data: { id: meta.last_row_id } }, 201)
})

// ── PATCH /api/cost-categories/:code ────────────────────────────────────────
// Update user-defined category (system categories are immutable).
costCategories.patch('/:code', async (c) => {
  const { company_id } = getUser(c)
  const code = c.req.param('code')
  const body = await c.req.json<{ name_ar?: string; name_en?: string; is_active?: boolean; sort_order?: number }>()

  const existing = await c.env.DB.prepare(
    'SELECT id, is_system FROM cost_categories WHERE company_id = ? AND code = ?'
  ).bind(company_id, code).first<{ id: number; is_system: number }>()

  if (!existing) return c.json({ success: false, error: 'فئة التكلفة غير موجودة' }, 404)
  if (existing.is_system) return c.json({ success: false, error: 'لا يمكن تعديل فئات النظام' }, 403)

  const fields: string[] = []
  const values: unknown[] = []

  if (body.name_ar !== undefined)   { fields.push('name_ar = ?');   values.push(body.name_ar) }
  if (body.name_en !== undefined)   { fields.push('name_en = ?');   values.push(body.name_en) }
  if (body.is_active !== undefined) { fields.push('is_active = ?'); values.push(body.is_active ? 1 : 0) }
  if (body.sort_order !== undefined){ fields.push('sort_order = ?');values.push(body.sort_order) }

  if (!fields.length) return c.json({ success: false, error: 'لا توجد حقول للتحديث' }, 400)

  values.push(company_id, code)
  await c.env.DB.prepare(
    `UPDATE cost_categories SET ${fields.join(', ')} WHERE company_id = ? AND code = ?`
  ).bind(...values).run()

  return c.json({ success: true })
})

export default costCategories
