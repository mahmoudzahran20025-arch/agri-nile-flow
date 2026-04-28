/**
 * Trial Balance — GL-Only Implementation
 * =======================================
 * Architecture Law: ALL numbers derive from journal_entry_lines.
 * No source-table aggregation (cash, supplier, inventory) is permitted here.
 *
 * Two modes:
 *   ?period_id=X  — trial balance for a single financial period
 *   ?as_of=DATE   — cumulative trial balance at a point in time (all posted entries ≤ date)
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser } from '../../middleware/auth'

const trialBalance = new Hono<{ Bindings: Env }>()

// ── GET /trial-balance ────────────────────────────────────────────────────────

trialBalance.get('/trial-balance', async (c) => {
  const { company_id } = getUser(c)
  const periodId = c.req.query('period_id') ? Number(c.req.query('period_id')) : null
  const asOf     = c.req.query('as_of') ?? null

  if (!periodId && !asOf) {
    return c.json({ success: false, error: 'period_id أو as_of مطلوب' }, 400)
  }

  // ── Build WHERE clause for the "current period" lines ─────────────────────
  let periodFilter: string
  const binds: unknown[] = [company_id]

  if (periodId) {
    periodFilter = 'je.period_id = ?'
    binds.push(periodId)
  } else {
    periodFilter = 'je.entry_date <= ?'
    binds.push(asOf)
  }

  // ── Opening balance: all posted entries BEFORE this period/date ────────────
  // (Only applicable for period mode; for as_of mode opening = 0)
  let openingFilter = '1 = 0'  // nothing → zero opening
  const openingBinds: unknown[] = [company_id]

  if (periodId) {
    openingFilter = 'je.period_id < ?'
    openingBinds.push(periodId)
  }

  // ── Main query: period movement per account ────────────────────────────────
  const { results: movements } = await c.env.DB.prepare(`
    SELECT
      a.code              AS account_code,
      a.name              AS account_name,
      a.account_type,
      a.normal_balance,
      a.parent_code,
      a.is_header,
      SUM(jl.debit)       AS period_debit,
      SUM(jl.credit)      AS period_credit
    FROM journal_entry_lines jl
    JOIN journal_entries je     ON je.id          = jl.entry_id
                               AND je.company_id  = jl.company_id
                               AND je.is_posted   = 1
    JOIN chart_of_accounts a    ON a.code         = jl.account_code
                               AND a.company_id   = jl.company_id
    WHERE jl.company_id = ?
      AND ${periodFilter}
    GROUP BY a.code
    ORDER BY a.code
  `).bind(...binds).all<{
    account_code:   string
    account_name:   string
    account_type:   string
    normal_balance: string
    parent_code:    string | null
    is_header:      number
    period_debit:   number
    period_credit:  number
  }>()

  // ── Opening balances ───────────────────────────────────────────────────────
  const { results: openings } = await c.env.DB.prepare(`
    SELECT
      jl.account_code,
      SUM(jl.debit)  AS opening_debit,
      SUM(jl.credit) AS opening_credit
    FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id         = jl.entry_id
                           AND je.company_id = jl.company_id
                           AND je.is_posted  = 1
    WHERE jl.company_id = ?
      AND ${openingFilter}
    GROUP BY jl.account_code
  `).bind(...openingBinds).all<{
    account_code:    string
    opening_debit:   number
    opening_credit:  number
  }>()

  const openingMap = new Map(openings.map(o => [o.account_code, o]))

  // ── Merge and compute closing balances ─────────────────────────────────────
  const rows = movements.map(m => {
    const op = openingMap.get(m.account_code)
    const openDr  = op?.opening_debit  ?? 0
    const openCr  = op?.opening_credit ?? 0
    const openNet = openDr - openCr   // positive = net debit opening

    const closeDr  = openDr + m.period_debit
    const closeCr  = openCr + m.period_credit
    const closeNet = closeDr - closeCr

    // Normal-balance presentation: debit-normal accounts show positive when Dr > Cr
    const openingBalance  = m.normal_balance === 'debit' ?  openNet  : -openNet
    const closingBalance  = m.normal_balance === 'debit' ?  closeNet : -closeNet

    return {
      account_code:     m.account_code,
      account_name:     m.account_name,
      account_type:     m.account_type,
      normal_balance:   m.normal_balance,
      parent_code:      m.parent_code,
      is_header:        m.is_header === 1,
      opening_balance:  openingBalance,
      period_debit:     m.period_debit,
      period_credit:    m.period_credit,
      closing_balance:  closingBalance,
    }
  })

  // ── Grand totals (must balance: total_debit = total_credit) ───────────────
  const total_period_debit  = rows.reduce((s, r) => s + r.period_debit,  0)
  const total_period_credit = rows.reduce((s, r) => s + r.period_credit, 0)
  const imbalance = Math.abs(total_period_debit - total_period_credit)
  const is_balanced = imbalance < 0.01

  // ── Totals by account type ─────────────────────────────────────────────────
  const byType = rows.reduce<Record<string, { debit: number; credit: number }>>((acc, r) => {
    if (!acc[r.account_type]) acc[r.account_type] = { debit: 0, credit: 0 }
    acc[r.account_type].debit  += r.period_debit
    acc[r.account_type].credit += r.period_credit
    return acc
  }, {})

  return c.json({
    success: true,
    data: rows,
    summary: {
      total_period_debit,
      total_period_credit,
      is_balanced,
      imbalance: is_balanced ? 0 : imbalance,
      row_count:  rows.length,
      by_type:    byType,
      data_source: 'gl_journal_lines',
    },
    ...(periodId ? { period_id: periodId } : { as_of: asOf }),
  })
})

// ── GET /trial-balance/accounts/:code ─────────────────────────────────────────
// Detailed ledger for a single account — every posted line with entry context.

trialBalance.get('/trial-balance/accounts/:code', async (c) => {
  const { company_id } = getUser(c)
  const accountCode = c.req.param('code')
  const periodId    = c.req.query('period_id') ? Number(c.req.query('period_id')) : null
  const startDate   = c.req.query('start') ?? null
  const endDate     = c.req.query('end')   ?? null
  const page        = Math.max(1, Number(c.req.query('page') ?? 1))
  const size        = Math.min(200, Number(c.req.query('size') ?? 100))
  const offset      = (page - 1) * size

  const account = await c.env.DB.prepare(
    'SELECT code, name, account_type, normal_balance, is_header FROM chart_of_accounts WHERE code = ? AND company_id = ?'
  ).bind(accountCode, company_id).first<{
    code: string; name: string; account_type: string; normal_balance: string; is_header: number
  }>()

  if (!account) return c.json({ success: false, error: 'الحساب غير موجود' }, 404)

  const filters: string[] = ['jl.company_id = ?', 'jl.account_code = ?', 'je.is_posted = 1']
  const binds: unknown[]  = [company_id, accountCode]

  if (periodId)  { filters.push('je.period_id = ?');    binds.push(periodId) }
  if (startDate) { filters.push('je.entry_date >= ?');  binds.push(startDate) }
  if (endDate)   { filters.push('je.entry_date <= ?');  binds.push(endDate) }

  const where = filters.join(' AND ')

  // Opening balance (everything before the filter range)
  let openingBinds: unknown[] = [company_id, accountCode]
  let openingWhere = 'jl.company_id = ? AND jl.account_code = ? AND je.is_posted = 1'
  if (periodId) {
    openingWhere += ' AND je.period_id < ?'
    openingBinds.push(periodId)
  } else if (startDate) {
    openingWhere += ' AND je.entry_date < ?'
    openingBinds.push(startDate)
  }

  const openingRow = await c.env.DB.prepare(`
    SELECT SUM(jl.debit) AS total_debit, SUM(jl.credit) AS total_credit
    FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id
    WHERE ${openingWhere}
  `).bind(...openingBinds).first<{ total_debit: number; total_credit: number }>()

  const openDr  = openingRow?.total_debit  ?? 0
  const openCr  = openingRow?.total_credit ?? 0
  const openNet = account.normal_balance === 'debit' ? (openDr - openCr) : (openCr - openDr)

  // Paginated lines with running balance logic handled on the client
  const { results: lines } = await c.env.DB.prepare(`
    SELECT
      jl.id,
      jl.debit,
      jl.credit,
      jl.description     AS line_description,
      jl.rule_slot,
      jl.center_code,
      jl.season_id,
      jl.field_id,
      je.id              AS entry_id,
      je.entry_date,
      je.description     AS entry_description,
      je.ref_type,
      je.ref_id,
      je.posting_rule_trace
    FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id
    WHERE ${where}
    ORDER BY je.entry_date ASC, je.id ASC, jl.id ASC
    LIMIT ? OFFSET ?
  `).bind(...binds, size, offset).all()

  const countRow = await c.env.DB.prepare(`
    SELECT COUNT(*) AS n
    FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id
    WHERE ${where}
  `).bind(...binds).first<{ n: number }>()

  const sumRow = await c.env.DB.prepare(`
    SELECT SUM(jl.debit) AS period_debit, SUM(jl.credit) AS period_credit
    FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id
    WHERE ${where}
  `).bind(...binds).first<{ period_debit: number; period_credit: number }>()

  const periodDr  = sumRow?.period_debit  ?? 0
  const periodCr  = sumRow?.period_credit ?? 0
  const periodNet = account.normal_balance === 'debit' ? (periodDr - periodCr) : (periodCr - periodDr)

  return c.json({
    success: true,
    data: {
      account,
      opening_balance: openNet,
      period_debit:    periodDr,
      period_credit:   periodCr,
      closing_balance: openNet + periodNet,
      lines,
      pagination: {
        total:     countRow?.n ?? 0,
        page,
        page_size: size,
        has_more:  offset + size < (countRow?.n ?? 0),
      },
      data_source: 'gl_journal_lines',
    },
  })
})

export default trialBalance
