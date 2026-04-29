import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'
import { logAudit } from '../../lib/audit'
import {
  resolveInventoryMovement as peResolveInventory,
  resolveSupplierInvoice   as peResolveSupplierInvoice,
  resolveSupplierPayment   as peResolveSupplierPayment,
  resolveExpensePosting    as peResolveExpense,
  resolveSalesRevenue      as peResolveSalesRevenue,
  clearPostingEngineCaches,
} from '../../lib/posting_engine'

const postingSetup = new Hono<{ Bindings: Env }>()
postingSetup.use('*', authMiddleware)
postingSetup.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

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
              inventory_account,
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
  }>()

  const bpg = body.bus_posting_group_code?.toUpperCase() ?? null
  const ppg = body.prod_posting_group_code?.toUpperCase() ?? null

  const exists = await c.env.DB
    .prepare(`SELECT 1 FROM posting_rules WHERE company_id = ? AND rule_type = 'general'
              AND (bus_posting_group_code IS ? OR (bus_posting_group_code IS NULL AND ? IS NULL))
              AND (prod_posting_group_code IS ? OR (prod_posting_group_code IS NULL AND ? IS NULL)) LIMIT 1`)
    .bind(company_id, bpg, bpg, ppg, ppg).first()
  if (exists) return c.json({ success: false, error: `A setup row for BPG="${bpg ?? 'DEFAULT'}" × PPG="${ppg ?? 'DEFAULT'}" already exists.` }, 409)

  const { meta } = await c.env.DB
    .prepare(`INSERT INTO posting_rules
              (company_id, rule_type, bus_posting_group_code, prod_posting_group_code,
               sales_account, purchases_account, cogs_account,
               sales_returns_account, purch_returns_account, expense_account,
               priority, is_active, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,100,1,datetime('now'),datetime('now'))`)
    .bind(company_id, 'general', bpg, ppg,
          body.sales_account ?? null, body.purchases_account ?? null, body.cogs_account ?? null,
          body.sales_returns_account ?? null, body.purch_returns_account ?? null, body.expense_account ?? null)
    .run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'CREATE', table_name: 'posting_rules', new_value: { rule_type: 'general', bpg, ppg } })
  clearPostingEngineCaches()
  return c.json({ success: true, data: { id: meta.last_row_id } }, 201)
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
    expense_account?: string | null; is_active?: boolean
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

  await c.env.DB
    .prepare(`UPDATE posting_rules SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ? AND company_id = ? AND rule_type = 'general'`)
    .bind(...vals).run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'UPDATE', table_name: 'posting_rules', new_value: { id: rowId, rule_type: 'general', ...body } })
  clearPostingEngineCaches()
  return c.json({ success: true })
})

// =============================================================================
// INVENTORY POSTING SETUP
// =============================================================================

// GET /api/gl/posting-setup/inventory
postingSetup.get('/posting-setup/inventory', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare(`SELECT id, inv_posting_group_code, prod_posting_group_code, inventory_account, is_active
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
  }>()

  const ipg = body.inv_posting_group_code?.toUpperCase() ?? null
  const ppg = body.prod_posting_group_code?.toUpperCase() ?? null

  const exists = await c.env.DB
    .prepare(`SELECT 1 FROM posting_rules WHERE company_id = ? AND rule_type = 'inventory'
              AND (inv_posting_group_code IS ? OR (inv_posting_group_code IS NULL AND ? IS NULL))
              AND (prod_posting_group_code IS ? OR (prod_posting_group_code IS NULL AND ? IS NULL)) LIMIT 1`)
    .bind(company_id, ipg, ipg, ppg, ppg).first()
  if (exists) return c.json({ success: false, error: `A setup row for IPG="${ipg ?? 'DEFAULT'}" × PPG="${ppg ?? 'DEFAULT'}" already exists.` }, 409)

  const { meta } = await c.env.DB
    .prepare(`INSERT INTO posting_rules
              (company_id, rule_type, inv_posting_group_code, prod_posting_group_code, inventory_account, priority, is_active, created_at, updated_at)
              VALUES (?,?,?,?,?,100,1,datetime('now'),datetime('now'))`)
    .bind(company_id, 'inventory', ipg, ppg, body.inventory_account ?? null)
    .run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'CREATE', table_name: 'posting_rules', new_value: { rule_type: 'inventory', ipg, ppg } })
  clearPostingEngineCaches()
  return c.json({ success: true, data: { id: meta.last_row_id } }, 201)
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

  const body = await c.req.json<{ inventory_account?: string | null; is_active?: boolean }>()
  const sets: string[] = []
  const vals: unknown[] = []
  if ('inventory_account' in body) { sets.push('inventory_account = ?'); vals.push(body.inventory_account ?? null) }
  if (body.is_active !== undefined) { sets.push('is_active = ?');        vals.push(body.is_active ? 1 : 0) }
  if (!sets.length) return c.json({ success: false, error: 'Nothing to update' }, 422)
  vals.push(rowId, company_id)

  await c.env.DB
    .prepare(`UPDATE posting_rules SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ? AND company_id = ? AND rule_type = 'inventory'`)
    .bind(...vals).run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'UPDATE', table_name: 'posting_rules', new_value: { id: rowId, rule_type: 'inventory', ...body } })
  clearPostingEngineCaches()
  return c.json({ success: true })
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
    type: 'inventory_in' | 'inventory_out' | 'supplier_invoice' | 'supplier_payment' | 'expense' | 'revenue'
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
      blueprint = await peResolveInventory(c.env.DB, company_id, body.ipg_code ?? null, body.ppg_code ?? null, amt, body.type === 'inventory_in')
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
      return c.json({ success: false, error: 'Invalid type. Use: inventory_in | inventory_out | supplier_invoice | supplier_payment | expense | revenue' }, 422)
  }

  return c.json({ success: true, data: blueprint })
})

export default postingSetup
