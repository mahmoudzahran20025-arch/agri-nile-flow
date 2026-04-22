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
  const seasonWhere = seasonId ? 'AND season_id = ?' : ''
  const cashBinds: unknown[] = seasonId ? [company_id, seasonId] : [company_id]
  const supBinds:  unknown[] = seasonId ? [company_id, seasonId] : [company_id]

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
      AND ct.direction = 'OUT'
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
      AND st.center_code IS NOT NULL
      ${seasonWhere}
    GROUP BY st.center_code
  `).bind(...supBinds).all<{
    center_code: number; center_name: string | null
    supplier_total: number; supplier_count: number
  }>()

  const [cashRes, supRes] = await Promise.all([cashQ, supQ])

  // Merge by center_code
  const map = new Map<number, {
    center_code: number; center_name: string | null
    cash_total: number; cash_count: number
    supplier_total: number; supplier_count: number
    grand_total: number
  }>()

  for (const r of cashRes.results) {
    map.set(r.center_code, {
      center_code:    r.center_code,
      center_name:    r.center_name,
      cash_total:     r.cash_total ?? 0,
      cash_count:     r.cash_count ?? 0,
      supplier_total: 0,
      supplier_count: 0,
      grand_total:    r.cash_total ?? 0,
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
        center_code:    r.center_code,
        center_name:    r.center_name,
        cash_total:     0,
        cash_count:     0,
        supplier_total: r.supplier_total ?? 0,
        supplier_count: r.supplier_count ?? 0,
        grand_total:    r.supplier_total ?? 0,
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
      WHERE ct.company_id = ? AND ct.center_code = ? AND ct.direction = 'OUT'
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
      WHERE st.company_id = ? AND st.center_code = ?
        ${seasonWhere}
      GROUP BY st.supplier_code
      ORDER BY total DESC
    `).bind(...seasonBind).all(),

    // Cash: monthly timeline
    c.env.DB.prepare(`
      SELECT year, month, SUM(amount) AS total
      FROM cash_transactions
      WHERE company_id = ? AND center_code = ? AND direction = 'OUT'
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

  const seasonWhere = seasonId ? 'AND st.season_id = ?' : ''
  const binds: unknown[] = seasonId ? [company_id, seasonId] : [company_id]

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
      ON st.supplier_code = s.code AND st.company_id = s.company_id
      ${seasonWhere}
    WHERE s.company_id = ?
    GROUP BY s.code
    ORDER BY ABS(balance) DESC
  `).bind(...(seasonId ? [seasonId, company_id] : [company_id])).all()

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
        WHERE company_id = ? AND direction = 'OUT' AND center_code IS NOT NULL ${seasonWhere}
        GROUP BY center_code
      ) cash ON cash.center_code = cc.code
      LEFT JOIN (
        SELECT center_code, SUM(credit) AS sup_total
        FROM supplier_transactions
        WHERE company_id = ? AND center_code IS NOT NULL ${seasonWhere}
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
      WHERE ct.company_id = ? AND ct.direction = 'OUT' ${seasonWhere}
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
        ON st.supplier_code = s.code AND st.company_id = s.company_id
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
      FROM cash_transactions WHERE company_id = ? AND direction = 'OUT' ${seasonWhere}
    `).bind(...cashBinds).first<{ total: number }>(),

    // Supplier total credit
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(credit), 0) AS credit, COALESCE(SUM(debit), 0) AS debit
      FROM supplier_transactions WHERE company_id = ? ${seasonWhere}
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
        FROM cash_transactions WHERE company_id = ? AND direction = 'OUT' ${seasonWhere}
        UNION ALL
        SELECT year, month, credit AS amount, 'sup' AS src
        FROM supplier_transactions WHERE company_id = ? ${seasonWhere}
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

export default reports
