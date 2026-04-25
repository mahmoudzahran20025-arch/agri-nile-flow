import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'

const reports = new Hono<{ Bindings: Env }>()
reports.use('*', authMiddleware)

// ─────────────────────────────────────────────────────────────────
// GET /api/reports/cost-centers?season_id=1
//
// Returns per-cost-center aggregated spend from:
//   1. cash_transactions   (direction=OUT, has center_code)
//   2. supplier_transactions (credit side, has center_code)
// ─────────────────────────────────────────────────────────────────
reports.get('/cost-centers', async (c) => {
  const { company_id } = getUser(c)
  const rawSeason = c.req.query('season_id')
  const seasonId  = rawSeason ? Number(rawSeason) : null

  // Use parameterized query to prevent SQL injection
  const seasonWhere    = seasonId ? 'AND season_id = ?' : ''
  const cashBinds: unknown[] = seasonId ? [company_id, seasonId] : [company_id]
  const supBinds:  unknown[] = seasonId ? [company_id, seasonId] : [company_id]
  // Inventory: filter by field's season_id when seasonId provided
  const invSeasonWhere = seasonId ? 'AND f.season_id = ?' : ''
  const invBinds: unknown[] = seasonId ? [company_id, seasonId] : [company_id]

  // Cash transactions per center
  const cashQ = c.env.DB.prepare(`
    SELECT
      ct.center_code,
      cc.name            AS center_name,
      SUM(ct.amount)     AS cash_total,
      COUNT(ct.id)       AS cash_count
    FROM cash_transactions ct
    LEFT JOIN cost_centers cc ON cc.code = ct.center_code AND cc.company_id = ct.company_id
    WHERE ct.company_id = ?
      AND ct.direction = 'م'
      AND ct.status = 'posted'
      AND ct.center_code IS NOT NULL
      ${seasonWhere}
    GROUP BY ct.center_code
  `).bind(...cashBinds).all<{
    center_code: number; center_name: string | null
    cash_total: number; cash_count: number
  }>()

  // Supplier transactions per center (credit = we owe them = expense)
  const supQ = c.env.DB.prepare(`
    SELECT
      st.center_code,
      cc.name            AS center_name,
      SUM(st.credit)     AS supplier_total,
      COUNT(st.id)       AS supplier_count
    FROM supplier_transactions st
    LEFT JOIN cost_centers cc ON cc.code = st.center_code AND cc.company_id = st.company_id
    WHERE st.company_id = ?
      AND st.status = 'posted'
      AND st.center_code IS NOT NULL
      ${seasonWhere}
    GROUP BY st.center_code
  `).bind(...supBinds).all<{
    center_code: number; center_name: string | null
    supplier_total: number; supplier_count: number
  }>()

  // Inventory consumption per center (صرف movements via fields.center_code)
  const invQ = c.env.DB.prepare(`
    SELECT
      f.center_code,
      cc.name            AS center_name,
      SUM(im.value_out)  AS inventory_total,
      COUNT(im.id)       AS inventory_count
    FROM inventory_movements im
    JOIN fields f ON f.id = im.field_id AND f.company_id = im.company_id
    LEFT JOIN cost_centers cc ON cc.code = f.center_code AND cc.company_id = f.company_id
    WHERE im.company_id = ?
      AND im.movement_type = 'صرف'
      AND f.center_code IS NOT NULL
      ${invSeasonWhere}
    GROUP BY f.center_code
  `).bind(...invBinds).all<{
    center_code: number; center_name: string | null
    inventory_total: number; inventory_count: number
  }>()

  const [cashRes, supRes, invRes] = await Promise.all([cashQ, supQ, invQ])

  // Merge by center_code
  const map = new Map<number, {
    center_code: number; center_name: string | null
    cash_total: number; cash_count: number
    supplier_total: number; supplier_count: number
    inventory_total: number; inventory_count: number
    grand_total: number
  }>()

  for (const r of cashRes.results) {
    map.set(r.center_code, {
      center_code:     r.center_code,
      center_name:     r.center_name,
      cash_total:      r.cash_total ?? 0,
      cash_count:      r.cash_count ?? 0,
      supplier_total:  0,
      supplier_count:  0,
      inventory_total: 0,
      inventory_count: 0,
      grand_total:     r.cash_total ?? 0,
    })
  }

  for (const r of supRes.results) {
    const existing = map.get(r.center_code)
    if (existing) {
      existing.supplier_total  = r.supplier_total ?? 0
      existing.supplier_count  = r.supplier_count ?? 0
      existing.grand_total    += r.supplier_total ?? 0
    } else {
      map.set(r.center_code, {
        center_code:     r.center_code,
        center_name:     r.center_name,
        cash_total:      0,
        cash_count:      0,
        supplier_total:  r.supplier_total ?? 0,
        supplier_count:  r.supplier_count ?? 0,
        inventory_total: 0,
        inventory_count: 0,
        grand_total:     r.supplier_total ?? 0,
      })
    }
  }

  for (const r of invRes.results) {
    const existing = map.get(r.center_code)
    if (existing) {
      existing.inventory_total  = r.inventory_total ?? 0
      existing.inventory_count  = r.inventory_count ?? 0
      existing.grand_total     += r.inventory_total ?? 0
    } else {
      map.set(r.center_code, {
        center_code:     r.center_code,
        center_name:     r.center_name,
        cash_total:      0,
        cash_count:      0,
        supplier_total:  0,
        supplier_count:  0,
        inventory_total: r.inventory_total ?? 0,
        inventory_count: r.inventory_count ?? 0,
        grand_total:     r.inventory_total ?? 0,
      })
    }
  }

  const rows = [...map.values()].sort((a, b) => b.grand_total - a.grand_total)
  const grandTotal = rows.reduce((s, r) => s + r.grand_total, 0)

  return c.json({ success: true, data: rows, grand_total: grandTotal })
})

// ─────────────────────────────────────────────────────────────────
// GET /api/reports/cost-centers/:code/detail?season_id=1
//
// Drilldown: expense breakdown for a single cost center
//   - by expense_category from cash_transactions
//   - by supplier from supplier_transactions
// ─────────────────────────────────────────────────────────────────
reports.get('/cost-centers/:code/detail', async (c) => {
  const { company_id } = getUser(c)
  const code     = Number(c.req.param('code'))
  const seasonId = c.req.query('season_id') ? Number(c.req.query('season_id')) : null

  const seasonBind  = seasonId ? [company_id, code, seasonId] : [company_id, code]
  const seasonWhere = seasonId ? 'AND season_id = ?' : ''

  const [cashByCategory, supBySupplier, cashTimeline] = await Promise.all([
    // Cash: breakdown by expense type
    c.env.DB.prepare(`
      SELECT
        COALESCE(ct.expense_code, 0)       AS expense_code,
        COALESCE(et.name, 'أخرى')         AS expense_name,
        SUM(ct.amount)                     AS total,
        COUNT(ct.id)                       AS cnt
      FROM cash_transactions ct
      LEFT JOIN expense_types et ON et.code = ct.expense_code AND et.company_id = ct.company_id
      WHERE ct.company_id = ? AND ct.center_code = ? AND ct.direction = 'م' AND ct.status = 'posted'
        ${seasonWhere}
      GROUP BY expense_code
      ORDER BY total DESC
    `).bind(...seasonBind).all(),

    // Supplier: breakdown by supplier
    c.env.DB.prepare(`
      SELECT
        st.supplier_code,
        COALESCE(s.name, CAST(st.supplier_code AS TEXT)) AS supplier_name,
        SUM(st.credit)  AS total,
        COUNT(st.id)    AS cnt
      FROM supplier_transactions st
      LEFT JOIN suppliers s ON s.code = st.supplier_code AND s.company_id = st.company_id
      WHERE st.company_id = ? AND st.center_code = ? AND st.status = 'posted'
        ${seasonWhere}
      GROUP BY st.supplier_code
      ORDER BY total DESC
    `).bind(...seasonBind).all(),

    // Cash: monthly timeline
    c.env.DB.prepare(`
      SELECT year, month, SUM(amount) AS total
      FROM cash_transactions
      WHERE company_id = ? AND center_code = ? AND direction = 'م' AND status = 'posted'
        ${seasonWhere}
      GROUP BY year, month
      ORDER BY year, month
    `).bind(...seasonBind).all(),
  ])

  return c.json({
    success: true,
    data: {
      cash_by_category:  cashByCategory.results,
      sup_by_supplier:   supBySupplier.results,
      cash_timeline:     cashTimeline.results,
    },
  })
})

// ─────────────────────────────────────────────────────────────────
// GET /api/reports/supplier-payments?supplier_code=&season_id=
//
// All payments to a supplier: supplier_transactions (debit=payments received)
//   + treasury payments linked to supplier
// ─────────────────────────────────────────────────────────────────
reports.get('/supplier-payments', async (c) => {
  const { company_id } = getUser(c)
  const supplierCode = c.req.query('supplier_code') ? Number(c.req.query('supplier_code')) : null
  const seasonId     = c.req.query('season_id')     ? Number(c.req.query('season_id'))     : null

  let where = 'WHERE st.company_id = ?'
  const binds: unknown[] = [company_id]

  if (supplierCode) { where += ' AND st.supplier_code = ?'; binds.push(supplierCode) }
  if (seasonId)     { where += ' AND st.season_id = ?';    binds.push(seasonId) }
  where += " AND st.status = 'posted'"

  const [statements, summary] = await Promise.all([
    c.env.DB.prepare(`
      SELECT
        st.id, st.transaction_date, st.document_type, st.document_number,
        st.expense_category, st.equipment, st.unit, st.quantity, st.unit_price,
        st.amount, st.credit, st.debit, st.check_amount,
        st.balance_no_checks, st.balance_with_checks,
        st.due_date, st.check_clearance_date,
        st.year, st.month, st.notes,
        st.center_code, cc.name AS center_name,
        s.name AS supplier_name
      FROM supplier_transactions st
      LEFT JOIN cost_centers cc ON cc.code = st.center_code AND cc.company_id = st.company_id
      LEFT JOIN suppliers s     ON s.code  = st.supplier_code AND s.company_id = st.company_id
      ${where}
      ORDER BY st.transaction_date ASC, st.id ASC
    `).bind(...binds).all(),

    c.env.DB.prepare(`
      SELECT
        st.supplier_code,
        s.name AS supplier_name,
        SUM(st.credit) AS total_credit,
        SUM(st.debit)  AS total_debit,
        SUM(st.credit) - SUM(st.debit) AS balance
      FROM supplier_transactions st
      LEFT JOIN suppliers s ON s.code = st.supplier_code AND s.company_id = st.company_id
      ${where}
      GROUP BY st.supplier_code
    `).bind(...binds).all(),
  ])

  return c.json({
    success: true,
    data:    statements.results,
    summary: summary.results,
  })
})

// ─────────────────────────────────────────────────────────────────
// GET /api/reports/suppliers-balance?season_id=
//
// Summary balance table for all suppliers
// ─────────────────────────────────────────────────────────────────
reports.get('/suppliers-balance', async (c) => {
  const { company_id } = getUser(c)
  const seasonId = c.req.query('season_id') ? Number(c.req.query('season_id')) : null

  const seasonWhere  = seasonId ? 'AND st.season_id = ?' : ''
  // SQL param order: seasonId (in JOIN ON clause) then company_id (in WHERE)
  const queryBinds: unknown[] = seasonId ? [seasonId, company_id] : [company_id]

  const { results } = await c.env.DB.prepare(`
    SELECT
      s.code,
      s.name,
      s.activity,
      COALESCE(SUM(st.credit), 0)              AS total_credit,
      COALESCE(SUM(st.debit),  0)              AS total_debit,
      COALESCE(SUM(st.credit) - SUM(st.debit), 0) AS balance,
      COALESCE(MAX(st.balance_with_checks), 0) AS last_balance,
      COUNT(st.id)                             AS tx_count
    FROM suppliers s
    LEFT JOIN supplier_transactions st
      ON st.supplier_code = s.code AND st.company_id = s.company_id AND st.status = 'posted'
      ${seasonWhere}
    WHERE s.company_id = ?
    GROUP BY s.code
    ORDER BY ABS(balance) DESC
  `).bind(...queryBinds).all()

  return c.json({ success: true, data: results })
})

// ─────────────────────────────────────────────────────────────────
// GET /api/reports/season-summary?season_id=1
//
// Complete season P&L: cash + supplier + inventory consumed
// Grouped by: cost_center, expense_type, supplier, item
// ─────────────────────────────────────────────────────────────────
reports.get('/season-summary', async (c) => {
  const { company_id } = getUser(c)
  const seasonId = c.req.query('season_id') ? Number(c.req.query('season_id')) : null

  // Season details
  const season = seasonId
    ? await c.env.DB.prepare(
        'SELECT id, name, season_type, start_date, end_date, status FROM seasons WHERE id = ? AND company_id = ?'
      ).bind(seasonId, company_id).first()
    : null

  const seasonWhere = seasonId ? 'AND season_id = ?' : ''
  const cashBinds:  unknown[] = seasonId ? [company_id, seasonId] : [company_id]
  const supBinds:   unknown[] = seasonId ? [company_id, seasonId] : [company_id]
  const invBinds:   unknown[] = seasonId ? [company_id, seasonId] : [company_id]

  const [
    byCostCenter,
    byExpenseType,
    bySupplier,
    byInventoryItem,
    cashTotal,
    supplierTotal,
    inventoryConsumed,
    monthlyTimeline,
  ] = await Promise.all([

    // By cost center: cash OUT + supplier credit
    c.env.DB.prepare(`
      SELECT
        cc.code                        AS center_code,
        cc.name                        AS center_name,
        COALESCE(cash.cash_total, 0)   AS cash_total,
        COALESCE(sup.sup_total, 0)     AS supplier_total,
        COALESCE(inv.inv_total, 0)     AS inventory_total,
        COALESCE(cash.cash_total, 0) + COALESCE(sup.sup_total, 0) + COALESCE(inv.inv_total, 0) AS grand_total
      FROM cost_centers cc
      LEFT JOIN (
        SELECT center_code, SUM(amount) AS cash_total
        FROM cash_transactions
        WHERE company_id = ? AND direction = 'م' AND status = 'posted' AND center_code IS NOT NULL ${seasonWhere}
        GROUP BY center_code
      ) cash ON cash.center_code = cc.code
      LEFT JOIN (
        SELECT center_code, SUM(credit) AS sup_total
        FROM supplier_transactions
        WHERE company_id = ? AND status = 'posted' AND center_code IS NOT NULL ${seasonWhere}
        GROUP BY center_code
      ) sup ON sup.center_code = cc.code
      LEFT JOIN (
        SELECT center_code, SUM(value_out) AS inv_total
        FROM inventory_movements
        WHERE company_id = ? AND movement_type = 'صرف' AND center_code IS NOT NULL ${seasonWhere}
        GROUP BY center_code
      ) inv ON inv.center_code = cc.code
      WHERE cc.company_id = ?
        AND (cash.cash_total IS NOT NULL OR sup.sup_total IS NOT NULL OR inv.inv_total IS NOT NULL)
      ORDER BY grand_total DESC
    `).bind(...cashBinds, ...supBinds, ...invBinds, company_id).all<{
      center_code: number; center_name: string
      cash_total: number; supplier_total: number; inventory_total: number; grand_total: number
    }>(),

    // By expense type (cash only)
    c.env.DB.prepare(`
      SELECT
        COALESCE(ct.expense_code, 0)         AS expense_code,
        COALESCE(et.name, 'أخرى')           AS expense_name,
        SUM(ct.amount)                       AS total,
        COUNT(ct.id)                         AS cnt
      FROM cash_transactions ct
      LEFT JOIN expense_types et ON et.code = ct.expense_code AND et.company_id = ct.company_id
      WHERE ct.company_id = ? AND ct.direction = 'م' AND ct.status = 'posted' ${seasonWhere}
      GROUP BY ct.expense_code
      ORDER BY total DESC
    `).bind(...cashBinds).all<{
      expense_code: number; expense_name: string; total: number; cnt: number
    }>(),

    // By supplier (credit side)
    c.env.DB.prepare(`
      SELECT
        s.code                                 AS supplier_code,
        s.name                                 AS supplier_name,
        s.activity,
        COALESCE(SUM(st.credit), 0)            AS total_credit,
        COALESCE(SUM(st.debit),  0)            AS total_debit,
        COALESCE(SUM(st.credit)-SUM(st.debit), 0) AS balance,
        COUNT(st.id)                           AS tx_count
      FROM suppliers s
      LEFT JOIN supplier_transactions st
        ON st.supplier_code = s.code AND st.company_id = s.company_id AND st.status = 'posted'
        ${seasonWhere ? 'AND ' + seasonWhere.slice(4) : ''}
      WHERE s.company_id = ?
      GROUP BY s.code
      HAVING total_credit > 0 OR total_debit > 0
      ORDER BY total_credit DESC
    `).bind(...(seasonId ? [seasonId, company_id] : [company_id])).all<{
      supplier_code: number; supplier_name: string; activity: string | null
      total_credit: number; total_debit: number; balance: number; tx_count: number
    }>(),

    // By inventory item consumed (صرف)
    c.env.DB.prepare(`
      SELECT
        im.item_code,
        COALESCE(i.name, CAST(im.item_code AS TEXT)) AS item_name,
        i.unit,
        SUM(im.qty_out)    AS total_qty_out,
        SUM(im.value_out)  AS total_value_out
      FROM inventory_movements im
      LEFT JOIN items i ON i.code = im.item_code AND i.company_id = im.company_id
      WHERE im.company_id = ? AND im.movement_type = 'صرف' ${seasonWhere}
      GROUP BY im.item_code
      ORDER BY total_value_out DESC
    `).bind(...invBinds).all<{
      item_code: number; item_name: string; unit: string | null
      total_qty_out: number; total_value_out: number
    }>(),

    // Cash total
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM cash_transactions WHERE company_id = ? AND direction = 'م' AND status = 'posted' ${seasonWhere}
    `).bind(...cashBinds).first<{ total: number }>(),

    // Supplier total credit
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(credit), 0) AS credit, COALESCE(SUM(debit), 0) AS debit
      FROM supplier_transactions WHERE company_id = ? AND status = 'posted' ${seasonWhere}
    `).bind(...supBinds).first<{ credit: number; debit: number }>(),

    // Inventory consumed value
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(value_out), 0) AS total
      FROM inventory_movements WHERE company_id = ? AND movement_type = 'صرف' ${seasonWhere}
    `).bind(...invBinds).first<{ total: number }>(),

    // Monthly cash + supplier timeline
    c.env.DB.prepare(`
      SELECT year, month,
        SUM(CASE WHEN src='cash' THEN amount ELSE 0 END) AS cash_out,
        SUM(CASE WHEN src='sup'  THEN amount ELSE 0 END) AS supplier_credit
      FROM (
        SELECT year, month, amount, 'cash' AS src
        FROM cash_transactions WHERE company_id = ? AND direction = 'م' AND status = 'posted' ${seasonWhere}
        UNION ALL
        SELECT year, month, credit AS amount, 'sup' AS src
        FROM supplier_transactions WHERE company_id = ? AND status = 'posted' ${seasonWhere}
      )
      GROUP BY year, month
      ORDER BY year, month
    `).bind(...cashBinds, ...supBinds).all<{
      year: number; month: number; cash_out: number; supplier_credit: number
    }>(),
  ])

  const cashSum     = cashTotal?.total ?? 0
  const supCredit   = supplierTotal?.credit ?? 0
  const supDebit    = supplierTotal?.debit ?? 0
  const invConsumed = inventoryConsumed?.total ?? 0
  const grandTotal  = cashSum + supCredit + invConsumed

  return c.json({
    success: true,
    data: {
      season,
      by_cost_center:     byCostCenter.results,
      by_expense_type:    byExpenseType.results,
      by_supplier:        bySupplier.results,
      by_inventory_item:  byInventoryItem.results,
      monthly_timeline:   monthlyTimeline.results,
      totals: {
        cash_out:          cashSum,
        supplier_credit:   supCredit,
        supplier_debit:    supDebit,
        inventory_consumed: invConsumed,
        grand_total:       grandTotal,
      },
    },
  })
})

// ─────────────────────────────────────────────────────────────────
// GET /api/reports/season-pnl?season_id=1
//
// Full P&L: Revenue (sales contracts) vs Costs (inventory + labor + cash + supplier)
// Returns totals + per-field breakdown
// ─────────────────────────────────────────────────────────────────
reports.get('/season-pnl', async (c) => {
  const { company_id } = getUser(c)
  const seasonId = c.req.query('season_id') ? Number(c.req.query('season_id')) : null

  if (!seasonId) {
    return c.json({ success: false, error: 'season_id مطلوب' }, 400)
  }

  const [
    season,
    revenueRow,
    invCostRow,
    laborCostRow,
    cashCostRow,
    supCostRow,
    rentCostRow,
    payrollCostRow,
    areaRow,
    byField,
  ] = await Promise.all([

    // Season info
    c.env.DB.prepare(
      'SELECT id, name, season_type, start_date, end_date, status FROM seasons WHERE id = ? AND company_id = ?'
    ).bind(seasonId, company_id).first<{
      id: number; name: string; season_type: string
      start_date: string; end_date: string; status: string
    }>(),

    // Revenue — sales contracts (quantity_ton * unit_price)
    // Excludes cancelled/draft contracts — only active, partial, and completed count as revenue
    c.env.DB.prepare(`
      SELECT
        COUNT(*)                              AS contracts_count,
        COALESCE(SUM(quantity_ton * unit_price), 0) AS contracts_value,
        COALESCE(SUM(advance_paid), 0)        AS advance_collected
      FROM sales_contracts
      WHERE company_id = ? AND season_id = ?
        AND status NOT IN ('cancelled', 'draft')
    `).bind(company_id, seasonId).first<{
      contracts_count: number; contracts_value: number; advance_collected: number
    }>(),

    // Cost 1: Inventory consumed (صرف) linked to season
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(value_out), 0) AS total
      FROM inventory_movements
      WHERE company_id = ? AND season_id = ? AND movement_type = 'صرف'
    `).bind(company_id, seasonId).first<{ total: number }>(),

    // Cost 2: Labor — work tasks linked to work orders in this season
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(wt.quantity * wt.unit_cost), 0) AS total
      FROM work_tasks wt
      JOIN work_orders wo ON wo.id = wt.work_order_id AND wo.company_id = wt.company_id
      WHERE wo.company_id = ? AND wo.season_id = ?
    `).bind(company_id, seasonId).first<{ total: number }>(),

    // Cost 3: Cash out (direct expenses) - EXCLUDING inventory purchases to avoid double counting
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(ct.amount), 0) AS total
      FROM cash_transactions ct
      LEFT JOIN gl_account_mappings gm ON gm.mapping_key = 'inventory' AND gm.company_id = ct.company_id
      WHERE ct.company_id = ? AND ct.season_id = ? AND ct.direction = 'م' AND ct.status = 'posted'
        AND (ct.supplier_code IS NULL) -- If it has a supplier, it's likely a credit/PO payment already in sub-ledger
    `).bind(company_id, seasonId).first<{ total: number }>(),

    // Cost 4: Supplier transactions - ONLY non-inventory expenses to avoid double counting
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(credit), 0) AS total
      FROM supplier_transactions
      WHERE company_id = ? AND season_id = ? AND status = 'posted'
        AND document_type NOT IN ('purchase_order', 'inventory_receive')
    `).bind(company_id, seasonId).first<{ total: number }>(),

    // Cost 5: Land rent — rent_per_feddan × area_feddan for each field in this season
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(rent_per_feddan * area_feddan), 0) AS total
      FROM fields
      WHERE company_id = ? AND season_id = ? AND rent_per_feddan > 0
    `).bind(company_id, seasonId).first<{ total: number }>(),

    // Cost 6: Payroll — approved/paid runs attributed to this season
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(total_net), 0) AS total
      FROM payroll_runs
      WHERE company_id = ? AND season_id = ? AND status IN ('approved', 'paid')
    `).bind(company_id, seasonId).first<{ total: number }>(),

    // Total area for season
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(area_feddan), 0) AS total
      FROM fields WHERE company_id = ? AND season_id = ?
    `).bind(company_id, seasonId).first<{ total: number }>(),

    // Per-field P&L breakdown
    c.env.DB.prepare(`
      SELECT
        f.id, f.code, f.name AS field_name, f.area_feddan, f.crop_type,
        COALESCE(SUM(sc.quantity_ton * sc.unit_price), 0) AS field_revenue,
        COALESCE(inv.inv_cost, 0)                        AS inv_cost,
        COALESCE(lab.labor_cost, 0)                      AS labor_cost,
        COALESCE(inv.inv_cost, 0) + COALESCE(lab.labor_cost, 0) AS field_cost,
        COALESCE(SUM(sc.quantity_ton * sc.unit_price), 0)
          - COALESCE(inv.inv_cost, 0)
          - COALESCE(lab.labor_cost, 0)                  AS field_margin,
        CASE WHEN f.area_feddan > 0
          THEN (COALESCE(SUM(sc.quantity_ton * sc.unit_price), 0)
                - COALESCE(inv.inv_cost, 0)
                - COALESCE(lab.labor_cost, 0)) / f.area_feddan
          ELSE NULL END                                  AS margin_per_feddan
      FROM fields f
      LEFT JOIN sales_contracts sc
             ON sc.field_id = f.id AND sc.company_id = f.company_id AND sc.season_id = ?
             AND sc.status NOT IN ('cancelled', 'draft')
      LEFT JOIN (
        SELECT field_id, SUM(value_out) AS inv_cost
        FROM inventory_movements
        WHERE company_id = ? AND season_id = ? AND movement_type = 'صرف'
          AND field_id IS NOT NULL
        GROUP BY field_id
      ) inv ON inv.field_id = f.id
      LEFT JOIN (
        SELECT wo.field_id, SUM(wt.quantity * wt.unit_cost) AS labor_cost
        FROM work_tasks wt
        JOIN work_orders wo ON wo.id = wt.work_order_id AND wo.company_id = wt.company_id
        WHERE wo.company_id = ? AND wo.season_id = ? AND wo.field_id IS NOT NULL
        GROUP BY wo.field_id
      ) lab ON lab.field_id = f.id
      WHERE f.company_id = ? AND f.season_id = ?
      GROUP BY f.id
      ORDER BY field_margin DESC
    `).bind(seasonId, company_id, seasonId, company_id, seasonId, company_id, seasonId).all<{
      id: number; code: string; field_name: string; area_feddan: number; crop_type: string | null
      field_revenue: number; inv_cost: number; labor_cost: number
      field_cost: number; field_margin: number; margin_per_feddan: number | null
    }>(),
  ])

  const revenue      = revenueRow?.contracts_value ?? 0
  const invCost      = invCostRow?.total ?? 0
  const laborCost    = laborCostRow?.total ?? 0
  const cashCost     = cashCostRow?.total ?? 0
  const supCost      = supCostRow?.total ?? 0
  const rentCost     = rentCostRow?.total ?? 0
  const payrollCost  = payrollCostRow?.total ?? 0
  const totalCosts   = invCost + laborCost + cashCost + supCost + rentCost + payrollCost
  const netMargin    = revenue - totalCosts
  const totalArea    = areaRow?.total ?? 0
  const marginPF     = totalArea > 0 ? netMargin / totalArea : null

  return c.json({
    success: true,
    data: {
      season,
      revenue: {
        contracts_value:    revenue,
        advance_collected:  revenueRow?.advance_collected ?? 0,
        contracts_count:    revenueRow?.contracts_count   ?? 0,
      },
      costs: {
        inventory:        invCost,
        labor:            laborCost,
        cash_out:         cashCost,
        supplier_credit:  supCost,
        land_rent:        rentCost,
        payroll:          payrollCost,
        total:            totalCosts,
      },
      net_margin:          netMargin,
      total_area:          totalArea,
      margin_per_feddan:   marginPF,
      margin_pct:          revenue > 0 ? Math.round((netMargin / revenue) * 1000) / 10 : null,
      by_field:            byField.results,
    },
  })
})

// ─────────────────────────────────────────────────────────────────
// GET /api/reports/season-readiness?season_id=1
//
// Pre-close readiness checklist: 3 blockers + 3 warnings.
// Each check is a self-contained COUNT query — all run in parallel.
// ─────────────────────────────────────────────────────────────────
reports.get('/season-readiness', async (c) => {
  const { company_id } = getUser(c)
  const seasonId = c.req.query('season_id') ? Number(c.req.query('season_id')) : null
  if (!seasonId) return c.json({ success: false, error: 'season_id مطلوب' }, 400)

  const [
    season,
    openWORow,
    draftPayrollRow,
    draftSupTxRow,
    uncostedHRow,
    fieldsNoHRow,
    activeConRow,
    totalFieldsRow,
    totalHarvestsRow,
  ] = await Promise.all([

    c.env.DB.prepare(
      'SELECT id, name, season_type, start_date, end_date, status FROM seasons WHERE id = ? AND company_id = ?'
    ).bind(seasonId, company_id).first<{
      id: number; name: string; season_type: string
      start_date: string; end_date: string; status: string
    }>(),

    // BLOCKER 1: work orders not yet costed or cancelled
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM work_orders WHERE company_id = ? AND season_id = ?
       AND status NOT IN ('costed','cancelled')`
    ).bind(company_id, seasonId).first<{ n: number }>(),

    // BLOCKER 2: draft payroll runs attributed to this season
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM payroll_runs WHERE company_id = ? AND season_id = ? AND status = 'draft'`
    ).bind(company_id, seasonId).first<{ n: number }>(),

    // BLOCKER 3: supplier transactions not yet posted for this season
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM supplier_transactions WHERE company_id = ? AND season_id = ? AND status != 'posted'`
    ).bind(company_id, seasonId).first<{ n: number }>(),

    // WARNING 1: harvest records with zero / null actual_cost
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM harvest_records WHERE company_id = ? AND season_id = ?
       AND (actual_cost IS NULL OR actual_cost = 0) AND qty_tons > 0`
    ).bind(company_id, seasonId).first<{ n: number }>(),

    // WARNING 2: fields in season with no harvest record at all
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM fields f
       WHERE f.company_id = ? AND f.season_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM harvest_records hr
           WHERE hr.field_id = f.id AND hr.company_id = f.company_id AND hr.season_id = f.season_id
         )`
    ).bind(company_id, seasonId).first<{ n: number }>(),

    // WARNING 3: sales contracts not yet completed
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM sales_contracts WHERE company_id = ? AND season_id = ?
       AND status IN ('draft','active','partial')`
    ).bind(company_id, seasonId).first<{ n: number }>(),

    // Context: total fields in season
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM fields WHERE company_id = ? AND season_id = ?`)
      .bind(company_id, seasonId).first<{ n: number }>(),

    // Context: total harvest records in season
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM harvest_records WHERE company_id = ? AND season_id = ?`)
      .bind(company_id, seasonId).first<{ n: number }>(),
  ])

  if (!season) return c.json({ success: false, error: 'الموسم غير موجود' }, 404)

  const totalFields   = totalFieldsRow?.n   ?? 0
  const totalHarvests = totalHarvestsRow?.n ?? 0

  const checks = [
    {
      key:         'open_work_orders',
      label:       'أوامر العمل المفتوحة',
      description: 'أوامر عمل لم تُكلَّف أو تُلغَ بعد لهذا الموسم',
      count:       openWORow?.n ?? 0,
      ok:          (openWORow?.n ?? 0) === 0,
      blocker:     true,
      action_url:  '/operations',
    },
    {
      key:         'draft_payroll',
      label:       'مسيرات رواتب مسودة',
      description: 'مسيرات مُسندة لهذا الموسم ولم تُعتمد أو تُدفع بعد',
      count:       draftPayrollRow?.n ?? 0,
      ok:          (draftPayrollRow?.n ?? 0) === 0,
      blocker:     true,
      action_url:  '/hr/payroll',
    },
    {
      key:         'draft_supplier_tx',
      label:       'معاملات موردين غير مُرحَّلة',
      description: 'فواتير أو حركات موردين بحالة مسودة مرتبطة بهذا الموسم',
      count:       draftSupTxRow?.n ?? 0,
      ok:          (draftSupTxRow?.n ?? 0) === 0,
      blocker:     true,
      action_url:  '/suppliers',
    },
    {
      key:         'uncosted_harvests',
      label:       'حصادات غير مُكلَّفة',
      description: 'سجلات حصاد بتكلفة فعلية صفر أو غير محددة مع وجود كميات',
      count:       uncostedHRow?.n ?? 0,
      ok:          (uncostedHRow?.n ?? 0) === 0,
      blocker:     false,
      action_url:  '/fields/harvest',
    },
    {
      key:         'fields_without_harvest',
      label:       'حقول بدون سجل حصاد',
      description: `${totalFields} حقل في الموسم — ${totalFields - (fieldsNoHRow?.n ?? 0)} مسجَّل`,
      count:       fieldsNoHRow?.n ?? 0,
      ok:          (fieldsNoHRow?.n ?? 0) === 0,
      blocker:     false,
      action_url:  '/fields/harvest',
    },
    {
      key:         'active_contracts',
      label:       'عقود بيع غير مُكتملة',
      description: 'عقود نشطة أو جزئية لم تُحدَّث إلى "مكتمل" بعد',
      count:       activeConRow?.n ?? 0,
      ok:          (activeConRow?.n ?? 0) === 0,
      blocker:     false,
      action_url:  '/contracts',
    },
  ]

  const blockersFailed = checks.filter(ch => ch.blocker && !ch.ok).length
  const warningsFailed = checks.filter(ch => !ch.blocker && !ch.ok).length
  const passing        = checks.filter(ch => ch.ok).length
  const score          = Math.round((passing / checks.length) * 100)
  const ready          = blockersFailed === 0

  return c.json({
    success: true,
    data: {
      season,
      checks,
      summary: {
        blockers_failed: blockersFailed,
        warnings_failed: warningsFailed,
        passing,
        total:           checks.length,
        score,
        ready,
        total_fields:    totalFields,
        total_harvests:  totalHarvests,
      },
    },
  })
})

// ─────────────────────────────────────────────────────────────────
// GET /api/reports/budget-vs-actual?season_id=1
//
// Per-field comparison: budget from field_season_budgets vs
// actual costs: inventory consumed + work-order labor + field-tagged cash transactions.
// ─────────────────────────────────────────────────────────────────
reports.get('/budget-vs-actual', async (c) => {
  const { company_id } = getUser(c)
  const seasonId = Number(c.req.query('season_id'))
  if (!seasonId) return c.json({ success: false, error: 'season_id مطلوب' }, 400)

  const [season, fieldRows] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM seasons WHERE id = ? AND company_id = ?')
      .bind(seasonId, company_id).first(),

    c.env.DB.prepare(`
      SELECT
        f.id, f.code, f.name AS field_name, f.area_feddan, f.crop_type,
        COALESCE(b.budget_per_feddan, 0)                                                       AS budget_per_feddan,
        COALESCE(b.budget_per_feddan, 0) * f.area_feddan                                       AS budget_total,
        COALESCE(inv.inv_cost,   0)                                                            AS inv_cost,
        COALESCE(lab.labor_cost, 0)                                                            AS labor_cost,
        COALESCE(csh.cash_cost,  0)                                                            AS cash_cost,
        COALESCE(inv.inv_cost, 0) + COALESCE(lab.labor_cost, 0) + COALESCE(csh.cash_cost, 0)  AS actual_total,
        CASE WHEN f.area_feddan > 0
          THEN (COALESCE(inv.inv_cost, 0) + COALESCE(lab.labor_cost, 0) + COALESCE(csh.cash_cost, 0)) / f.area_feddan
          ELSE 0 END                                                                           AS actual_per_feddan
      FROM fields f
      LEFT JOIN field_season_budgets b ON b.field_id = f.id AND b.season_id = ?
      LEFT JOIN (
        SELECT field_id, SUM(value_out) AS inv_cost
        FROM inventory_movements
        WHERE company_id = ? AND season_id = ? AND movement_type = 'صرف'
          AND field_id IS NOT NULL
        GROUP BY field_id
      ) inv ON inv.field_id = f.id
      LEFT JOIN (
        SELECT wo.field_id, SUM(wt.quantity * wt.unit_cost) AS labor_cost
        FROM work_tasks wt
        JOIN work_orders wo ON wo.id = wt.work_order_id AND wo.company_id = wt.company_id
        WHERE wo.company_id = ? AND wo.season_id = ? AND wo.field_id IS NOT NULL
        GROUP BY wo.field_id
      ) lab ON lab.field_id = f.id
      LEFT JOIN (
        SELECT field_id, SUM(amount) AS cash_cost
        FROM cash_transactions
        WHERE company_id = ? AND season_id = ? AND direction = 'م'
          AND field_id IS NOT NULL AND status = 'posted'
        GROUP BY field_id
      ) csh ON csh.field_id = f.id
      WHERE f.company_id = ? AND f.season_id = ?
      ORDER BY actual_total DESC
    `).bind(seasonId, company_id, seasonId, company_id, seasonId, company_id, seasonId, company_id, seasonId).all<{
      id: number; code: string; field_name: string; area_feddan: number; crop_type: string | null
      budget_per_feddan: number; budget_total: number
      inv_cost: number; labor_cost: number; cash_cost: number; actual_total: number; actual_per_feddan: number
    }>(),
  ])

  if (!season) return c.json({ success: false, error: 'الموسم غير موجود' }, 404)

  const rows = fieldRows.results.map(r => {
    const variance    = r.actual_total - r.budget_total
    const variancePct = r.budget_total > 0
      ? Math.round((variance / r.budget_total) * 1000) / 10 : null
    const utilization = r.budget_total > 0
      ? Math.round((r.actual_total / r.budget_total) * 1000) / 10 : null
    const status      = r.budget_total === 0  ? 'no_budget'
      : r.actual_total >= r.budget_total      ? 'over_budget'
      : (utilization ?? 0) >= 80             ? 'at_risk'
      : 'on_track'
    return { ...r, variance, variance_pct: variancePct, utilization_pct: utilization, status }
  })

  const totalBudget       = rows.reduce((s, r) => s + r.budget_total,  0)
  const totalActual       = rows.reduce((s, r) => s + r.actual_total,  0)
  const totalVariance     = totalActual - totalBudget
  const budgetedFields    = rows.filter(r => r.budget_total > 0).length
  const overBudgetCount   = rows.filter(r => r.status === 'over_budget').length
  const utilizationPct    = totalBudget > 0
    ? Math.round((totalActual / totalBudget) * 1000) / 10 : null

  return c.json({
    success: true,
    data: {
      season,
      totals: {
        budget:           totalBudget,
        actual:           totalActual,
        variance:         totalVariance,
        variance_pct:     totalBudget > 0 ? Math.round((totalVariance / totalBudget) * 1000) / 10 : null,
        utilization_pct:  utilizationPct,
        budgeted_fields:  budgetedFields,
        over_budget_count: overBudgetCount,
        total_fields:     rows.length,
      },
      rows,
    },
  })
})

export default reports
