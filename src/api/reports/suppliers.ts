import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser } from '../../middleware/auth'

const suppliers = new Hono<{ Bindings: Env }>()

suppliers.get('/supplier-payments', async (c) => {
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

suppliers.get('/suppliers-balance', async (c) => {
  const { company_id } = getUser(c)
  const seasonId = c.req.query('season_id') ? Number(c.req.query('season_id')) : null

  const seasonWhere  = seasonId ? 'AND st.season_id = ?' : ''
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

export default suppliers
