import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'

const dashboard = new Hono<{ Bindings: Env }>()
dashboard.use('*', authMiddleware)

// GET /api/dashboard/stats
dashboard.get('/stats', async (c) => {
  const { company_id } = getUser(c)

  const [cashRow, payablesRow, inventoryRow, partnersRow] = await Promise.all([
    // Latest running cash balance
    c.env.DB.prepare(
      `SELECT running_balance FROM cash_transactions
       WHERE company_id = ? ORDER BY transaction_date DESC, id DESC LIMIT 1`
    ).bind(company_id).first<{ running_balance: number }>(),

    // Total payables — posted transactions only
    c.env.DB.prepare(
      `SELECT SUM(credit) - SUM(debit) AS net_payable FROM supplier_transactions WHERE company_id = ? AND status = 'posted'`
    ).bind(company_id).first<{ net_payable: number }>(),

    // Total inventory value — posted movements only
    c.env.DB.prepare(
      `SELECT SUM(value_in) - SUM(value_out) AS total_value FROM inventory_movements WHERE company_id = ? AND gl_posting_status = 'posted'`
    ).bind(company_id).first<{ total_value: number }>(),

    // Partners equity
    c.env.DB.prepare(
      `SELECT SUM(capital_paid + current_acct) AS total_equity FROM partners WHERE company_id = ?`
    ).bind(company_id).first<{ total_equity: number }>(),
  ])

  return c.json({
    success: true,
    data: {
      cash_balance:   cashRow?.running_balance      ?? 0,
      net_payable:    payablesRow?.net_payable       ?? 0,
      inventory_value: inventoryRow?.total_value     ?? 0,
      partners_equity: partnersRow?.total_equity     ?? 0,
    }
  })
})

// GET /api/dashboard/monthly-cashflow?months=12
dashboard.get('/monthly-cashflow', async (c) => {
  const { company_id } = getUser(c)
  const months = Math.min(Number(c.req.query('months') ?? 12), 24)

  const { results } = await c.env.DB.prepare(
    `SELECT year, month,
            SUM(CASE WHEN direction = 'د' THEN amount ELSE 0 END) AS cash_in,
            SUM(CASE WHEN direction = 'م' THEN amount ELSE 0 END) AS cash_out
     FROM cash_transactions
     WHERE company_id = ?
     GROUP BY year, month
     ORDER BY year DESC, month DESC
     LIMIT ?`
  ).bind(company_id, months).all()

  return c.json({ success: true, data: results.reverse() })
})

// GET /api/dashboard/cost-by-crop
// Groups supplier costs by cost_center (crop/field type) — not by GL account.
// The old `accounts` table is empty; cost_centers carries the agricultural dimension.
dashboard.get('/cost-by-crop', async (c) => {
  const { company_id } = getUser(c)
  const seasonId = c.req.query('season_id')

  const query = seasonId
    ? `SELECT COALESCE(cc.name_ar, 'غير محدد') AS crop, SUM(st.amount) AS total_cost
       FROM supplier_transactions st
       LEFT JOIN cost_centers cc ON cc.code = st.center_code AND cc.company_id = st.company_id
       WHERE st.company_id = ? AND st.season_id = ? AND st.status = 'posted'
       GROUP BY st.center_code ORDER BY total_cost DESC LIMIT 10`
    : `SELECT COALESCE(cc.name_ar, 'غير محدد') AS crop, SUM(st.amount) AS total_cost
       FROM supplier_transactions st
       LEFT JOIN cost_centers cc ON cc.code = st.center_code AND cc.company_id = st.company_id
       WHERE st.company_id = ? AND st.status = 'posted'
       GROUP BY st.center_code ORDER BY total_cost DESC LIMIT 10`

  const { results } = seasonId
    ? await c.env.DB.prepare(query).bind(company_id, seasonId).all()
    : await c.env.DB.prepare(query).bind(company_id).all()

  return c.json({ success: true, data: results })
})

// GET /api/dashboard/recent-transactions?limit=15
dashboard.get('/recent-transactions', async (c) => {
  const { company_id } = getUser(c)
  const limit = Math.min(Number(c.req.query('limit') ?? 15), 50)

  const { results } = await c.env.DB.prepare(
    `SELECT 'cash' AS ledger, id, transaction_date AS date,
            narration AS description, amount, direction AS type, created_at
     FROM cash_transactions WHERE company_id = ?
     UNION ALL
     SELECT 'supplier' AS ledger, id, transaction_date AS date,
            COALESCE(expense_category, document_type, 'معاملة') AS description,
            amount, entry_type AS type, created_at
     FROM supplier_transactions WHERE company_id = ?
     ORDER BY created_at DESC LIMIT ?`
  ).bind(company_id, company_id, limit).all()

  return c.json({ success: true, data: results })
})

// GET /api/dashboard/inventory-alerts
dashboard.get('/inventory-alerts', async (c) => {
  const { company_id } = getUser(c)

  const { results } = await c.env.DB.prepare(
    `SELECT i.code, i.name, i.unit, i.reorder_threshold,
            COALESCE(SUM(ib.balance_qty), 0) AS balance_qty
     FROM items i
     LEFT JOIN inventory_balances ib ON ib.item_code = i.code AND ib.company_id = i.company_id
     WHERE i.company_id = ? AND i.is_active = 1
     GROUP BY i.code
     HAVING balance_qty <= i.reorder_threshold AND i.reorder_threshold > 0
     ORDER BY balance_qty ASC LIMIT 20`
  ).bind(company_id).all()

  return c.json({ success: true, data: results })
})

// GET /api/dashboard/overdue-cycles
// Returns active crop cycles whose expected_harvest_date has passed without
// being settled. Used for dashboard alerts and the overdue badge on CropCyclesPage.
dashboard.get('/overdue-cycles', async (c) => {
  const { company_id } = getUser(c)
  const today = new Date().toISOString().slice(0, 10)

  const { results } = await c.env.DB.prepare(
    `SELECT cc.id, cc.crop_name, cc.planting_date, cc.expected_harvest_date,
            cc.area_feddan, cc.status,
            f.name AS field_name,
            s.name AS season_name,
            CAST(julianday(?) - julianday(cc.expected_harvest_date) AS INTEGER) AS days_overdue,
            COALESCE(wl.wip_balance, 0) AS wip_balance
     FROM crop_cycles cc
     JOIN fields  f ON f.id = cc.field_id  AND f.company_id = cc.company_id
     JOIN seasons s ON s.id = cc.season_id AND s.company_id = cc.company_id
     LEFT JOIN (
       SELECT crop_cycle_id, SUM(debit - credit) AS wip_balance
       FROM wip_ledger WHERE company_id = ?
       GROUP BY crop_cycle_id
     ) wl ON wl.crop_cycle_id = cc.id
     WHERE cc.company_id = ?
       AND cc.status = 'active'
       AND cc.expected_harvest_date IS NOT NULL
       AND cc.expected_harvest_date < ?
     ORDER BY days_overdue DESC`
  ).bind(today, company_id, company_id, today).all<{
    id: number; crop_name: string; planting_date: string
    expected_harvest_date: string; area_feddan: number | null
    status: string; field_name: string; season_name: string
    days_overdue: number; wip_balance: number
  }>()

  return c.json({
    success: true,
    data: {
      count: results.length,
      total_wip_at_risk: results.reduce((s, r) => s + r.wip_balance, 0),
      cycles: results,
    },
  })
})

export default dashboard
