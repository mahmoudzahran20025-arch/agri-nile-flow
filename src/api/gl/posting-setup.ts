import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'
import { logAudit } from '../../lib/audit'
import {
  resolveInventoryMovement as peResolveInventory,
  resolveHarvestMovement as peResolveHarvest,
  resolveSupplierInvoice   as peResolveSupplierInvoice,
  resolveSupplierPayment   as peResolveSupplierPayment,
  resolveExpensePosting    as peResolveExpense,
  resolveSalesRevenue      as peResolveSalesRevenue,
  clearPostingEngineCaches,
} from '../../lib/posting_engine'

const postingSetup = new Hono<{ Bindings: Env }>()
postingSetup.use('*', authMiddleware)
postingSetup.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

async function submitPostingRuleChangeForApproval(
  db: Env['DB'],
  opts: {
    company_id: number
    user_id: number
    action: 'INSERT' | 'UPDATE' | 'ACTIVATE' | 'DEACTIVATE' | 'DELETE'
    rule_id?: number
    reason: string
    old_values?: Record<string, unknown> | null
    new_values: Record<string, unknown>
  },
): Promise<number> {
  const result = await db.prepare(
    `INSERT INTO posting_rules_audit
     (company_id, rule_id, action, changed_by, changed_at, change_reason,
      approval_status, old_values, new_values)
     VALUES (?,?,?,?,datetime('now'),?,'pending',?,?)`
  ).bind(
    opts.company_id,
    opts.rule_id ?? 0,
    opts.action,
    opts.user_id,
    opts.reason,
    JSON.stringify(opts.old_values ?? null),
    JSON.stringify(opts.new_values),
  ).run()

  return Number(result.meta.last_row_id ?? 0)
}

const PG_TABLES = {
  business:  'business_posting_groups',
  product:   'product_posting_groups',
  inventory: 'inventory_posting_groups',
} as const
type PgType = keyof typeof PG_TABLES

const CODE_RE = /^[A-Z0-9_-]{1,20}$/

// =============================================================================
// POSTING RULES
// =============================================================================

// GET /api/gl/posting-rules
postingSetup.get('/posting-rules', async (c) => {
  const { company_id } = getUser(c)
  const ruleType = c.req.query('rule_type')
  const activeQ = c.req.query('active')
  const mappingKey = c.req.query('mapping_key')
  const bpg = c.req.query('bus_posting_group_code')
  const ppg = c.req.query('prod_posting_group_code')
  const ipg = c.req.query('inv_posting_group_code')

  if (ruleType && !['general', 'inventory', 'control'].includes(ruleType)) {
    return c.json({ success: false, error: 'Invalid rule_type. Use: general | inventory | control' }, 400)
  }
  if (activeQ !== undefined && activeQ !== '0' && activeQ !== '1') {
    return c.json({ success: false, error: 'Invalid active filter. Use: 0 or 1' }, 400)
  }

  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const size = Math.min(200, Math.max(1, Number(c.req.query('size') ?? 100)))
  const offset = (page - 1) * size

  let where = 'WHERE company_id = ?'
  const binds: unknown[] = [company_id]

  if (ruleType) { where += ' AND rule_type = ?'; binds.push(ruleType) }
  if (activeQ !== undefined) { where += ' AND is_active = ?'; binds.push(Number(activeQ)) }
  if (mappingKey) { where += ' AND mapping_key = ?'; binds.push(mappingKey) }
  if (bpg) { where += ' AND bus_posting_group_code = ?'; binds.push(bpg.toUpperCase()) }
  if (ppg) { where += ' AND prod_posting_group_code = ?'; binds.push(ppg.toUpperCase()) }
  if (ipg) { where += ' AND inv_posting_group_code = ?'; binds.push(ipg.toUpperCase()) }

  const [rows, totalRow] = await Promise.all([
    c.env.DB.prepare(
            `SELECT id, company_id, rule_type,
              bus_posting_group_code, prod_posting_group_code, inv_posting_group_code,
              mapping_key, account_code,
              sales_account, purchases_account, cogs_account,
              sales_returns_account, purch_returns_account, expense_account,
              inventory_account, wip_account, finished_goods_account,
              priority, is_active, created_at, updated_at
       FROM posting_rules
       ${where}
       ORDER BY rule_type ASC, priority ASC, id ASC
       LIMIT ? OFFSET ?`
    ).bind(...binds, size, offset).all(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM posting_rules ${where}`)
      .bind(...binds).first<{ n: number }>(),
  ])

  return c.json({
    success: true,
    data: rows.results,
    total: totalRow?.n ?? 0,
    page,
    page_size: size,
  })
})

// =============================================================================
// POSTING GROUPS
// =============================================================================

// GET /api/gl/posting-groups/:type
postingSetup.get('/posting-groups/:type', async (c) => {
  const type = c.req.param('type') as PgType
  if (!PG_TABLES[type]) return c.json({ success: false, error: 'Invalid type. Use: business | product | inventory' }, 400)
  const { company_id } = getUser(c)
  const table = PG_TABLES[type]
  const { results } = await c.env.DB
    .prepare(`SELECT code, name, description, is_active, created_at FROM ${table} WHERE company_id = ? ORDER BY code`)
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

// POST /api/gl/posting-groups/:type
postingSetup.post('/posting-groups/:type', async (c) => {
  const type = c.req.param('type') as PgType
  if (!PG_TABLES[type]) return c.json({ success: false, error: 'Invalid type' }, 400)
  const { company_id, sub: userId } = getUser(c)
  const body = await c.req.json<{ code: string; name: string; description?: string }>()

  if (!body.code || !CODE_RE.test(body.code.toUpperCase()))
    return c.json({ success: false, error: 'code must be 1–20 uppercase letters, digits, underscores or dashes' }, 422)
  if (!body.name?.trim())
    return c.json({ success: false, error: 'name is required' }, 422)

  const code = body.code.toUpperCase()
  const table = PG_TABLES[type]
  const exists = await c.env.DB
    .prepare(`SELECT 1 FROM ${table} WHERE company_id = ? AND code = ?`)
    .bind(company_id, code).first()
  if (exists) return c.json({ success: false, error: `Code "${code}" already exists` }, 409)

  await c.env.DB
    .prepare(`INSERT INTO ${table} (company_id, code, name, description, is_active, created_at) VALUES (?,?,?,?,1,datetime('now'))`)
    .bind(company_id, code, body.name.trim(), body.description?.trim() ?? null).run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'CREATE', table_name: table, new_value: { code } })
  return c.json({ success: true, data: { code } }, 201)
})

// PATCH /api/gl/posting-groups/:type/:code
postingSetup.patch('/posting-groups/:type/:code', async (c) => {
  const type = c.req.param('type') as PgType
  if (!PG_TABLES[type]) return c.json({ success: false, error: 'Invalid type' }, 400)
  const { company_id, sub: userId } = getUser(c)
  const code = c.req.param('code').toUpperCase()
  const table = PG_TABLES[type]

  const existing = await c.env.DB
    .prepare(`SELECT is_active FROM ${table} WHERE company_id = ? AND code = ?`)
    .bind(company_id, code).first<{ is_active: number }>()
  if (!existing) return c.json({ success: false, error: 'Not found' }, 404)

  const body = await c.req.json<{ name?: string; description?: string; is_active?: boolean }>()

  if (body.is_active === false && existing.is_active === 1) {
    const col = type === 'business' ? 'bus_posting_group_code'
              : type === 'product'  ? 'prod_posting_group_code'
              : 'inv_posting_group_code'
    const ruleType = type === 'inventory' ? 'inventory' : 'general'
    const used = await c.env.DB
      .prepare(`SELECT 1 FROM posting_rules WHERE company_id = ? AND rule_type = ? AND ${col} = ? AND is_active = 1 LIMIT 1`)
      .bind(company_id, ruleType, code).first()
    if (used) return c.json({ success: false, error: `Cannot deactivate: code "${code}" is still used in active posting setup rows.` }, 409)
  }

  const sets: string[] = []
  const vals: unknown[] = []
  if (body.name !== undefined)        { sets.push('name = ?');        vals.push(body.name.trim()) }
  if (body.description !== undefined) { sets.push('description = ?'); vals.push(body.description?.trim() ?? null) }
  if (body.is_active !== undefined)   { sets.push('is_active = ?');   vals.push(body.is_active ? 1 : 0) }
  if (!sets.length) return c.json({ success: false, error: 'Nothing to update' }, 422)
  vals.push(company_id, code)

  await c.env.DB
    .prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE company_id = ? AND code = ?`)
    .bind(...vals).run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'UPDATE', table_name: table, new_value: { code, ...body } })
  return c.json({ success: true })
})

// =============================================================================
// GENERAL POSTING SETUP
// =============================================================================

// GET /api/gl/posting-setup/general
postingSetup.get('/posting-setup/general', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare(`SELECT id, bus_posting_group_code, prod_posting_group_code,
               sales_account, purchases_account, cogs_account,
               sales_returns_account, purch_returns_account, expense_account, is_active
              FROM posting_rules WHERE company_id = ? AND rule_type = 'general'
              ORDER BY bus_posting_group_code NULLS LAST, prod_posting_group_code NULLS LAST`)
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

// POST /api/gl/posting-setup/general
postingSetup.post('/posting-setup/general', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const body = await c.req.json<{
    bus_posting_group_code?: string | null
    prod_posting_group_code?: string | null
    sales_account?: string | null
    purchases_account?: string | null
    cogs_account?: string | null
    sales_returns_account?: string | null
    purch_returns_account?: string | null
    expense_account?: string | null
    change_reason?: string
  }>()

  const bpg = body.bus_posting_group_code?.toUpperCase() ?? null
  const ppg = body.prod_posting_group_code?.toUpperCase() ?? null

  const exists = await c.env.DB
    .prepare(`SELECT 1 FROM posting_rules WHERE company_id = ? AND rule_type = 'general'
              AND (bus_posting_group_code IS ? OR (bus_posting_group_code IS NULL AND ? IS NULL))
              AND (prod_posting_group_code IS ? OR (prod_posting_group_code IS NULL AND ? IS NULL)) LIMIT 1`)
    .bind(company_id, bpg, bpg, ppg, ppg).first()
  if (exists) return c.json({ success: false, error: `A setup row for BPG="${bpg ?? 'DEFAULT'}" × PPG="${ppg ?? 'DEFAULT'}" already exists.` }, 409)

  const pendingId = await submitPostingRuleChangeForApproval(c.env.DB, {
    company_id,
    user_id: userId,
    action: 'INSERT',
    reason: body.change_reason?.trim() || 'Submitted from posting setup (general)',
    new_values: {
      rule_type: 'general',
      bus_posting_group_code: bpg,
      prod_posting_group_code: ppg,
      sales_account: body.sales_account ?? null,
      purchases_account: body.purchases_account ?? null,
      cogs_account: body.cogs_account ?? null,
      sales_returns_account: body.sales_returns_account ?? null,
      purch_returns_account: body.purch_returns_account ?? null,
      expense_account: body.expense_account ?? null,
      priority: 100,
      is_active: 1,
    },
  })

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'CREATE', table_name: 'posting_rules_audit', new_value: { pending_audit_id: pendingId, rule_type: 'general', bpg, ppg } })
  return c.json({ success: true, pending_approval: true, data: { audit_id: pendingId } }, 202)
})

// PATCH /api/gl/posting-setup/general/:id
postingSetup.patch('/posting-setup/general/:id', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const rowId = Number(c.req.param('id'))
  if (!rowId) return c.json({ success: false, error: 'Invalid id' }, 400)

  const existing = await c.env.DB
    .prepare("SELECT id FROM posting_rules WHERE id = ? AND company_id = ? AND rule_type = 'general'")
    .bind(rowId, company_id).first()
  if (!existing) return c.json({ success: false, error: 'Not found' }, 404)

  const body = await c.req.json<{
    sales_account?: string | null; purchases_account?: string | null; cogs_account?: string | null
    sales_returns_account?: string | null; purch_returns_account?: string | null
    expense_account?: string | null; is_active?: boolean; change_reason?: string
  }>()

  const sets: string[] = []
  const vals: unknown[] = []
  const fields = ['sales_account','purchases_account','cogs_account','sales_returns_account','purch_returns_account','expense_account'] as const
  for (const f of fields) {
    if (f in body) { sets.push(`${f} = ?`); vals.push(body[f] ?? null) }
  }
  if (body.is_active !== undefined) { sets.push('is_active = ?'); vals.push(body.is_active ? 1 : 0) }
  if (!sets.length) return c.json({ success: false, error: 'Nothing to update' }, 422)
  vals.push(rowId, company_id)

  const currentRow = await c.env.DB
    .prepare(`SELECT id, rule_type, bus_posting_group_code, prod_posting_group_code,
                     sales_account, purchases_account, cogs_account,
                     sales_returns_account, purch_returns_account, expense_account,
                     priority, is_active
              FROM posting_rules
              WHERE id = ? AND company_id = ? AND rule_type = 'general'`)
    .bind(rowId, company_id).first<Record<string, unknown>>()

  const newValues = {
    id: rowId,
    rule_type: 'general',
    sales_account: body.sales_account,
    purchases_account: body.purchases_account,
    cogs_account: body.cogs_account,
    sales_returns_account: body.sales_returns_account,
    purch_returns_account: body.purch_returns_account,
    expense_account: body.expense_account,
    is_active: body.is_active === undefined ? undefined : (body.is_active ? 1 : 0),
  }

  const pendingId = await submitPostingRuleChangeForApproval(c.env.DB, {
    company_id,
    user_id: userId,
    rule_id: rowId,
    action: body.is_active === true ? 'ACTIVATE' : body.is_active === false ? 'DEACTIVATE' : 'UPDATE',
    reason: body.change_reason?.trim() || 'Submitted from posting setup update (general)',
    old_values: currentRow,
    new_values: newValues,
  })

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'UPDATE', table_name: 'posting_rules_audit', new_value: { pending_audit_id: pendingId, id: rowId, rule_type: 'general' } })
  return c.json({ success: true, pending_approval: true, data: { audit_id: pendingId } }, 202)
})

// =============================================================================
// INVENTORY POSTING SETUP
// =============================================================================

// GET /api/gl/posting-setup/inventory
postingSetup.get('/posting-setup/inventory', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare(`SELECT id, inv_posting_group_code, prod_posting_group_code, inventory_account, wip_account, finished_goods_account, is_active
              FROM posting_rules WHERE company_id = ? AND rule_type = 'inventory'
              ORDER BY inv_posting_group_code NULLS LAST, prod_posting_group_code NULLS LAST`)
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

// POST /api/gl/posting-setup/inventory
postingSetup.post('/posting-setup/inventory', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const body = await c.req.json<{
    inv_posting_group_code?: string | null
    prod_posting_group_code?: string | null
    inventory_account?: string | null
    wip_account?: string | null
    finished_goods_account?: string | null
    change_reason?: string
  }>()

  const ipg = body.inv_posting_group_code?.toUpperCase() ?? null
  const ppg = body.prod_posting_group_code?.toUpperCase() ?? null

  const exists = await c.env.DB
    .prepare(`SELECT 1 FROM posting_rules WHERE company_id = ? AND rule_type = 'inventory'
              AND (inv_posting_group_code IS ? OR (inv_posting_group_code IS NULL AND ? IS NULL))
              AND (prod_posting_group_code IS ? OR (prod_posting_group_code IS NULL AND ? IS NULL)) LIMIT 1`)
    .bind(company_id, ipg, ipg, ppg, ppg).first()
  if (exists) return c.json({ success: false, error: `A setup row for IPG="${ipg ?? 'DEFAULT'}" × PPG="${ppg ?? 'DEFAULT'}" already exists.` }, 409)

  const pendingId = await submitPostingRuleChangeForApproval(c.env.DB, {
    company_id,
    user_id: userId,
    action: 'INSERT',
    reason: body.change_reason?.trim() || 'Submitted from posting setup (inventory)',
    new_values: {
      rule_type: 'inventory',
      inv_posting_group_code: ipg,
      prod_posting_group_code: ppg,
      inventory_account: body.inventory_account ?? null,
      wip_account: body.wip_account ?? null,
      finished_goods_account: body.finished_goods_account ?? null,
      priority: 100,
      is_active: 1,
    },
  })

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'CREATE', table_name: 'posting_rules_audit', new_value: { pending_audit_id: pendingId, rule_type: 'inventory', ipg, ppg } })
  return c.json({ success: true, pending_approval: true, data: { audit_id: pendingId } }, 202)
})

// PATCH /api/gl/posting-setup/inventory/:id
postingSetup.patch('/posting-setup/inventory/:id', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const rowId = Number(c.req.param('id'))
  if (!rowId) return c.json({ success: false, error: 'Invalid id' }, 400)

  const existing = await c.env.DB
    .prepare("SELECT id FROM posting_rules WHERE id = ? AND company_id = ? AND rule_type = 'inventory'")
    .bind(rowId, company_id).first()
  if (!existing) return c.json({ success: false, error: 'Not found' }, 404)

  const body = await c.req.json<{ inventory_account?: string | null; wip_account?: string | null; finished_goods_account?: string | null; is_active?: boolean; change_reason?: string }>()
  const sets: string[] = []
  const vals: unknown[] = []
  if ('inventory_account' in body) { sets.push('inventory_account = ?'); vals.push(body.inventory_account ?? null) }
  if ('wip_account' in body) { sets.push('wip_account = ?'); vals.push(body.wip_account ?? null) }
  if ('finished_goods_account' in body) { sets.push('finished_goods_account = ?'); vals.push(body.finished_goods_account ?? null) }
  if (body.is_active !== undefined) { sets.push('is_active = ?');        vals.push(body.is_active ? 1 : 0) }
  if (!sets.length) return c.json({ success: false, error: 'Nothing to update' }, 422)
  vals.push(rowId, company_id)

  const currentRow = await c.env.DB
    .prepare(`SELECT id, rule_type, inv_posting_group_code, prod_posting_group_code,
                     inventory_account, wip_account, finished_goods_account,
                     priority, is_active
              FROM posting_rules
              WHERE id = ? AND company_id = ? AND rule_type = 'inventory'`)
    .bind(rowId, company_id).first<Record<string, unknown>>()

  const newValues = {
    id: rowId,
    rule_type: 'inventory',
    inventory_account: body.inventory_account,
    wip_account: body.wip_account,
    finished_goods_account: body.finished_goods_account,
    is_active: body.is_active === undefined ? undefined : (body.is_active ? 1 : 0),
  }

  const pendingId = await submitPostingRuleChangeForApproval(c.env.DB, {
    company_id,
    user_id: userId,
    rule_id: rowId,
    action: body.is_active === true ? 'ACTIVATE' : body.is_active === false ? 'DEACTIVATE' : 'UPDATE',
    reason: body.change_reason?.trim() || 'Submitted from posting setup update (inventory)',
    old_values: currentRow,
    new_values: newValues,
  })

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'UPDATE', table_name: 'posting_rules_audit', new_value: { pending_audit_id: pendingId, id: rowId, rule_type: 'inventory' } })
  return c.json({ success: true, pending_approval: true, data: { audit_id: pendingId } }, 202)
})

// =============================================================================
// POSTING SETUP HEALTH
// =============================================================================

// GET /api/gl/posting-setup/health
postingSetup.get('/posting-setup/health', async (c) => {
  const { company_id } = getUser(c)

  const [bpgRow, ppgRow, ipgRow, gpsRow, ipsRow,
         gpsNullRow, ipsNullRow,
         suppliersNoGroup, itemsNoGroup, warehousesNoGroup,
         gpsIncomplete, ipsIncomplete] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM business_posting_groups  WHERE company_id = ? AND is_active = 1').bind(company_id).first<{n:number}>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM product_posting_groups   WHERE company_id = ? AND is_active = 1').bind(company_id).first<{n:number}>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM inventory_posting_groups WHERE company_id = ? AND is_active = 1').bind(company_id).first<{n:number}>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM posting_rules WHERE company_id = ? AND rule_type = 'general' AND is_active = 1").bind(company_id).first<{n:number}>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM posting_rules WHERE company_id = ? AND rule_type = 'inventory' AND is_active = 1").bind(company_id).first<{n:number}>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM posting_rules WHERE company_id = ? AND rule_type = 'general' AND bus_posting_group_code IS NULL AND prod_posting_group_code IS NULL AND is_active = 1").bind(company_id).first<{n:number}>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM posting_rules WHERE company_id = ? AND rule_type = 'inventory' AND inv_posting_group_code  IS NULL AND prod_posting_group_code IS NULL AND is_active = 1").bind(company_id).first<{n:number}>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM suppliers  WHERE company_id = ? AND bus_posting_group_code IS NULL').bind(company_id).first<{n:number}>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM items      WHERE company_id = ? AND prod_posting_group_code IS NULL').bind(company_id).first<{n:number}>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM warehouses WHERE company_id = ? AND inv_posting_group_code  IS NULL').bind(company_id).first<{n:number}>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM posting_rules WHERE company_id = ? AND rule_type = 'general' AND is_active = 1
      AND (sales_account IS NULL OR purchases_account IS NULL OR cogs_account IS NULL)`).bind(company_id).first<{n:number}>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM posting_rules WHERE company_id = ? AND rule_type = 'inventory' AND is_active = 1 AND inventory_account IS NULL").bind(company_id).first<{n:number}>(),
  ])

  const hasCatchAllGeneral   = (gpsNullRow?.n  ?? 0) > 0
  const hasCatchAllInventory = (ipsNullRow?.n  ?? 0) > 0

  const issues: string[] = []
  if (!hasCatchAllGeneral)   issues.push('No catch-all General Posting Setup row (NULL/NULL). Unassigned entities will be blocked.')
  if (!hasCatchAllInventory) issues.push('No catch-all Inventory Posting Setup row (NULL/NULL). Unassigned warehouses/items will be blocked.')
  if ((gpsIncomplete?.n ?? 0) > 0) issues.push(`${gpsIncomplete!.n} General Posting Setup row(s) have missing accounts (sales/purchases/COGS).`)
  if ((ipsIncomplete?.n ?? 0) > 0) issues.push(`${ipsIncomplete!.n} Inventory Posting Setup row(s) have NULL inventory_account.`)

  const warnings: string[] = []
  if ((suppliersNoGroup?.n ?? 0) > 0)  warnings.push(`${suppliersNoGroup!.n} supplier(s) have no Business Posting Group.`)
  if ((itemsNoGroup?.n     ?? 0) > 0)  warnings.push(`${itemsNoGroup!.n} item(s) have no Product Posting Group.`)
  if ((warehousesNoGroup?.n ?? 0) > 0) warnings.push(`${warehousesNoGroup!.n} warehouse(s) have no Inventory Posting Group.`)

  return c.json({
    success: true,
    data: {
      groups: {
        business_posting_groups:  bpgRow?.n  ?? 0,
        product_posting_groups:   ppgRow?.n  ?? 0,
        inventory_posting_groups: ipgRow?.n  ?? 0,
      },
      setup: {
        general_rows:             gpsRow?.n  ?? 0,
        inventory_rows:           ipsRow?.n  ?? 0,
        has_catch_all_general:    hasCatchAllGeneral,
        has_catch_all_inventory:  hasCatchAllInventory,
      },
      entities: {
        suppliers_missing_group:  suppliersNoGroup?.n  ?? 0,
        items_missing_group:      itemsNoGroup?.n      ?? 0,
        warehouses_missing_group: warehousesNoGroup?.n ?? 0,
      },
      issues,
      warnings,
      is_ready: issues.length === 0,
    },
  })
})

// =============================================================================
// VALIDATE POSTING (dry-run resolve)
// =============================================================================

// POST /api/gl/posting-setup/validate
postingSetup.post('/posting-setup/validate', async (c) => {
  const { company_id } = getUser(c)
  const body = await c.req.json<{
    type: 'inventory_in' | 'inventory_out' | 'harvest' | 'supplier_invoice' | 'supplier_payment' | 'expense' | 'revenue'
    bpg_code?: string | null
    ppg_code?: string | null
    ipg_code?: string | null
    ap_code?: string
    cash_code?: string
    receivable_code?: string
    amount?: number
  }>()

  const amt = body.amount ?? 1000

  let blueprint
  switch (body.type) {
    case 'inventory_in':
    case 'inventory_out':
      blueprint = await peResolveInventory(c.env.DB, company_id, body.ipg_code ?? null, body.ppg_code ?? null, amt, body.type === 'inventory_in' ? 'GRN' : 'ISSUE')
      break
    case 'harvest':
      blueprint = await peResolveHarvest(c.env.DB, company_id, body.ipg_code ?? null, body.ppg_code ?? null, amt)
      break
    case 'supplier_invoice':
      if (!body.ap_code) return c.json({ success: false, error: 'ap_code required for supplier_invoice' }, 422)
      blueprint = await peResolveSupplierInvoice(c.env.DB, company_id, body.bpg_code ?? null, body.ppg_code ?? null, body.ap_code, amt)
      break
    case 'supplier_payment':
      if (!body.ap_code || !body.cash_code) return c.json({ success: false, error: 'ap_code and cash_code required' }, 422)
      blueprint = await peResolveSupplierPayment(c.env.DB, company_id, body.ap_code, body.cash_code, amt)
      break
    case 'expense':
      if (!body.cash_code) return c.json({ success: false, error: 'cash_code required for expense' }, 422)
      blueprint = await peResolveExpense(c.env.DB, company_id, body.bpg_code ?? null, body.ppg_code ?? null, body.cash_code, amt)
      break
    case 'revenue':
      if (!body.receivable_code) return c.json({ success: false, error: 'receivable_code required for revenue' }, 422)
      blueprint = await peResolveSalesRevenue(c.env.DB, company_id, body.bpg_code ?? null, body.ppg_code ?? null, body.receivable_code, amt)
      break
    default:
      return c.json({ success: false, error: 'Invalid type. Use: inventory_in | inventory_out | harvest | supplier_invoice | supplier_payment | expense | revenue' }, 422)
  }

  return c.json({ success: true, data: blueprint })
})

// =============================================================================
// SERVICE TYPES CRUD
// =============================================================================

const SERVICE_GROUPS = ['MECHANIZATION', 'LABOR', 'SUPPLY', 'LOGISTICS', 'SUPERVISION', 'SPARE_PARTS', 'OTHER'] as const

// GET /gl/service-types
postingSetup.get('/service-types', async (c) => {
  const { company_id } = getUser(c)
  const tableExists = await c.env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='service_types' LIMIT 1`
  ).first<{ name: string }>()
  if (!tableExists) return c.json({ success: true, data: [] })

  const { results } = await c.env.DB.prepare(`
    SELECT id, code, name_ar, name_en, service_group,
           default_expense_account_code, default_ap_account_code,
           requires_supplier, requires_document, requires_center, is_active, created_at
    FROM service_types WHERE company_id = ? ORDER BY service_group ASC, name_ar ASC
  `).bind(company_id).all()
  return c.json({ success: true, data: results })
})

// POST /gl/service-types
postingSetup.post('/service-types', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    code: string; name_ar: string; name_en?: string; service_group: string
    default_expense_account_code?: string; default_ap_account_code?: string
    requires_supplier?: number; requires_document?: number; requires_center?: number
  }>()

  if (!b.code || !b.name_ar || !b.service_group) {
    return c.json({ success: false, error: 'code و name_ar و service_group مطلوبة' }, 400)
  }
  if (!(SERVICE_GROUPS as readonly string[]).includes(b.service_group)) {
    return c.json({ success: false, error: `service_group غير صحيح` }, 400)
  }

  const result = await c.env.DB.prepare(`
    INSERT INTO service_types (company_id, code, name_ar, name_en, service_group,
      default_expense_account_code, default_ap_account_code,
      requires_supplier, requires_document, requires_center, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).bind(
    company_id, b.code.toUpperCase(), b.name_ar, b.name_en ?? null, b.service_group,
    b.default_expense_account_code ?? null, b.default_ap_account_code ?? null,
    b.requires_supplier ?? 0, b.requires_document ?? 0, b.requires_center ?? 0,
  ).run()

  const newId = Number(result.meta.last_row_id)
  await logAudit(c.env.DB, { user_id: userId, company_id, action: 'CREATE', table_name: 'service_types', record_id: newId, new_value: b })
  clearPostingEngineCaches()
  return c.json({ success: true, data: { id: newId } }, 201)
})

// PATCH /gl/service-types/:id
postingSetup.patch('/service-types/:id', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const b  = await c.req.json<Record<string, unknown>>()

  const allowed = ['name_ar', 'name_en', 'service_group', 'default_expense_account_code', 'default_ap_account_code', 'requires_supplier', 'requires_document', 'requires_center', 'is_active']
  const sets: string[] = []; const binds: unknown[] = []
  for (const k of allowed) {
    if (k in b) { sets.push(`${k} = ?`); binds.push(b[k]) }
  }
  if (sets.length === 0) return c.json({ success: false, error: 'لا توجد حقول للتحديث' }, 400)

  sets.push(`updated_at = datetime('now')`)
  binds.push(company_id, id)

  await c.env.DB.prepare(
    `UPDATE service_types SET ${sets.join(', ')} WHERE company_id = ? AND id = ?`
  ).bind(...binds).run()

  await logAudit(c.env.DB, { user_id: userId, company_id, action: 'UPDATE', table_name: 'service_types', record_id: id, new_value: b })
  clearPostingEngineCaches()
  return c.json({ success: true })
})

// GET /gl/supplier-service-map
postingSetup.get('/supplier-service-map', async (c) => {
  const { company_id } = getUser(c)
  const tableExists = await c.env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='supplier_service_map' LIMIT 1`
  ).first<{ name: string }>()
  if (!tableExists) return c.json({ success: true, data: [] })

  const { results } = await c.env.DB.prepare(`
    SELECT ssm.id, ssm.supplier_code, s.name AS supplier_name,
           ssm.service_type_code, ssm.default_ap_account_code,
           ssm.default_expense_account_code, ssm.is_primary, ssm.is_active
    FROM supplier_service_map ssm
    LEFT JOIN suppliers s ON s.code = ssm.supplier_code AND s.company_id = ssm.company_id
    WHERE ssm.company_id = ? ORDER BY ssm.supplier_code ASC, ssm.is_primary DESC
  `).bind(company_id).all()
  return c.json({ success: true, data: results })
})

// POST /gl/supplier-service-map
postingSetup.post('/supplier-service-map', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    supplier_code: number; service_type_code: string
    default_ap_account_code?: string; default_expense_account_code?: string; is_primary?: number
  }>()

  if (!b.supplier_code || !b.service_type_code) {
    return c.json({ success: false, error: 'supplier_code و service_type_code مطلوبان' }, 400)
  }

  const result = await c.env.DB.prepare(`
    INSERT OR REPLACE INTO supplier_service_map
      (company_id, supplier_code, service_type_code, default_ap_account_code, default_expense_account_code, is_primary, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).bind(
    company_id, b.supplier_code, b.service_type_code.toUpperCase(),
    b.default_ap_account_code ?? null, b.default_expense_account_code ?? null, b.is_primary ?? 0,
  ).run()

  await logAudit(c.env.DB, { user_id: userId, company_id, action: 'CREATE', table_name: 'supplier_service_map', record_id: Number(result.meta.last_row_id), new_value: b })
  clearPostingEngineCaches()
  return c.json({ success: true }, 201)
})

// DELETE /gl/supplier-service-map/:id
postingSetup.delete('/supplier-service-map/:id', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))

  await c.env.DB.prepare(
    `UPDATE supplier_service_map SET is_active = 0 WHERE company_id = ? AND id = ?`
  ).bind(company_id, id).run()

  await logAudit(c.env.DB, { user_id: userId, company_id, action: 'DELETE', table_name: 'supplier_service_map', record_id: id, new_value: { is_active: 0 } })
  clearPostingEngineCaches()
  return c.json({ success: true })
})

// =============================================================================
// CONTROL ACCOUNT MAPPINGS  (mapping_key → account_code)
// =============================================================================

const KNOWN_CONTROL_KEYS = [
  'accounts_payable', 'accounts_receivable', 'accumulated_depreciation',
  'cash', 'cost_of_goods', 'deferred_revenue', 'depreciation_expense',
  'equity', 'expense_default', 'inventory', 'partner_capital',
  'partner_current_account', 'revenue_crops', 'revenue_default',
  'wages_expense', 'wages_payable', 'wip_asset', 'wip_contra',
] as const

// GET /gl/control-accounts
postingSetup.get('/control-accounts', async (c) => {
  const { company_id } = getUser(c)

  const { results } = await c.env.DB.prepare(`
    SELECT id, mapping_key, account_code, is_active, updated_at
    FROM posting_rules
    WHERE company_id = ? AND rule_type = 'control'
    ORDER BY mapping_key ASC
  `).bind(company_id).all<{
    id: number; mapping_key: string; account_code: string | null
    is_active: number; updated_at: string
  }>()

  const seeded: Record<string, { id: number; account_code: string | null; is_active: number; updated_at: string }> = {}
  for (const r of results) seeded[r.mapping_key] = r

  const data = KNOWN_CONTROL_KEYS.map(key => ({
    mapping_key:  key,
    id:           seeded[key]?.id ?? null,
    account_code: seeded[key]?.account_code ?? null,
    is_active:    seeded[key]?.is_active ?? 0,
    updated_at:   seeded[key]?.updated_at ?? null,
    seeded:       key in seeded,
  }))

  return c.json({ success: true, data })
})

// POST /gl/control-accounts — upsert mapping_key → account_code
postingSetup.post('/control-accounts', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const body = await c.req.json<{ mapping_key: string; account_code: string }>()

  if (!body.mapping_key || !body.account_code) {
    return c.json({ success: false, error: 'mapping_key و account_code مطلوبان' }, 400)
  }
  if (!(KNOWN_CONTROL_KEYS as readonly string[]).includes(body.mapping_key)) {
    return c.json({ success: false, error: `mapping_key غير معروف: ${body.mapping_key}` }, 400)
  }

  const acct = await c.env.DB.prepare(
    `SELECT code FROM chart_of_accounts WHERE company_id = ? AND code = ? AND is_active = 1 LIMIT 1`
  ).bind(company_id, body.account_code).first<{ code: string }>()
  if (!acct) return c.json({ success: false, error: `الحساب ${body.account_code} غير موجود أو غير نشط` }, 422)

  const existing = await c.env.DB.prepare(
    `SELECT id FROM posting_rules WHERE company_id = ? AND rule_type = 'control' AND mapping_key = ? LIMIT 1`
  ).bind(company_id, body.mapping_key).first<{ id: number }>()

  if (existing) {
    await c.env.DB.prepare(`
      UPDATE posting_rules SET account_code = ?, is_active = 1, updated_at = datetime('now') WHERE id = ?
    `).bind(body.account_code, existing.id).run()
    await logAudit(c.env.DB, { user_id: userId, company_id, action: 'UPDATE', table_name: 'posting_rules', record_id: existing.id, new_value: { mapping_key: body.mapping_key, account_code: body.account_code } })
    clearPostingEngineCaches()
    return c.json({ success: true, data: { id: existing.id, mapping_key: body.mapping_key, account_code: body.account_code } })
  }

  const result = await c.env.DB.prepare(`
    INSERT INTO posting_rules (company_id, rule_type, mapping_key, account_code, is_active, priority)
    VALUES (?, 'control', ?, ?, 1, 100)
  `).bind(company_id, body.mapping_key, body.account_code).run()

  const newId = Number(result.meta.last_row_id)
  await logAudit(c.env.DB, { user_id: userId, company_id, action: 'CREATE', table_name: 'posting_rules', record_id: newId, new_value: { mapping_key: body.mapping_key, account_code: body.account_code } })
  clearPostingEngineCaches()
  return c.json({ success: true, data: { id: newId, mapping_key: body.mapping_key, account_code: body.account_code } }, 201)
})

// DELETE /gl/control-accounts/:key — soft deactivate
postingSetup.delete('/control-accounts/:key', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const key = c.req.param('key')

  const existing = await c.env.DB.prepare(
    `SELECT id FROM posting_rules WHERE company_id = ? AND rule_type = 'control' AND mapping_key = ? LIMIT 1`
  ).bind(company_id, key).first<{ id: number }>()

  if (!existing) return c.json({ success: false, error: 'الربط غير موجود' }, 404)

  await c.env.DB.prepare(
    `UPDATE posting_rules SET is_active = 0, updated_at = datetime('now') WHERE id = ?`
  ).bind(existing.id).run()

  await logAudit(c.env.DB, { user_id: userId, company_id, action: 'DELETE', table_name: 'posting_rules', record_id: existing.id, new_value: { mapping_key: key, is_active: 0 } })
  clearPostingEngineCaches()
  return c.json({ success: true })
})

export default postingSetup
