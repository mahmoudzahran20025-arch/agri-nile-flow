/**
 * Cost Center Reports — GL-Only Implementation
 * =============================================
 * Architectural law: cost centers are a FILTER on journal_lines.
 * No aggregation from cash_transactions, supplier_transactions, or
 * inventory_movements. All numbers derive from the GL ledger.
 *
 * This is the canonical and only source of truth for cost center totals.
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser } from '../../middleware/auth'

const costCenters = new Hono<{ Bindings: Env }>()

// ── GET /cost-centers ─────────────────────────────────────────────────────────
// Summary: total debits & credits per cost center, broken down by account_type.
// Derived 100% from journal_lines → journal_entries → accounts.

costCenters.get('/cost-centers', async (c) => {
  const { company_id } = getUser(c)
  const seasonId  = c.req.query('season_id')  ? Number(c.req.query('season_id'))  : null
  const periodId  = c.req.query('period_id')  ? Number(c.req.query('period_id'))  : null
  const startDate = c.req.query('start') ?? null
  const endDate   = c.req.query('end')   ?? null

  // Build dynamic WHERE clauses for optional filters
  const filters: string[] = [
    'jl.company_id = ?',
    'je.is_posted = 1',
    'jl.center_code IS NOT NULL',
  ]
  const binds: unknown[] = [company_id]

  if (seasonId)  { filters.push('jl.season_id = ?');   binds.push(seasonId) }
  if (periodId)  { filters.push('je.period_id = ?');   binds.push(periodId) }
  if (startDate) { filters.push('je.entry_date >= ?'); binds.push(startDate) }
  if (endDate)   { filters.push('je.entry_date <= ?'); binds.push(endDate) }

  const where = filters.join(' AND ')

  // Single query — GL is the only source
  const { results } = await c.env.DB.prepare(`
    SELECT
      jl.center_code,
      cc.name                          AS center_name,
      a.account_type,
      SUM(jl.debit)                    AS total_debit,
      SUM(jl.credit)                   AS total_credit,
      SUM(jl.debit  - jl.credit)       AS net_debit,
      COUNT(DISTINCT je.id)            AS entry_count
    FROM journal_entry_lines jl
    JOIN journal_entries je   ON je.id         = jl.entry_id
                             AND je.company_id  = jl.company_id
    JOIN chart_of_accounts a           ON a.code         = jl.account_code
                             AND a.company_id   = jl.company_id
    JOIN cost_centers cc      ON cc.code        = jl.center_code
                             AND cc.company_id  = jl.company_id
    WHERE ${where}
    GROUP BY jl.center_code, a.account_type
    ORDER BY jl.center_code, a.account_type
  `).bind(...binds).all<{
    center_code:  number
    center_name:  string
    account_type: string
    total_debit:  number
    total_credit: number
    net_debit:    number
    entry_count:  number
  }>()

  // Aggregate per cost center across account types
  type CenterRow = {
    center_code:  number
    center_name:  string
    expense_total:  number
    revenue_total:  number
    asset_total:    number
    liability_total: number
    entry_count:    number
    net_cost:       number   // expense − revenue (positive = net cost center)
  }

  const map = new Map<number, CenterRow>()

  for (const r of results) {
    if (!map.has(r.center_code)) {
      map.set(r.center_code, {
        center_code:     r.center_code,
        center_name:     r.center_name,
        expense_total:   0,
        revenue_total:   0,
        asset_total:     0,
        liability_total: 0,
        entry_count:     0,
        net_cost:        0,
      })
    }
    const row = map.get(r.center_code)!
    row.entry_count += r.entry_count

    switch (r.account_type) {
      case 'expense':
        row.expense_total += r.net_debit    // debit-normal: positive = cost
        break
      case 'revenue':
        row.revenue_total += r.total_credit - r.total_debit  // credit-normal
        break
      case 'asset':
        row.asset_total += r.net_debit
        break
      case 'liability':
        row.liability_total += r.total_credit - r.total_debit
        break
    }
  }

  // Compute net cost and sort descending
  const rows: CenterRow[] = [...map.values()].map(r => ({
    ...r,
    net_cost: r.expense_total - r.revenue_total,
  })).sort((a, b) => b.expense_total - a.expense_total)

  const grand_expense = rows.reduce((s, r) => s + r.expense_total, 0)
  const grand_revenue = rows.reduce((s, r) => s + r.revenue_total, 0)

  return c.json({
    success: true,
    data: rows,
    summary: {
      grand_expense,
      grand_revenue,
      grand_net_cost: grand_expense - grand_revenue,
      center_count:   rows.length,
      data_source:    'gl_journal_lines',   // explicit provenance tag
    },
  })
})

// ── GET /cost-centers/:code/detail ────────────────────────────────────────────
// Full ledger for a single cost center — every GL line with entry metadata.

costCenters.get('/cost-centers/:code/detail', async (c) => {
  const { company_id } = getUser(c)
  const centerCode = Number(c.req.param('code'))
  const seasonId   = c.req.query('season_id') ? Number(c.req.query('season_id')) : null
  const startDate  = c.req.query('start') ?? null
  const endDate    = c.req.query('end')   ?? null
  const page       = Math.max(1, Number(c.req.query('page') ?? 1))
  const size       = Math.min(200, Number(c.req.query('size') ?? 100))
  const offset     = (page - 1) * size

  const filters: string[] = [
    'jl.company_id = ?',
    'jl.center_code = ?',
    'je.is_posted = 1',
  ]
  const binds: unknown[] = [company_id, centerCode]
  const countBinds: unknown[] = [company_id, centerCode]

  if (seasonId)  { filters.push('jl.season_id = ?');   binds.push(seasonId);  countBinds.push(seasonId) }
  if (startDate) { filters.push('je.entry_date >= ?'); binds.push(startDate); countBinds.push(startDate) }
  if (endDate)   { filters.push('je.entry_date <= ?'); binds.push(endDate);   countBinds.push(endDate) }

  const where = filters.join(' AND ')

  // Center info
  const center = await c.env.DB.prepare(
    'SELECT code, name FROM cost_centers WHERE code = ? AND company_id = ?'
  ).bind(centerCode, company_id).first<{ code: number; name: string }>()

  if (!center) return c.json({ success: false, error: 'مركز التكلفة غير موجود' }, 404)

  // Summary by account
  const { results: summary } = await c.env.DB.prepare(`
    SELECT
      a.code         AS account_code,
      a.name         AS account_name,
      a.account_type,
      SUM(jl.debit)  AS total_debit,
      SUM(jl.credit) AS total_credit,
      COUNT(*)       AS line_count
    FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id
    JOIN chart_of_accounts a         ON a.code = jl.account_code AND a.company_id = jl.company_id
    WHERE ${where}
    GROUP BY a.code
    ORDER BY a.account_type, a.code
  `).bind(...countBinds).all<{
    account_code:  string
    account_name:  string
    account_type:  string
    total_debit:   number
    total_credit:  number
    line_count:    number
  }>()

  // Timeline: monthly totals for charting
  const { results: timeline } = await c.env.DB.prepare(`
    SELECT
      strftime('%Y', je.entry_date) AS year,
      strftime('%m', je.entry_date) AS month,
      SUM(CASE WHEN a.account_type = 'expense' THEN jl.debit - jl.credit ELSE 0 END) AS expense_total,
      SUM(CASE WHEN a.account_type = 'revenue' THEN jl.credit - jl.debit ELSE 0 END) AS revenue_total,
      COUNT(DISTINCT je.id) AS entry_count
    FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id
    JOIN chart_of_accounts a         ON a.code = jl.account_code AND a.company_id = jl.company_id
    WHERE ${where}
    GROUP BY year, month
    ORDER BY year, month
  `).bind(...countBinds).all<{
    year:          string
    month:         string
    expense_total: number
    revenue_total: number
    entry_count:   number
  }>()

  // Paginated line detail with full entry context + trace
  const { results: lines } = await c.env.DB.prepare(`
    SELECT
      jl.id,
      jl.account_code,
      a.name          AS account_name,
      a.account_type,
      jl.debit,
      jl.credit,
      jl.description  AS line_description,
      jl.rule_slot,
      je.id           AS entry_id,
      je.entry_date,
      je.description  AS entry_description,
      je.ref_type,
      je.ref_id,
      je.posting_rule_trace,
      be.event_type   AS business_event_type,
      be.source_module
    FROM journal_entry_lines jl
    JOIN journal_entries je  ON je.id = jl.entry_id AND je.company_id = jl.company_id
    JOIN chart_of_accounts a          ON a.code = jl.account_code AND a.company_id = jl.company_id
    LEFT JOIN business_events be ON be.id = je.ref_id AND je.ref_type = 'business_event'
    WHERE ${where}
    ORDER BY je.entry_date DESC, je.id DESC, jl.id ASC
    LIMIT ? OFFSET ?
  `).bind(...binds, size, offset).all()

  const [countRow] = await Promise.all([
    c.env.DB.prepare(`
      SELECT COUNT(*) AS n FROM journal_entry_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id
      WHERE ${where}

    `).bind(...countBinds).first<{ n: number }>(),
  ])

  // Compute totals
  const totalExpense = summary.filter(s => s.account_type === 'expense')
    .reduce((sum, s) => sum + s.total_debit - s.total_credit, 0)
  const totalRevenue = summary.filter(s => s.account_type === 'revenue')
    .reduce((sum, s) => sum + s.total_credit - s.total_debit, 0)

  return c.json({
    success: true,
    data: {
      center,
      summary,
      timeline: timeline,
      lines:    lines,
      totals: {
        expense: totalExpense,
        revenue: totalRevenue,
        net_cost: totalExpense - totalRevenue,
      },
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

// ── GET /cost-centers/compare ─────────────────────────────────────────────────
// Side-by-side comparison: two seasons or two periods for all cost centers.

costCenters.get('/cost-centers/compare', async (c) => {
  const { company_id } = getUser(c)
  const seasonA = c.req.query('season_a') ? Number(c.req.query('season_a')) : null
  const seasonB = c.req.query('season_b') ? Number(c.req.query('season_b')) : null

  if (!seasonA || !seasonB) {
    return c.json({ success: false, error: 'season_a و season_b مطلوبان' }, 400)
  }

  const queryForSeason = (seasonId: number) => c.env.DB.prepare(`
    SELECT
      jl.center_code,
      cc.name AS center_name,
      SUM(CASE WHEN a.account_type = 'expense' THEN jl.debit - jl.credit ELSE 0 END) AS expense_total,
      SUM(CASE WHEN a.account_type = 'revenue' THEN jl.credit - jl.debit ELSE 0 END) AS revenue_total
    FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id AND je.is_posted = 1
    JOIN chart_of_accounts a         ON a.code = jl.account_code AND a.company_id = jl.company_id
    JOIN cost_centers cc    ON cc.code = jl.center_code AND cc.company_id = jl.company_id
    WHERE jl.company_id = ? AND jl.season_id = ? AND jl.center_code IS NOT NULL
    GROUP BY jl.center_code
  `).bind(company_id, seasonId).all<{
    center_code:   number
    center_name:   string
    expense_total: number
    revenue_total: number
  }>()

  const [resA, resB] = await Promise.all([queryForSeason(seasonA), queryForSeason(seasonB)])

  // Merge by center_code
  const allCodes = new Set([
    ...resA.results.map(r => r.center_code),
    ...resB.results.map(r => r.center_code),
  ])
  const mapA = new Map(resA.results.map(r => [r.center_code, r]))
  const mapB = new Map(resB.results.map(r => [r.center_code, r]))

  const comparison = [...allCodes].map(code => {
    const a = mapA.get(code)
    const b = mapB.get(code)
    const expA = a?.expense_total ?? 0
    const expB = b?.expense_total ?? 0
    return {
      center_code:  code,
      center_name:  a?.center_name ?? b?.center_name ?? String(code),
      season_a: { expense: expA, revenue: a?.revenue_total ?? 0 },
      season_b: { expense: expB, revenue: b?.revenue_total ?? 0 },
      delta:        expB - expA,
      delta_pct:    expA !== 0 ? Math.round(((expB - expA) / expA) * 1000) / 10 : null,
    }
  }).sort((a, b) => b.season_b.expense - a.season_b.expense)

  return c.json({ success: true, data: comparison })
})

export default costCenters
