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
        st.center_code, COALESCE(cc.name_ar, cc.name_en) AS center_name,
        s.name AS supplier_name,
        st.journal_entry_id,
        je.is_posted AS gl_posted
      FROM supplier_transactions st
      LEFT JOIN cost_centers cc ON cc.code = st.center_code AND cc.company_id = st.company_id
      LEFT JOIN suppliers s     ON s.code  = st.supplier_code AND s.company_id = st.company_id
      LEFT JOIN journal_entries je ON je.id = st.journal_entry_id AND je.company_id = st.company_id
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

  // Resolve active AP control account from posting_rules
  const ap = await c.env.DB.prepare(
    `SELECT account_code
     FROM posting_rules
     WHERE company_id = ?
       AND rule_type = 'control'
       AND mapping_key = 'accounts_payable'
       AND is_active = 1
     ORDER BY priority ASC, id DESC
     LIMIT 1`
  ).bind(company_id).first<{ account_code: string }>()

  if (!ap?.account_code) {
    return c.json({
      success: false,
      error: 'No active control mapping found for accounts_payable in posting_rules',
      code: 'MISSING_AP_CONTROL_MAPPING',
    }, 409)
  }

  // Season filter is applied via journal_entry_lines.season_id — no supplier_transactions needed
  const seasonWhere = seasonId ? 'AND jl.season_id = ?' : ''

  // Supplier dimension sourced from business_events.payload (supplier_code field).
  // Both supplier_invoice and supplier_payment events now carry supplier_code in payload.
  // Events created before this change (old payment events with no supplier_code in payload)
  // are gracefully excluded via the IS NOT NULL guard and do NOT affect invoice totals.
  //
  // Bind order for the final SQL:
  // 1. ap.account_code  (SUM CASE credit)
  // 2. ap.account_code  (SUM CASE debit)
  // 3. company_id       (be.company_id filter)
  // 4. seasonId?        (jl.season_id filter, only when set)
  // 5. ap.account_code  (control_account literal column)
  // 6. company_id       (s.company_id filter)
  const queryBinds: unknown[] = [
    ap.account_code, ap.account_code,
    company_id,
    ...(seasonId ? [seasonId] : []),
    ap.account_code,
    company_id,
  ]

  const { results } = await c.env.DB.prepare(`
    WITH gl_by_supplier AS (
      SELECT
        CAST(json_extract(be.payload, '$.supplier_code') AS INTEGER) AS supplier_code,
        COALESCE(SUM(CASE WHEN jl.account_code = ? THEN jl.credit ELSE 0 END), 0) AS total_credit,
        COALESCE(SUM(CASE WHEN jl.account_code = ? THEN jl.debit  ELSE 0 END), 0) AS total_debit,
        COUNT(DISTINCT je.id) AS tx_count
      FROM business_events be
      JOIN journal_entries je
        ON je.id = be.journal_entry_id
       AND je.company_id = be.company_id
       AND je.is_posted = 1
      JOIN journal_entry_lines jl
        ON jl.entry_id = je.id
       AND jl.company_id = je.company_id
      WHERE be.company_id = ?
        AND be.source_module = 'suppliers'
        AND be.status = 'posted'
        AND json_extract(be.payload, '$.supplier_code') IS NOT NULL
        ${seasonWhere}
      GROUP BY supplier_code
    )
    SELECT
      s.code,
      s.name,
      s.activity,
      COALESCE(g.total_credit, 0)                      AS total_credit,
      COALESCE(g.total_debit,  0)                      AS total_debit,
      COALESCE(g.total_credit - g.total_debit, 0)      AS balance,
      COALESCE(g.total_credit - g.total_debit, 0)      AS last_balance,
      COALESCE(g.tx_count, 0)                          AS tx_count,
      'gl_business_events'                             AS data_source,
      ?                                                AS control_account
    FROM suppliers s
    LEFT JOIN gl_by_supplier g ON g.supplier_code = s.code
    WHERE s.company_id = ?
    ORDER BY ABS(balance) DESC
  `).bind(...queryBinds).all()

  return c.json({ success: true, data: results })
})

export default suppliers
