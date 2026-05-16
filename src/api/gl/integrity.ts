import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'

const integrity = new Hono<{ Bindings: Env }>()
integrity.use('*', authMiddleware)
integrity.use('*', roleGuard(['super_admin', 'company_admin', 'accountant', 'auditor']))

function parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

// GET /api/gl/integrity-check
integrity.get('/integrity-check', async (c) => {
  const { company_id } = getUser(c)
  const detailedQ = c.req.query('detailed')
  if (detailedQ != null && detailedQ !== '0' && detailedQ !== '1') {
    return c.json({ success: false, error: 'Invalid detailed flag, use 0 or 1' }, 400)
  }
  const detailed = detailedQ === '1'

  const checks = []

  // 1. Unbalanced entries
  const unbalanced = await c.env.DB.prepare(`
    SELECT je.id, je.entry_number, je.entry_date, je.description,
           ROUND(SUM(jel.debit), 2) AS total_debit,
           ROUND(SUM(jel.credit), 2) AS total_credit
    FROM journal_entries je
    JOIN journal_entry_lines jel ON jel.entry_id = je.id
    WHERE je.company_id = ?
    GROUP BY je.id
    HAVING ABS(ROUND(SUM(jel.debit), 2) - ROUND(SUM(jel.credit), 2)) > 0.01
    LIMIT ${detailed ? 50 : 1}
  `).bind(company_id).all()
  checks.push({
    name: 'unbalanced_entries',
    severity: 'critical',
    count: unbalanced.results.length,
    details: detailed ? unbalanced.results : undefined,
  })

  // 2. Orphan lines (no valid entry)
  const orphanLines = await c.env.DB.prepare(`
    SELECT l.id, l.entry_id, l.account_code, l.debit, l.credit
    FROM journal_entry_lines l
    LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.company_id = l.company_id
    WHERE l.company_id = ? AND e.id IS NULL
    LIMIT ${detailed ? 50 : 1}
  `).bind(company_id).all()
  checks.push({
    name: 'orphan_lines',
    severity: 'critical',
    count: orphanLines.results.length,
    details: detailed ? orphanLines.results : undefined,
  })

  // 3. Invalid account codes
  const invalidAccounts = await c.env.DB.prepare(`
    SELECT l.id, l.entry_id, l.account_code
    FROM journal_entry_lines l
    LEFT JOIN chart_of_accounts a ON a.code = l.account_code AND a.company_id = l.company_id
    WHERE l.company_id = ? AND a.code IS NULL
    LIMIT ${detailed ? 50 : 1}
  `).bind(company_id).all()
  checks.push({
    name: 'invalid_account_codes',
    severity: 'high',
    count: invalidAccounts.results.length,
    details: detailed ? invalidAccounts.results : undefined,
  })

  // 4. Inactive accounts with recent activity
  const inactiveActivity = await c.env.DB.prepare(`
    SELECT l.account_code, MAX(e.entry_date) AS last_activity_date, COUNT(*) AS activity_count
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id AND e.company_id = l.company_id AND e.is_posted = 1
    JOIN chart_of_accounts a ON a.code = l.account_code AND a.company_id = l.company_id
    WHERE l.company_id = ? AND a.is_active = 0
    GROUP BY l.account_code
    LIMIT ${detailed ? 50 : 1}
  `).bind(company_id).all()
  checks.push({
    name: 'inactive_account_activity',
    severity: 'medium',
    count: inactiveActivity.results.length,
    details: detailed ? inactiveActivity.results : undefined,
  })

  // 5. Duplicate entry numbers
  const dupEntries = await c.env.DB.prepare(`
    SELECT entry_number, COUNT(*) AS count
    FROM journal_entries
    WHERE company_id = ? AND entry_number IS NOT NULL
    GROUP BY entry_number
    HAVING COUNT(*) > 1
    LIMIT ${detailed ? 50 : 1}
  `).bind(company_id).all()
  checks.push({
    name: 'duplicate_entry_numbers',
    severity: 'medium',
    count: dupEntries.results.length,
    details: detailed ? dupEntries.results : undefined,
  })

  // 6. Entries in closed periods
  const closedPeriodEntries = await c.env.DB.prepare(`
    SELECT je.id, je.entry_number, je.entry_date, fp.name AS period_name
    FROM journal_entries je
    JOIN financial_periods fp ON fp.id = je.period_id AND fp.company_id = je.company_id
    WHERE je.company_id = ? AND fp.is_closed = 1
    LIMIT ${detailed ? 50 : 1}
  `).bind(company_id).all()
  checks.push({
    name: 'entries_in_closed_periods',
    severity: 'high',
    count: closedPeriodEntries.results.length,
    details: detailed ? closedPeriodEntries.results : undefined,
  })

  const criticalCount = checks.filter(c => c.severity === 'critical' && c.count > 0).length
  const highCount = checks.filter(c => c.severity === 'high' && c.count > 0).length
  const mediumCount = checks.filter(c => c.severity === 'medium' && c.count > 0).length
  const totalIssues = checks.reduce((s, c) => s + c.count, 0)

  const healthScore = Math.max(0, 100 - (criticalCount * 25) - (highCount * 10) - (mediumCount * 5))

  // Persist result to finance_health_log (fire-and-forget, never block the response)
  void c.env.DB.prepare(`
    INSERT INTO finance_health_log
      (company_id, health_score, total_issues, critical_count, high_count, medium_count, checks_json, triggered_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    company_id,
    healthScore,
    totalIssues,
    criticalCount,
    highCount,
    mediumCount,
    JSON.stringify(checks.map(ch => ({ name: ch.name, severity: ch.severity, count: ch.count }))),
    'api',
  ).run().catch((err: unknown) => {
    // Log but don't surface — health_log write failure must not break the integrity check response
    console.error('finance_health_log insert failed:', err)
  })

  return c.json({
    success: true,
    health_score: healthScore,
    summary: {
      total_issues: totalIssues,
      critical: criticalCount,
      high: highCount,
      medium: mediumCount,
    },
    checks,
  })
})

// GET /api/gl/health-history
integrity.get('/health-history', async (c) => {
  const { company_id } = getUser(c)
  const days = Math.min(90, Math.max(1, Number(c.req.query('days') ?? 7)))

  const rows = await c.env.DB.prepare(`
    SELECT id, checked_at, health_score, total_issues, critical_count, high_count, medium_count, triggered_by
    FROM finance_health_log
    WHERE company_id = ?
      AND checked_at >= datetime('now', ? || ' days')
    ORDER BY checked_at DESC
    LIMIT 500
  `).bind(company_id, `-${days}`).all<{
    id: number
    checked_at: string
    health_score: number
    total_issues: number
    critical_count: number
    high_count: number
    medium_count: number
    triggered_by: string
  }>()

  return c.json({
    success: true,
    data: {
      days,
      total: rows.results.length,
      entries: rows.results,
    },
  })
})

// GET /api/gl/audit-log
integrity.get('/audit-log', async (c) => {
  const { company_id } = getUser(c)
  const page = parsePositiveInt(c.req.query('page'), 1, 1, 100_000)
  const size = parsePositiveInt(c.req.query('size'), 50, 1, 100)
  const offset = (page - 1) * size
  const table = c.req.query('table')
  const action = c.req.query('action')
  const from = c.req.query('from')
  const to = c.req.query('to')

  let where = 'WHERE al.company_id = ?'
  const binds: unknown[] = [company_id]

  if (table)  { where += ' AND al.table_name = ?'; binds.push(table) }
  if (action) { where += ' AND al.action = ?'; binds.push(action) }
  if (from)   { where += ' AND al.created_at >= ?'; binds.push(from) }
  if (to)     { where += ' AND al.created_at <= ?'; binds.push(to) }

  const [rows, totalRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT al.*, u.email AS user_email, u.full_name AS user_name
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.user_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(...binds, size, offset).all(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log al ${where}`).bind(...binds).first<{ n: number }>(),
  ])

  const total = totalRow?.n ?? 0
  return c.json({
    success: true,
    data: rows.results,
    total,
    page,
    page_size: size,
    has_more: page * size < total,
  })
})

// GET /api/gl/system-integrity-score
integrity.get('/system-integrity-score', async (c) => {
  const { company_id } = getUser(c)

  const [
    totalEntries,
    postedEntries,
    unbalanced,
    orphanLines,
    missingPeriods,
    invalidAccounts,
  ] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM journal_entries WHERE company_id = ?').bind(company_id).first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM journal_entries WHERE company_id = ? AND is_posted = 1').bind(company_id).first<{ n: number }>(),
    c.env.DB.prepare(`
      SELECT COUNT(*) AS n FROM (
        SELECT je.id FROM journal_entries je
        JOIN journal_entry_lines jel ON jel.entry_id = je.id
        WHERE je.company_id = ?
        GROUP BY je.id
        HAVING ABS(ROUND(SUM(jel.debit), 2) - ROUND(SUM(jel.credit), 2)) > 0.01
      )
    `).bind(company_id).first<{ n: number }>(),
    c.env.DB.prepare(`
      SELECT COUNT(*) AS n FROM journal_entry_lines l
      LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.company_id = l.company_id
      WHERE l.company_id = ? AND e.id IS NULL
    `).bind(company_id).first<{ n: number }>(),
    c.env.DB.prepare(`
      SELECT COUNT(*) AS n FROM journal_entries je
      WHERE je.company_id = ? AND je.period_id IS NULL
    `).bind(company_id).first<{ n: number }>(),
    c.env.DB.prepare(`
      SELECT COUNT(*) AS n FROM journal_entry_lines l
      LEFT JOIN chart_of_accounts a ON a.code = l.account_code AND a.company_id = l.company_id
      WHERE l.company_id = ? AND a.code IS NULL
    `).bind(company_id).first<{ n: number }>(),
  ])

  const metrics = {
    total_entries: totalEntries?.n ?? 0,
    posted_entries: postedEntries?.n ?? 0,
    unbalanced_entries: unbalanced?.n ?? 0,
    orphan_lines: orphanLines?.n ?? 0,
    missing_periods: missingPeriods?.n ?? 0,
    invalid_accounts: invalidAccounts?.n ?? 0,
  }

  let score = 100
  if (metrics.unbalanced_entries > 0) score -= Math.min(40, metrics.unbalanced_entries * 2)
  if (metrics.orphan_lines > 0) score -= Math.min(30, metrics.orphan_lines * 2)
  if (metrics.missing_periods > 0) score -= Math.min(15, metrics.missing_periods)
  if (metrics.invalid_accounts > 0) score -= Math.min(15, metrics.invalid_accounts)

  const normalizedScore = Math.max(0, score)

  return c.json({
    success: true,
    overall_score: normalizedScore,
    score: normalizedScore,
    status: normalizedScore >= 90 ? 'excellent' : normalizedScore >= 70 ? 'good' : normalizedScore >= 50 ? 'fair' : 'poor',
    metrics,
  })
})

// GET /api/gl/orphans
integrity.get('/orphans', async (c) => {
  const { company_id } = getUser(c)
  const limit = Math.min(100, Number(c.req.query('limit') ?? 50))

  const [rows, totalRow] = await Promise.all([
    c.env.DB.prepare(`
      SELECT
        je.id,
        je.entry_date,
        je.description,
        je.ref_type,
        je.ref_id,
        ROUND(SUM(jel.debit), 2)  AS debit_total,
        ROUND(SUM(jel.credit), 2) AS credit_total,
        ROUND(ABS(SUM(jel.debit) - SUM(jel.credit)), 2) AS diff
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.entry_id = je.id
      WHERE je.company_id = ?
      GROUP BY je.id
      HAVING ABS(SUM(jel.debit) - SUM(jel.credit)) > 0.01
      ORDER BY diff DESC, je.id DESC
      LIMIT ?
    `).bind(company_id, limit).all<{
      id: number
      entry_date: string
      description: string | null
      ref_type: string | null
      ref_id: number | null
      debit_total: number
      credit_total: number
      diff: number
    }>(),
    c.env.DB.prepare(`
      SELECT COUNT(*) AS n
      FROM (
        SELECT je.id
        FROM journal_entries je
        JOIN journal_entry_lines jel ON jel.entry_id = je.id
        WHERE je.company_id = ?
        GROUP BY je.id
        HAVING ABS(SUM(jel.debit) - SUM(jel.credit)) > 0.01
      ) t
    `).bind(company_id).first<{ n: number }>(),
  ])

  const total = totalRow?.n ?? 0

  return c.json({
    success: true,
    total,
    rows: rows.results,
    // Backward-compatible aliases for older consumers
    count: total,
    orphans: rows.results,
  })
})

export default integrity
