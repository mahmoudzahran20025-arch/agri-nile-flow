import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'
import { getTodayIsoDate } from '../../lib/utils/date'

const reports = new Hono<{ Bindings: Env }>()
reports.use('*', authMiddleware)
reports.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

// Builds a map: account code → set of all descendant codes (including itself)
function buildDescendants(accounts: { code: string; parent_code: string | null }[]): Map<string, Set<string>> {
  const children = new Map<string, Set<string>>()
  for (const a of accounts) {
    if (!children.has(a.code)) children.set(a.code, new Set())
    if (a.parent_code) {
      if (!children.has(a.parent_code)) children.set(a.parent_code, new Set())
      children.get(a.parent_code)!.add(a.code)
    }
  }
  const desc = new Map<string, Set<string>>()
  const collect = (code: string, visited: Set<string>): Set<string> => {
    if (visited.has(code)) return new Set()
    visited.add(code)
    if (desc.has(code)) return desc.get(code)!
    const s = new Set([code])
    for (const ch of children.get(code) ?? []) {
      for (const d of collect(ch, visited)) s.add(d)
    }
    desc.set(code, s)
    return s
  }
  for (const a of accounts) collect(a.code, new Set())
  return desc
}

// =============================================================================
// GENERAL LEDGER
// =============================================================================

// GET /api/gl/engine-health
reports.get('/engine-health', async (c) => {
  const { company_id } = getUser(c)

  const unbalanced = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM (
       SELECT l.entry_id
       FROM journal_entry_lines l
       JOIN journal_entries e ON e.id = l.entry_id AND e.company_id = l.company_id
       WHERE e.company_id = ? AND e.is_posted = 1
       GROUP BY l.entry_id
       HAVING ABS(ROUND(SUM(COALESCE(l.debit, 0)) - SUM(COALESCE(l.credit, 0)), 2)) > 0.01
     )`
  ).bind(company_id).first<{ count: number }>()

  const emptyEntries = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM journal_entries e
     WHERE e.company_id = ?
       AND e.is_posted = 1
       AND NOT EXISTS (
         SELECT 1 FROM journal_entry_lines l
         WHERE l.company_id = e.company_id AND l.entry_id = e.id
       )`
  ).bind(company_id).first<{ count: number }>()

  const headerAccountPostings = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM journal_entry_lines l
     JOIN journal_entries e ON e.id = l.entry_id AND e.company_id = l.company_id AND e.is_posted = 1
     JOIN chart_of_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
     WHERE l.company_id = ? AND COALESCE(a.is_header, 0) = 1`
  ).bind(company_id).first<{ count: number }>()

  const cashMissingJournal = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM cash_transactions
     WHERE company_id = ? AND status = 'posted' AND journal_entry_id IS NULL`
  ).bind(company_id).first<{ count: number }>()

  const supplierMissingJournal = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM supplier_transactions
     WHERE company_id = ? AND status = 'posted' AND journal_entry_id IS NULL`
  ).bind(company_id).first<{ count: number }>()

  const inventoryGhostPosted = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM inventory_movements
     WHERE company_id = ?
       AND gl_posting_status = 'posted'
       AND journal_entry_id IS NULL`
  ).bind(company_id).first<{ count: number }>()

  const inventoryFailed = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM inventory_movements
     WHERE company_id = ? AND gl_posting_status = 'failed'`
  ).bind(company_id).first<{ count: number }>()

  const stuckOutbox = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM inventory_posting_outbox
     WHERE company_id = ?
       AND status IN ('pending', 'processing')
       AND created_at <= datetime('now', '-15 minutes')`
  ).bind(company_id).first<{ count: number }>()

  const failedOutbox = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM inventory_posting_outbox
     WHERE company_id = ? AND status = 'failed'`
  ).bind(company_id).first<{ count: number }>()

  const recentFailures = await c.env.DB.prepare(
    `SELECT id, endpoint, method, error_message, created_at
     FROM system_error_logs
     WHERE company_id = ? AND endpoint LIKE 'FINANCIAL_WORKFLOW:%'
     ORDER BY created_at DESC, id DESC
     LIMIT 20`
  ).bind(company_id).all<{
    id: number
    endpoint: string
    method: string
    error_message: string
    created_at: string
  }>()

  const inconsistentCash = await c.env.DB.prepare(
    `SELECT id, transaction_date, narration, amount, financial_account_id
     FROM cash_transactions
     WHERE company_id = ? AND status = 'posted' AND journal_entry_id IS NULL
     ORDER BY transaction_date DESC, id DESC
     LIMIT 20`
  ).bind(company_id).all<{
    id: number
    transaction_date: string
    narration: string
    amount: number
    financial_account_id: number | null
  }>()

  const inconsistentSuppliers = await c.env.DB.prepare(
    `SELECT id, transaction_date, notes, amount, supplier_code
     FROM supplier_transactions
     WHERE company_id = ? AND status = 'posted' AND journal_entry_id IS NULL
     ORDER BY transaction_date DESC, id DESC
     LIMIT 20`
  ).bind(company_id).all<{
    id: number
    transaction_date: string
    notes: string | null
    amount: number
    supplier_code: number | null
  }>()

  const inconsistentInventory = await c.env.DB.prepare(
    `SELECT id, movement_date, movement_type, gl_posting_status, gl_posting_error
     FROM inventory_movements
     WHERE company_id = ?
       AND (gl_posting_status = 'failed' OR (gl_posting_status = 'posted' AND journal_entry_id IS NULL))
     ORDER BY movement_date DESC, id DESC
     LIMIT 20`
  ).bind(company_id).all<{
    id: number
    movement_date: string
    movement_type: string
    gl_posting_status: string
    gl_posting_error: string | null
  }>()

  const summary = {
    unbalanced_journal_entries: unbalanced?.count ?? 0,
    empty_posted_entries: emptyEntries?.count ?? 0,
    header_account_postings: headerAccountPostings?.count ?? 0,
    posted_cash_missing_journal: cashMissingJournal?.count ?? 0,
    posted_supplier_missing_journal: supplierMissingJournal?.count ?? 0,
    inventory_ghost_posted: inventoryGhostPosted?.count ?? 0,
    inventory_failed: inventoryFailed?.count ?? 0,
    inventory_outbox_stuck: stuckOutbox?.count ?? 0,
    inventory_outbox_failed: failedOutbox?.count ?? 0,
    recent_workflow_failures: recentFailures.results.length,
  }

  const totalIssues = Object.values(summary).reduce((acc, value) => acc + value, 0)

  return c.json({
    success: true,
    data: {
      status: totalIssues === 0 ? 'healthy' : 'attention',
      summary,
      details: {
        recent_failures: recentFailures.results,
        cash_missing_journal: inconsistentCash.results,
        supplier_missing_journal: inconsistentSuppliers.results,
        inventory_inconsistencies: inconsistentInventory.results,
      },
    },
  })
})

// GET /api/gl/ledger/:account?
reports.get('/ledger/:account?', async (c) => {
  const { company_id } = getUser(c)
  const accountCode = c.req.param('account') ?? c.req.query('account')
  const start = c.req.query('start')
  const end = c.req.query('end')
  const center = c.req.query('center')
  const leafOnly = c.req.query('leaf') === '1'
  const page = parseInt(c.req.query('page') || '1', 10)
  const size = parseInt(c.req.query('size') || '100', 10)

  if (!accountCode) return c.json({ success: false, error: 'account (code) required' }, 400)

  // Fetch account details
  const account = await c.env.DB.prepare(
    'SELECT code, name, account_type, normal_balance, is_header FROM chart_of_accounts WHERE company_id = ? AND code = ?'
  ).bind(company_id, accountCode).first()

  if (!account) return c.json({ success: false, error: 'Account not found' }, 404)

  const fromClause = `
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    LEFT JOIN cost_centers cc ON cc.id = l.center_code AND cc.company_id = l.company_id
    LEFT JOIN seasons s ON s.id = l.season_id
    LEFT JOIN fields f ON f.id = l.field_id
    WHERE l.company_id = ? AND l.account_code ${leafOnly ? '=' : 'LIKE'} ? AND e.is_posted = 1
  `
  const binds: unknown[] = [company_id, leafOnly ? accountCode : `${accountCode}%`]

  if (start) { binds.push(start) }
  if (end)   { binds.push(end) }
  const dateWhere = (start && end)
    ? ' AND e.entry_date >= ? AND e.entry_date <= ?'
    : start ? ' AND e.entry_date >= ?' : end ? ' AND e.entry_date <= ?' : ''

  if (center) { binds.push(Number(center)) }
  const centerWhere = center ? ' AND l.center_code = ?' : ''

  // Total count for pagination
  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) as count ${fromClause} ${dateWhere} ${centerWhere}`).bind(...binds).first<{ count: number }>()
  const total = countRow?.count ?? 0
  const totalPages = Math.ceil(total / size)

  const offset = (page - 1) * size

  const sql = `
    SELECT
      l.id,
      l.entry_id,
      l.account_code,
      e.entry_date,
      e.entry_number,
      e.description AS entry_desc,
      e.ref_type,
      e.ref_id,
      l.debit,
      l.credit,
      l.description AS narration,
      l.center_code,
      cc.name_ar as center_name,
      l.season_id,
      s.name AS season_name,
      l.field_id,
      f.name AS field_name,
      CASE WHEN (SELECT id FROM business_events WHERE source_module = e.ref_type AND source_id = e.ref_id LIMIT 1) IS NOT NULL THEN 1 ELSE 0 END as has_trace
    ${fromClause} ${dateWhere} ${centerWhere}
    ORDER BY e.entry_date, l.id
    LIMIT ? OFFSET ?
  `

  const rows = await c.env.DB.prepare(sql).bind(...binds, size, offset).all()

  let openingDr = 0, openingCr = 0
  if (start) {
    const op = await c.env.DB.prepare(
      `SELECT SUM(l.debit) AS dr, SUM(l.credit) AS cr
       FROM journal_entry_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.company_id = ? AND l.account_code ${leafOnly ? '=' : 'LIKE'} ?
         AND e.is_posted = 1 AND e.entry_date < ? ${centerWhere}`
    ).bind(company_id, leafOnly ? accountCode : `${accountCode}%`, start, ...(center ? [Number(center)] : [])).first<{ dr: number | null; cr: number | null }>()
    openingDr = op?.dr ?? 0
    openingCr = op?.cr ?? 0
  }

  const openingBalance = account.normal_balance === 'credit' ? openingCr - openingDr : openingDr - openingCr

  // Compute running balance
  let running = openingBalance
  const lines = rows.results.map((r: any) => {
    const dr = r.debit ?? 0
    const cr = r.credit ?? 0
    running += account.normal_balance === 'credit' ? (cr - dr) : (dr - cr)
    return {
      ...r,
      has_trace: !!r.has_trace,
      running_balance: running
    }
  })

  // Notice we return these properties directly at the top level
  // because `unwrap` inside glApi.ledger handles it depending on structure.
  return c.json({
    success: true,
    data: {
      account,
      lines,
      total,
      page,
      size,
      total_pages: totalPages,
      opening_balance: openingBalance,
    }
  })
})

// =============================================================================
// TRIAL BALANCE
// =============================================================================

// GET /api/gl/trial-balance
reports.get('/trial-balance', async (c) => {
  const { company_id } = getUser(c)
  const asOf = c.req.query('as_of') ?? getTodayIsoDate()
  const { results } = await c.env.DB.prepare(
    `WITH RECURSIVE tree AS (
      SELECT code, parent_code, name, account_type, normal_balance, is_header, 0 AS depth
      FROM chart_of_accounts
      WHERE company_id = ?
      UNION ALL
      SELECT p.code, p.parent_code, p.name, p.account_type, p.normal_balance, p.is_header, t.depth + 1
      FROM chart_of_accounts p
      JOIN tree t ON t.parent_code = p.code
      WHERE p.company_id = ?
    ),
    balances AS (
      SELECT
        l.account_code,
        SUM(CASE WHEN l.debit  IS NOT NULL THEN l.debit  ELSE 0 END) AS total_debit,
        SUM(CASE WHEN l.credit IS NOT NULL THEN l.credit ELSE 0 END) AS total_credit
      FROM journal_entry_lines l
      JOIN journal_entries e ON e.id = l.entry_id AND e.company_id = l.company_id AND e.is_posted = 1
      WHERE l.company_id = ? AND e.entry_date <= ?
      GROUP BY l.account_code
    )
    SELECT
      t.code,
      t.name,
      t.account_type,
      t.normal_balance,
      t.is_header,
      t.depth,
      COALESCE(b.total_debit, 0) AS total_debit,
      COALESCE(b.total_credit, 0) AS total_credit,
      CASE
        WHEN t.normal_balance = 'debit'  THEN COALESCE(b.total_debit, 0) - COALESCE(b.total_credit, 0)
        WHEN t.normal_balance = 'credit' THEN COALESCE(b.total_credit, 0) - COALESCE(b.total_debit, 0)
        ELSE COALESCE(b.total_debit, 0) - COALESCE(b.total_credit, 0)
      END AS balance
    FROM tree t
    LEFT JOIN balances b ON b.account_code = t.code
    ORDER BY t.code`
  ).bind(company_id, company_id, company_id, asOf).all()
  return c.json({ success: true, as_of: asOf, data: results })
})

// GET /api/gl/trial-balance-fast
reports.get('/trial-balance-fast', async (c) => {
  const { company_id } = getUser(c)
  const asOf = c.req.query('as_of') ?? getTodayIsoDate()

  // Try materialized view first
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT
         a.code,
         a.name,
         a.account_type,
         a.normal_balance,
         a.is_header,
         COALESCE(SUM(CASE WHEN je.entry_date <= ? THEN l.debit ELSE 0 END), 0) AS total_debit,
         COALESCE(SUM(CASE WHEN je.entry_date <= ? THEN l.credit ELSE 0 END), 0) AS total_credit
       FROM chart_of_accounts a
       LEFT JOIN journal_entry_lines l ON l.account_code = a.code AND l.company_id = a.company_id
       LEFT JOIN journal_entries je ON je.id = l.entry_id AND je.company_id = l.company_id AND je.is_posted = 1
       WHERE a.company_id = ?
       GROUP BY a.code, a.name, a.account_type, a.normal_balance, a.is_header
       ORDER BY a.code`
    ).bind(asOf, asOf, company_id).all()

    return c.json({
      success: true,
      source: 'computed',
      as_of: asOf,
      data: results,
    })
  } catch {
    // Fallback to simple query
    const { results } = await c.env.DB.prepare(
      `SELECT
         code,
         name,
         account_type,
         normal_balance,
         is_header,
         0 AS total_debit,
         0 AS total_credit
       FROM chart_of_accounts
       WHERE company_id = ?
       ORDER BY code`
    ).bind(company_id).all()
    return c.json({ success: true, source: 'fallback', as_of: asOf, data: results })
  }
})

// =============================================================================
// INCOME STATEMENT
// =============================================================================

// GET /api/gl/income-statement
reports.get('/income-statement', async (c) => {
  const { company_id } = getUser(c)
  const start = c.req.query('start')
  const end = c.req.query('end')
  if (!start || !end) return c.json({ success: false, error: 'start and end required' }, 400)

  const accts = await c.env.DB.prepare(
    'SELECT code, parent_code, name, account_type, normal_balance FROM chart_of_accounts WHERE company_id = ?'
  ).bind(company_id).all<{ code: string; parent_code: string | null; name: string; account_type: string; normal_balance: string }>()

  const descMap = buildDescendants(accts.results.map(a => ({ code: a.code, parent_code: a.parent_code })))

  const { results: moves } = await c.env.DB.prepare(
    `SELECT l.account_code,
            SUM(l.debit)  AS total_debit,
            SUM(l.credit) AS total_credit
     FROM journal_entry_lines l
     JOIN journal_entries e ON e.id = l.entry_id AND e.company_id = l.company_id AND e.is_posted = 1
     WHERE l.company_id = ? AND e.entry_date >= ? AND e.entry_date <= ?
     GROUP BY l.account_code`
  ).bind(company_id, start, end).all<{ account_code: string; total_debit: number; total_credit: number }>()

  const moveByAccount = new Map<string, { dr: number; cr: number }>()
  for (const m of moves) moveByAccount.set(m.account_code, { dr: m.total_debit, cr: m.total_credit })

  const roll = (code: string): { dr: number; cr: number } => {
    const ds = descMap.get(code) ?? new Set([code])
    let dr = 0, cr = 0
    for (const d of ds) {
      const v = moveByAccount.get(d)
      if (v) { dr += v.dr; cr += v.cr }
    }
    return { dr, cr }
  }

  const rows = accts.results
    .filter(a => ['revenue','expense'].includes(a.account_type))
    .map(a => {
      const r = roll(a.code)
      const signed = a.normal_balance === 'credit' ? r.cr - r.dr : r.dr - r.cr
      return { code: a.code, name: a.name, type: a.account_type, debit: r.dr, credit: r.cr, signed }
    })

  const revenue = rows.filter(r => r.type === 'revenue').reduce((s, r) => s + r.signed, 0)
  const expense = rows.filter(r => r.type === 'expense').reduce((s, r) => s + r.signed, 0)
  const netIncome = revenue - expense

  return c.json({
    success: true,
    period: { start, end },
    summary: { revenue, expense, net_income: netIncome },
    accounts: rows,
  })
})

// =============================================================================
// BALANCE SHEET
// =============================================================================

// GET /api/gl/balance-sheet
reports.get('/balance-sheet', async (c) => {
  const { company_id } = getUser(c)
  const asOf = c.req.query('as_of') ?? getTodayIsoDate()

  const accts = await c.env.DB.prepare(
    'SELECT code, parent_code, name, account_type, normal_balance FROM chart_of_accounts WHERE company_id = ?'
  ).bind(company_id).all<{ code: string; parent_code: string | null; name: string; account_type: string; normal_balance: string }>()

  const descMap = buildDescendants(accts.results.map(a => ({ code: a.code, parent_code: a.parent_code })))

  const { results: moves } = await c.env.DB.prepare(
    `SELECT l.account_code,
            SUM(l.debit)  AS total_debit,
            SUM(l.credit) AS total_credit
     FROM journal_entry_lines l
     JOIN journal_entries e ON e.id = l.entry_id AND e.company_id = l.company_id AND e.is_posted = 1
     WHERE l.company_id = ? AND e.entry_date <= ?
     GROUP BY l.account_code`
  ).bind(company_id, asOf).all<{ account_code: string; total_debit: number; total_credit: number }>()

  const moveByAccount = new Map<string, { dr: number; cr: number }>()
  for (const m of moves) moveByAccount.set(m.account_code, { dr: m.total_debit, cr: m.total_credit })

  const roll = (code: string): { dr: number; cr: number } => {
    const ds = descMap.get(code) ?? new Set([code])
    let dr = 0, cr = 0
    for (const d of ds) {
      const v = moveByAccount.get(d)
      if (v) { dr += v.dr; cr += v.cr }
    }
    return { dr, cr }
  }

  const rows = accts.results
    .filter(a => ['asset','liability','equity'].includes(a.account_type))
    .map(a => {
      const r = roll(a.code)
      const signed = a.normal_balance === 'credit' ? r.cr - r.dr : r.dr - r.cr
      return { code: a.code, name: a.name, type: a.account_type, balance: signed }
    })

  const assets    = rows.filter(r => r.type === 'asset').reduce((s, r) => s + r.balance, 0)
  const liabilities = rows.filter(r => r.type === 'liability').reduce((s, r) => s + r.balance, 0)
  const equity    = rows.filter(r => r.type === 'equity').reduce((s, r) => s + r.balance, 0)
  const balanceCheck = assets - (liabilities + equity)

  return c.json({
    success: true,
    as_of: asOf,
    summary: { assets, liabilities, equity, balance_check: balanceCheck },
    accounts: rows,
  })
})

export default reports
