import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser, signJwt } from '../middleware/auth'

const admin = new Hono<{ Bindings: Env }>()
admin.use('*', authMiddleware)

// All routes require super_admin
admin.use('*', async (c, next) => {
  const { role } = getUser(c)
  if (role !== 'super_admin') {
    return c.json({ success: false, error: 'يتطلب صلاحية مدير النظام' }, 403)
  }
  return next()
})

// GET /api/admin/companies — list all companies with stats
admin.get('/companies', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT
      co.id, co.code, co.name, co.is_active,
      COUNT(DISTINCT uc.user_id) AS user_count,
      (SELECT COUNT(*) FROM suppliers s WHERE s.company_id = co.id) AS supplier_count,
      (SELECT COUNT(*) FROM cash_transactions ct WHERE ct.company_id = co.id) AS txn_count,
      (SELECT running_balance FROM cash_transactions ct2
       WHERE ct2.company_id = co.id ORDER BY ct2.id DESC LIMIT 1) AS cash_balance
    FROM companies co
    LEFT JOIN user_companies uc ON uc.company_id = co.id AND uc.is_active = 1
    GROUP BY co.id
    ORDER BY co.code
  `).all()
  return c.json({ success: true, data: results })
})

// POST /api/admin/companies — create new company
admin.post('/companies', async (c) => {
  const b = await c.req.json<{ code: string; name: string; address?: string; phone?: string }>()
  if (!b.code || !b.name) {
    return c.json({ success: false, error: 'الكود والاسم مطلوبان' }, 400)
  }

  const existing = await c.env.DB
    .prepare('SELECT id FROM companies WHERE code = ?')
    .bind(b.code.trim().toUpperCase()).first()
  if (existing) return c.json({ success: false, error: 'هذا الكود مستخدم بالفعل' }, 409)

  const result = await c.env.DB
    .prepare('INSERT INTO companies (code, name, address, phone, is_active) VALUES (?,?,?,?,1)')
    .bind(b.code.trim().toUpperCase(), b.name.trim(), b.address ?? null, b.phone ?? null)
    .run()

  const companyId = result.meta.last_row_id as number

  // Seed default GL accounts + financial period for new company
  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO chart_of_accounts (company_id, code, name, account_type, normal_balance, level, is_header, is_active)
    SELECT ${companyId}, code, name, account_type, normal_balance, level, is_header, 1
    FROM chart_of_accounts
    WHERE company_id = 1 AND is_active = 1
  `).run().catch(() => {/* ignore if no template */})

  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO gl_account_mappings (company_id, mapping_key, account_code)
    SELECT ${companyId}, mapping_key, account_code
    FROM gl_account_mappings WHERE company_id = 1
  `).run().catch(() => {})

  const year = new Date().getFullYear()
  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO financial_periods (company_id, name, start_date, end_date, is_closed)
    VALUES (?, ?, ?, ?, 0)
  `).bind(companyId, `السنة المالية ${year}`, `${year}-01-01`, `${year}-12-31`).run().catch(() => {})

  return c.json({ success: true, data: { id: companyId } }, 201)
})

// PATCH /api/admin/companies/:id — update company info or toggle active
admin.patch('/companies/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const b  = await c.req.json<{ name?: string; address?: string; phone?: string; is_active?: number }>()

  const sets: string[] = []
  const vals: unknown[] = []
  if (b.name      !== undefined) { sets.push('name = ?');      vals.push(b.name.trim()) }
  if (b.address   !== undefined) { sets.push('address = ?');   vals.push(b.address) }
  if (b.phone     !== undefined) { sets.push('phone = ?');     vals.push(b.phone) }
  if (b.is_active !== undefined) { sets.push('is_active = ?'); vals.push(b.is_active) }

  if (!sets.length) return c.json({ success: false, error: 'لا توجد بيانات للتحديث' }, 400)
  vals.push(id)

  await c.env.DB.prepare(`UPDATE companies SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
  return c.json({ success: true, data: null })
})

// POST /api/admin/switch/:company_id — issue a scoped token for target company
admin.post('/switch/:company_id', async (c) => {
  const { sub: userId } = getUser(c)
  const targetId = Number(c.req.param('company_id'))

  const company = await c.env.DB
    .prepare('SELECT id, code, name FROM companies WHERE id = ? AND is_active = 1')
    .bind(targetId).first<{ id: number; code: string; name: string }>()
  if (!company) return c.json({ success: false, error: 'الشركة غير موجودة' }, 404)

  const user = await c.env.DB
    .prepare('SELECT id, email, full_name FROM users WHERE id = ?')
    .bind(userId).first<{ id: number; email: string; full_name: string }>()
  if (!user) return c.json({ success: false, error: 'المستخدم غير موجود' }, 404)

  const token = await signJwt(
    { sub: user.id, company_id: targetId, role: 'company_admin' },
    c.env.JWT_SECRET,
  )

  return c.json({
    success: true,
    data: {
      token,
      user: { id: user.id, full_name: user.full_name, email: user.email, company_id: targetId, role: 'company_admin' },
      company,
    },
  })
})

// GET /api/admin/companies/:id/users — users in a specific company
admin.get('/companies/:id/users', async (c) => {
  const id = Number(c.req.param('id'))
  const { results } = await c.env.DB.prepare(`
    SELECT u.id, u.email, u.full_name, u.is_active, u.last_login,
           r.name AS role
    FROM users u
    JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ?
    JOIN roles r ON r.id = uc.role_id
    WHERE uc.is_active = 1
    ORDER BY u.full_name
  `).bind(id).all()
  return c.json({ success: true, data: results })
})

// GET /api/admin/overview — per-company health metrics (E-4)
admin.get('/overview', async (c) => {
  const { results: companies } = await c.env.DB.prepare(
    'SELECT id, code, name, is_active FROM companies ORDER BY code'
  ).all<{ id: number; code: string; name: string; is_active: number }>()

  const rows = await Promise.all(companies.map(async co => {
    const cid = co.id
    const [cashRow, seasonRow, woRow, poRow, empRow, invRow, lastTxRow] = await Promise.all([
      c.env.DB.prepare(
        `SELECT running_balance FROM cash_transactions WHERE company_id = ? ORDER BY id DESC LIMIT 1`
      ).bind(cid).first<{ running_balance: number }>(),
      c.env.DB.prepare(
        `SELECT name, status FROM seasons WHERE company_id = ? AND status IN ('active','harvesting') ORDER BY start_date DESC LIMIT 1`
      ).bind(cid).first<{ name: string; status: string }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM work_orders WHERE company_id = ? AND status IN ('pending','in_progress')`
      ).bind(cid).first<{ n: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(total_amount),0) AS value FROM purchase_orders WHERE company_id = ? AND status IN ('draft','sent','partial')`
      ).bind(cid).first<{ n: number; value: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM employees WHERE company_id = ? AND is_active = 1`
      ).bind(cid).first<{ n: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(DISTINCT im.item_code) AS n
         FROM inventory_movements im
         JOIN items i ON i.code = im.item_code AND i.company_id = im.company_id
         WHERE im.company_id = ? AND im.balance_qty IS NOT NULL
           AND im.balance_qty <= i.reorder_point AND i.reorder_point > 0
           AND im.id = (SELECT MAX(id) FROM inventory_movements WHERE item_code = im.item_code AND company_id = im.company_id)`
      ).bind(cid).first<{ n: number }>(),
      c.env.DB.prepare(
        `SELECT MAX(created_at) AS last_at FROM cash_transactions WHERE company_id = ?`
      ).bind(cid).first<{ last_at: string | null }>(),
    ])

    const health = Math.max(0, 100
      - (woRow?.n ?? 0) * 2
      - (poRow?.n ?? 0) * 3
      - (invRow?.n ?? 0) * 3
    )

    return {
      ...co,
      cash_balance:    cashRow?.running_balance  ?? null,
      active_season:   seasonRow?.name           ?? null,
      season_status:   seasonRow?.status         ?? null,
      open_wo:         woRow?.n   ?? 0,
      open_po_count:   poRow?.n   ?? 0,
      open_po_value:   poRow?.value ?? 0,
      employee_count:  empRow?.n  ?? 0,
      low_stock_count: invRow?.n  ?? 0,
      last_activity:   lastTxRow?.last_at ?? null,
      health_score:    health,
    }
  }))

  return c.json({ success: true, data: rows })
})

export default admin
