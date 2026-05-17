/**
 * src/api/gl/account-role-policy.ts
 *
 * Phase 3: Account Role Policy Engine
 *
 * Endpoints:
 *   GET  /api/gl/account-role-policy              — list all mappings for company
 *   POST /api/gl/account-role-policy              — create/update mapping (company_admin+)
 *   GET  /api/gl/account-role-policy/resolve/:role — resolve role → account_code
 *   GET  /api/gl/account-role-policy/coverage     — show unmapped roles
 *   DELETE /api/gl/account-role-policy/:id        — deactivate mapping
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'
import { logAudit } from '../../lib/audit'

const accountRolePolicy = new Hono<{ Bindings: Env }>()

accountRolePolicy.use('*', authMiddleware)
accountRolePolicy.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

// ── GET /api/gl/account-role-policy ──────────────────────────────────────────
// List all role-to-account mappings for this company
accountRolePolicy.get('/', async (c) => {
  const { company_id } = getUser(c)
  const active = c.req.query('active') ?? '1'

  let query = `
    SELECT
      m.id, m.role_code, m.account_code, m.priority, m.notes, m.is_active,
      r.name as role_name, r.category as role_category,
      a.name as account_name, a.account_type
    FROM account_role_mappings m
    LEFT JOIN md_account_roles r ON r.code = m.role_code
    LEFT JOIN chart_of_accounts a ON a.code = m.account_code AND a.company_id = m.company_id
    WHERE m.company_id = ?
  `
  const params: (string | number)[] = [company_id]

  if (active === '1') {
    query += ' AND m.is_active = 1'
  }

  query += ' ORDER BY r.category ASC, m.role_code ASC, m.priority ASC'

  const { results } = await c.env.DB.prepare(query).bind(...params).all()

  return c.json({
    success: true,
    data: results,
    meta: { count: results.length },
  })
})

// ── GET /api/gl/account-role-policy/coverage ─────────────────────────────────
// Shows which roles have NO mapping (coverage gaps) — must be before /:id
accountRolePolicy.get('/coverage', async (c) => {
  const { company_id } = getUser(c)

  // All known roles
  const { results: allRoles } = await c.env.DB
    .prepare('SELECT code, name, category FROM md_account_roles WHERE is_active = 1 ORDER BY category, code')
    .all()

  // Mapped roles
  const { results: mapped } = await c.env.DB
    .prepare('SELECT DISTINCT role_code FROM account_role_mappings WHERE company_id = ? AND is_active = 1')
    .bind(company_id)
    .all()

  const mappedCodes = new Set(mapped.map((r: Record<string, unknown>) => r.role_code as string))

  const coverage = (allRoles as Array<{ code: string; name: string; category: string }>).map(role => ({
    role_code:  role.code,
    role_name:  role.name,
    category:   role.category,
    is_mapped:  mappedCodes.has(role.code),
  }))

  const unmapped = coverage.filter(r => !r.is_mapped)

  return c.json({
    success: true,
    data: coverage,
    meta: {
      total_roles:   coverage.length,
      mapped_roles:  mappedCodes.size,
      unmapped_roles: unmapped.length,
      coverage_pct:  Math.round((mappedCodes.size / coverage.length) * 100),
      gaps: unmapped.map(r => r.role_code),
    },
  })
})

// ── GET /api/gl/account-role-policy/resolve/:role ────────────────────────────
// Resolve a role code to an actual account_code (the Policy Engine core)
accountRolePolicy.get('/resolve/:role', async (c) => {
  const { company_id } = getUser(c)
  const role = c.req.param('role').toUpperCase()

  const row = await c.env.DB
    .prepare(`
      SELECT
        m.account_code, m.priority, m.notes,
        r.name as role_name, r.category,
        a.name as account_name, a.account_type, a.normal_balance
      FROM account_role_mappings m
      LEFT JOIN md_account_roles r ON r.code = m.role_code
      LEFT JOIN chart_of_accounts a ON a.code = m.account_code AND a.company_id = m.company_id
      WHERE m.company_id = ? AND m.role_code = ? AND m.is_active = 1
      ORDER BY m.priority ASC
      LIMIT 1
    `)
    .bind(company_id, role)
    .first<{ account_code: string; priority: number; notes: string | null
      role_name: string; category: string
      account_name: string; account_type: string; normal_balance: string
    }>()

  if (!row) {
    return c.json({
      success: false,
      error: `الدور "${role}" غير معيّن لأي حساب في هذه الشركة`,
      role,
    }, 404)
  }

  return c.json({
    success: true,
    data: {
      role_code:      role,
      role_name:      row.role_name,
      category:       row.category,
      account_code:   row.account_code,
      account_name:   row.account_name,
      account_type:   row.account_type,
      normal_balance: row.normal_balance,
      notes:          row.notes,
    },
  })
})

// ── POST /api/gl/account-role-policy ─────────────────────────────────────────
// Create or update a role-to-account mapping
accountRolePolicy.post('/', roleGuard(['super_admin', 'company_admin']), async (c) => {
  const { sub: user_id, company_id } = getUser(c)

  let body: {
    role_code:    string
    account_code: string
    priority?:    number
    notes?:       string
  }

  try {
    body = await c.req.json()
  } catch {
    return c.json({ success: false, error: 'بيانات JSON غير صحيحة' }, 400)
  }

  if (!body.role_code || !body.account_code) {
    return c.json({ success: false, error: 'role_code و account_code مطلوبان' }, 400)
  }

  const role = body.role_code.toUpperCase()

  // Verify role exists
  const roleRow = await c.env.DB
    .prepare('SELECT id FROM md_account_roles WHERE code = ?')
    .bind(role)
    .first()

  if (!roleRow) {
    return c.json({ success: false, error: `الدور "${role}" غير موجود في الأنواع المعيارية` }, 404)
  }

  // Verify account exists in this company's chart
  const accountRow = await c.env.DB
    .prepare('SELECT code, name FROM chart_of_accounts WHERE code = ? AND company_id = ? AND is_active = 1')
    .bind(body.account_code, company_id)
    .first<{ code: string; name: string }>()

  if (!accountRow) {
    return c.json({ success: false, error: `الحساب "${body.account_code}" غير موجود في دليل الحسابات` }, 404)
  }

  // Upsert
  const existing = await c.env.DB
    .prepare('SELECT id FROM account_role_mappings WHERE company_id = ? AND role_code = ? AND account_code = ?')
    .bind(company_id, role, body.account_code)
    .first<{ id: number }>()

  if (existing) {
    await c.env.DB
      .prepare(`
        UPDATE account_role_mappings
        SET priority = ?, notes = ?, is_active = 1, updated_at = datetime('now')
        WHERE id = ?
      `)
      .bind(body.priority ?? 1, body.notes ?? null, existing.id)
      .run()

    await logAudit(c.env.DB, {
      user_id, company_id,
      action:     'UPDATE',
      table_name: 'account_role_mappings',
      record_id:  existing.id,
      new_value:  { role, account_code: body.account_code },
    })

    return c.json({ success: true, data: { id: existing.id, role, ...body, updated: true } })
  }

  const result = await c.env.DB
    .prepare(`
      INSERT INTO account_role_mappings (company_id, role_code, account_code, priority, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(company_id, role, body.account_code, body.priority ?? 1, body.notes ?? null, user_id)
    .run()

  const newId = result.meta?.last_row_id as number

  await logAudit(c.env.DB, {
    user_id, company_id,
    action:     'CREATE',
    table_name: 'account_role_mappings',
    record_id:  newId,
    new_value:  { role, account_code: body.account_code },
  })

  return c.json({
    success: true,
    data: { id: newId, role, ...body, updated: false },
  }, 201)
})

// ── DELETE /api/gl/account-role-policy/:id ───────────────────────────────────
accountRolePolicy.delete('/:id', roleGuard(['super_admin', 'company_admin']), async (c) => {
  const { sub: user_id, company_id } = getUser(c)
  const id = parseInt(c.req.param('id') ?? '')

  if (isNaN(id)) return c.json({ success: false, error: 'معرف غير صحيح' }, 400)

  const existing = await c.env.DB
    .prepare('SELECT * FROM account_role_mappings WHERE id = ? AND company_id = ?')
    .bind(id, company_id)
    .first<{ role_code: string; account_code: string }>()

  if (!existing) return c.json({ success: false, error: 'التعيين غير موجود' }, 404)

  await c.env.DB
    .prepare("UPDATE account_role_mappings SET is_active = 0, updated_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run()

  await logAudit(c.env.DB, {
    user_id, company_id,
    action:     'DELETE',
    table_name: 'account_role_mappings',
    record_id:  id,
    old_value:  existing,
  })

  return c.json({ success: true, data: { id, deactivated: true } })
})

export default accountRolePolicy
