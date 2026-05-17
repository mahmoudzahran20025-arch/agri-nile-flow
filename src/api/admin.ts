import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser, signJwt } from '../middleware/auth'
import { logAudit } from '../lib/audit'

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

// POST /api/admin/companies — full onboarding: create company + seed CoA, cost centers, service types, fiscal year
admin.post('/companies', async (c) => {
  const b = await c.req.json<{
    code: string; name: string; address?: string; phone?: string
    fiscal_year?: number
  }>()
  if (!b.code?.trim() || !b.name?.trim()) {
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
  const year = b.fiscal_year ?? new Date().getFullYear()

  const seeding: Record<string, number | string> = {}

  // 1. Chart of accounts (clone from company 1 template)
  const coaResult = await c.env.DB.prepare(`
    INSERT OR IGNORE INTO chart_of_accounts (company_id, code, name, account_type, normal_balance, level, is_header, is_active)
    SELECT ${companyId}, code, name, account_type, normal_balance, level, is_header, 1
    FROM chart_of_accounts WHERE company_id = 1 AND is_active = 1
  `).run().catch(() => ({ meta: { changes: 0 } }))
  seeding.coa_accounts = (coaResult as { meta: { changes: number } }).meta.changes ?? 0

  // 2. GL control posting rules
  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO posting_rules
      (company_id, rule_type, mapping_key, account_code, priority, is_active, created_at, updated_at)
    SELECT ${companyId}, 'control', mapping_key, account_code,
           COALESCE(priority, 100), COALESCE(is_active, 1), datetime('now'), datetime('now')
    FROM posting_rules WHERE company_id = 1 AND rule_type = 'control'
  `).run().catch(() => {})

  // 3. Cost centers
  const ccResult = await c.env.DB.prepare(`
    INSERT OR IGNORE INTO cost_centers (company_id, code, name_ar, name_en, cost_center_type)
    SELECT ${companyId}, code, name_ar, name_en, cost_center_type
    FROM cost_centers WHERE company_id = 1
  `).run().catch(() => ({ meta: { changes: 0 } }))
  seeding.cost_centers = (ccResult as { meta: { changes: number } }).meta.changes ?? 0

  // 4. Service types
  const stResult = await c.env.DB.prepare(`
    INSERT OR IGNORE INTO service_types
      (company_id, code, name_ar, name_en, service_group,
       default_expense_account_code, default_ap_account_code,
       requires_supplier, requires_document, requires_center, is_active)
    SELECT ${companyId}, code, name_ar, name_en, service_group,
           default_expense_account_code, default_ap_account_code,
           requires_supplier, requires_document, requires_center, 1
    FROM service_types WHERE company_id = 1 AND is_active = 1
  `).run().catch(() => ({ meta: { changes: 0 } }))
  seeding.service_types = (stResult as { meta: { changes: number } }).meta.changes ?? 0

  // 5. Fiscal year period
  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO financial_periods (company_id, name, start_date, end_date, is_closed)
    VALUES (?, ?, ?, ?, 0)
  `).bind(companyId, `السنة المالية ${year}`, `${year}-01-01`, `${year}-12-31`).run().catch(() => {})
  seeding.fiscal_year = year

  const { sub: userId } = getUser(c)
  void logAudit(c.env.DB, {
    user_id: userId,
    company_id: companyId,
    action: 'CREATE',
    table_name: 'companies',
    record_id: companyId,
    new_value: { code: b.code.trim().toUpperCase(), name: b.name.trim(), seeding },
    source: 'admin_onboarding',
  })

  return c.json({ success: true, data: { id: companyId, seeding } }, 201)
})

// POST /api/admin/companies/:id/seed-service-types — re-seed service types from template (idempotent)
admin.post('/companies/:id/seed-service-types', async (c) => {
  const companyId = Number(c.req.param('id'))
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return c.json({ success: false, error: 'معرّف الشركة غير صالح' }, 400)
  }

  const company = await c.env.DB.prepare('SELECT id FROM companies WHERE id = ?')
    .bind(companyId).first<{ id: number }>()
  if (!company) return c.json({ success: false, error: 'الشركة غير موجودة' }, 404)

  const result = await c.env.DB.prepare(`
    INSERT OR IGNORE INTO service_types
      (company_id, code, name_ar, name_en, service_group,
       default_expense_account_code, default_ap_account_code,
       requires_supplier, requires_document, requires_center, is_active)
    SELECT ${companyId}, code, name_ar, name_en, service_group,
           default_expense_account_code, default_ap_account_code,
           requires_supplier, requires_document, requires_center, 1
    FROM service_types WHERE company_id = 1 AND is_active = 1
  `).run()

  const { sub: userId } = getUser(c)
  void logAudit(c.env.DB, {
    user_id: userId,
    company_id: companyId,
    action: 'CREATE',
    table_name: 'service_types',
    record_id: companyId,
    new_value: { seeded: result.meta.changes },
    source: 'admin_onboarding',
  })

  return c.json({ success: true, data: { company_id: companyId, seeded: result.meta.changes } })
})

// POST /api/admin/companies/:id/invite-user — add an existing user to a company, or create + assign
admin.post('/companies/:id/invite-user', async (c) => {
  const companyId = Number(c.req.param('id'))
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return c.json({ success: false, error: 'معرّف الشركة غير صالح' }, 400)
  }

  const b = await c.req.json<{ email: string; full_name: string; role?: string }>()
  if (!b.email?.trim()) return c.json({ success: false, error: 'البريد الإلكتروني مطلوب' }, 400)

  const company = await c.env.DB.prepare('SELECT id FROM companies WHERE id = ?')
    .bind(companyId).first<{ id: number }>()
  if (!company) return c.json({ success: false, error: 'الشركة غير موجودة' }, 404)

  const roleName = b.role ?? 'company_admin'
  const role = await c.env.DB.prepare('SELECT id FROM roles WHERE name = ?')
    .bind(roleName).first<{ id: number }>()
  if (!role) return c.json({ success: false, error: `الدور "${roleName}" غير موجود` }, 400)

  // Find or create user
  let user = await c.env.DB.prepare('SELECT id, email FROM users WHERE email = ?')
    .bind(b.email.trim().toLowerCase()).first<{ id: number; email: string }>()

  let created = false
  if (!user) {
    // Generate a random temp token — user must reset password on first login
    const tempToken = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0')).join('')

    const ins = await c.env.DB.prepare(
      'INSERT INTO users (email, full_name, password_hash, is_active) VALUES (?,?,?,1)'
    ).bind(b.email.trim().toLowerCase(), (b.full_name ?? b.email).trim(), `TEMP:${tempToken}`).run()
    user = { id: ins.meta.last_row_id as number, email: b.email.trim().toLowerCase() }
    created = true
  }

  // Link user to company (idempotent)
  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO user_companies (user_id, company_id, role_id, is_active)
     VALUES (?, ?, ?, 1)`
  ).bind(user.id, companyId, role.id).run()

  const { sub: userId } = getUser(c)
  void logAudit(c.env.DB, {
    user_id: userId,
    company_id: companyId,
    action: 'CREATE',
    table_name: 'user_companies',
    record_id: user.id,
    new_value: { email: b.email, role: roleName, created_new_user: created },
    source: 'admin_onboarding',
  })

  return c.json({ success: true, data: { user_id: user.id, company_id: companyId, role: roleName, created_new_user: created } }, 201)
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

  // Audit log: record company update
  const { sub: userId } = getUser(c)
  void logAudit(c.env.DB, {
    user_id: userId,
    company_id: id,
    action: 'UPDATE',
    table_name: 'companies',
    record_id: id,
    new_value: b,
    source: 'admin_panel',
  })

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
           AND im.balance_qty <= i.reorder_threshold AND i.reorder_threshold > 0
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

// GET /api/admin/sanity-check — diagnostic tool to find inconsistencies
admin.get('/sanity-check', async (c) => {
  const { results: companies } = await c.env.DB.prepare('SELECT id, name FROM companies WHERE is_active = 1').all<{ id: number; name: string }>()
  
  const report = await Promise.all(companies.map(async co => {
    const cid = co.id
    
    // 1. Inventory Check: Do stored balances match the movement history?
    const invIssues = await c.env.DB.prepare(`
      SELECT im.item_code, im.warehouse, im.balance_qty,
             (SELECT SUM(qty_in - qty_out) FROM inventory_movements 
              WHERE company_id = ? AND item_code = im.item_code AND warehouse = im.warehouse) AS calculated_qty
      FROM inventory_movements im
      WHERE im.company_id = ?
        AND im.id = (SELECT MAX(id) FROM inventory_movements WHERE company_id = ? AND item_code = im.item_code AND warehouse = im.warehouse)
      HAVING ABS(balance_qty - calculated_qty) > 0.0001
    `).bind(cid, cid, cid).all()

    // 2. Ledger Check: Is the trial balance balanced?
    const glIssues = await c.env.DB.prepare(`
      SELECT SUM(debit) AS total_debit, SUM(credit) AS total_credit
      FROM journal_entry_lines
      WHERE company_id = ?
    `).bind(cid).first<{ total_debit: number; total_credit: number }>()

    // 3. Supplier Check: Do supplier totals match transaction history?
    const supIssues = await c.env.DB.prepare(`
      SELECT st.supplier_code, st.balance_with_checks,
             (SELECT SUM(credit - debit) FROM supplier_transactions 
              WHERE company_id = ? AND supplier_code = st.supplier_code) AS calculated_bal
      FROM supplier_transactions st
      WHERE st.company_id = ?
        AND st.id = (SELECT MAX(id) FROM supplier_transactions WHERE company_id = ? AND supplier_code = st.supplier_code)
      HAVING ABS(balance_with_checks - calculated_bal) > 0.01
    `).bind(cid, cid, cid).all()

    // 4. Error Log Count (Last 24h)
    const errorCount = await c.env.DB.prepare(`
      SELECT COUNT(*) AS n FROM system_error_logs 
      WHERE company_id = ? AND created_at > datetime('now', '-1 day')
    `).bind(cid).first<{ n: number }>()

    return {
      company: co.name,
      inventory_discrepancies: invIssues.results.length,
      gl_out_of_balance: Math.abs((glIssues?.total_debit ?? 0) - (glIssues?.total_credit ?? 0)) > 0.01,
      supplier_discrepancies: supIssues.results.length,
      errors_last_24h: errorCount?.n ?? 0,
      details: {
        inv: invIssues.results,
        sup: supIssues.results,
        gl: glIssues
      }
    }
  }))

  return c.json({ success: true, data: report })
})

// GET /api/admin/consolidated-pnl?start=YYYY-MM-DD&end=YYYY-MM-DD
// Aggregated income statement across all active companies.
admin.get('/consolidated-pnl', async (c) => {
  const start = c.req.query('start')
  const end   = c.req.query('end')
  if (!start || !end) return c.json({ success: false, error: 'start and end required' }, 400)

  // Per-company revenue/expense totals from posted journal entries
  const { results: lines } = await c.env.DB.prepare(`
    SELECT
      e.company_id,
      co.name                                          AS company_name,
      co.code                                          AS company_code,
      coa.account_type,
      coa.normal_balance,
      SUM(l.debit)                                     AS total_debit,
      SUM(l.credit)                                    AS total_credit
    FROM journal_entry_lines l
    JOIN journal_entries e
      ON e.id = l.entry_id AND e.company_id = l.company_id AND e.is_posted = 1
    JOIN chart_of_accounts coa
      ON coa.code = l.account_code AND coa.company_id = l.company_id
    JOIN companies co ON co.id = e.company_id AND co.is_active = 1
    WHERE e.entry_date >= ? AND e.entry_date <= ?
      AND coa.account_type IN ('revenue', 'expense')
    GROUP BY e.company_id, co.name, co.code, coa.account_type, coa.normal_balance
    ORDER BY co.code, coa.account_type
  `).bind(start, end).all<{
    company_id: number; company_name: string; company_code: string
    account_type: string; normal_balance: string
    total_debit: number; total_credit: number
  }>()

  // Aggregate per company
  const byCompany = new Map<number, {
    company_id: number; company_name: string; company_code: string
    revenue: number; expense: number
  }>()

  for (const row of lines) {
    if (!byCompany.has(row.company_id)) {
      byCompany.set(row.company_id, {
        company_id: row.company_id,
        company_name: row.company_name,
        company_code: row.company_code,
        revenue: 0, expense: 0,
      })
    }
    const co = byCompany.get(row.company_id)!
    const signed = row.normal_balance === 'credit'
      ? row.total_credit - row.total_debit
      : row.total_debit - row.total_credit

    if (row.account_type === 'revenue') co.revenue += signed
    else                                 co.expense += signed
  }

  const companies = Array.from(byCompany.values()).map(co => ({
    ...co,
    net_income: co.revenue - co.expense,
  })).sort((a, b) => a.company_code.localeCompare(b.company_code))

  const totals = companies.reduce((acc, co) => ({
    revenue:    acc.revenue    + co.revenue,
    expense:    acc.expense    + co.expense,
    net_income: acc.net_income + co.net_income,
  }), { revenue: 0, expense: 0, net_income: 0 })

  return c.json({
    success: true,
    data: {
      period: { start, end },
      company_count: companies.length,
      totals,
      companies,
    },
  })
})

export default admin
