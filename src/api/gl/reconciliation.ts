import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'

const reconciliation = new Hono<{ Bindings: Env }>()
reconciliation.use('*', authMiddleware)
reconciliation.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

// GET /api/gl/reconciliation/source-documents
reconciliation.get('/source-documents', async (c) => {
  const { company_id } = getUser(c)
  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const size = Math.min(200, Math.max(1, Number(c.req.query('size') ?? 50)))
  const offset = (page - 1) * size
  const sourceModule = c.req.query('source_module')
  const status = c.req.query('status')
  const from = c.req.query('from')
  const to = c.req.query('to')
  const mismatchOnly = c.req.query('mismatch_only') === '1'

  let baseWhere = 'WHERE sd.company_id = ?'
  const binds: unknown[] = [company_id]

  if (sourceModule) { baseWhere += ' AND sd.source_module = ?'; binds.push(sourceModule) }
  if (status) { baseWhere += ' AND sd.status = ?'; binds.push(status) }
  if (from) { baseWhere += ' AND sd.event_date >= ?'; binds.push(from) }
  if (to) { baseWhere += ' AND sd.event_date <= ?'; binds.push(to) }

  const mismatchClause = `(
    be.id IS NULL OR
    sdl.journal_entry_id IS NULL OR
    (be.journal_entry_id IS NOT NULL AND sdl.journal_entry_id IS NOT NULL AND be.journal_entry_id != sdl.journal_entry_id) OR
    (sd.status = 'posted' AND sdl.journal_entry_id IS NULL)
  )`
  const joinedWhere = mismatchOnly ? `${baseWhere} AND ${mismatchClause}` : baseWhere

  const [rows, countRow, summaryRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT sd.id,
              sd.source_module,
              sd.source_id,
              sd.document_type,
              sd.event_id,
              sd.event_date,
              sd.status AS source_document_status,
              be.status AS business_event_status,
              be.journal_entry_id AS business_event_journal_entry_id,
              sdl.journal_entry_id AS linked_journal_entry_id,
              je.entry_date AS linked_entry_date,
              je.description AS linked_entry_description,
              CASE WHEN be.id IS NULL THEN 0 ELSE 1 END AS has_business_event,
              CASE WHEN sdl.journal_entry_id IS NULL THEN 0 ELSE 1 END AS has_journal_link,
              CASE
                WHEN be.id IS NULL THEN 'missing_business_event'
                WHEN sdl.journal_entry_id IS NULL THEN 'missing_journal_link'
                WHEN be.journal_entry_id IS NOT NULL AND sdl.journal_entry_id IS NOT NULL AND be.journal_entry_id != sdl.journal_entry_id THEN 'event_link_mismatch'
                WHEN sd.status = 'posted' AND sdl.journal_entry_id IS NULL THEN 'posted_without_journal'
                ELSE 'ok'
              END AS reconciliation_status
       FROM source_documents sd
       LEFT JOIN business_events be
         ON be.id = sd.event_id
        AND be.company_id = sd.company_id
       LEFT JOIN source_document_links sdl
         ON sdl.source_document_id = sd.id
        AND sdl.company_id = sd.company_id
        AND sdl.link_type = 'primary'
       LEFT JOIN journal_entries je
         ON je.id = sdl.journal_entry_id
        AND je.company_id = sd.company_id
       ${joinedWhere}
       ORDER BY sd.event_date DESC, sd.id DESC
       LIMIT ? OFFSET ?`
    ).bind(...binds, size, offset).all(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS n
       FROM source_documents sd
       LEFT JOIN business_events be
         ON be.id = sd.event_id
        AND be.company_id = sd.company_id
       LEFT JOIN source_document_links sdl
         ON sdl.source_document_id = sd.id
        AND sdl.company_id = sd.company_id
        AND sdl.link_type = 'primary'
       ${joinedWhere}`
    ).bind(...binds).first<{ n: number }>(),

    c.env.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN be.id IS NULL THEN 1 ELSE 0 END) AS missing_business_event,
         SUM(CASE WHEN sdl.journal_entry_id IS NULL THEN 1 ELSE 0 END) AS missing_journal_link,
         SUM(CASE WHEN be.journal_entry_id IS NOT NULL AND sdl.journal_entry_id IS NOT NULL AND be.journal_entry_id != sdl.journal_entry_id THEN 1 ELSE 0 END) AS event_link_mismatch,
         SUM(CASE WHEN sd.status = 'posted' AND sdl.journal_entry_id IS NULL THEN 1 ELSE 0 END) AS posted_without_journal,
         SUM(CASE WHEN be.id IS NOT NULL AND sdl.journal_entry_id IS NOT NULL AND (be.journal_entry_id IS NULL OR be.journal_entry_id = sdl.journal_entry_id) THEN 1 ELSE 0 END) AS fully_linked
       FROM source_documents sd
       LEFT JOIN business_events be
         ON be.id = sd.event_id
        AND be.company_id = sd.company_id
       LEFT JOIN source_document_links sdl
         ON sdl.source_document_id = sd.id
        AND sdl.company_id = sd.company_id
        AND sdl.link_type = 'primary'
       ${joinedWhere}`
    ).bind(...binds).first<{
      total: number
      missing_business_event: number
      missing_journal_link: number
      event_link_mismatch: number
      posted_without_journal: number
      fully_linked: number
    }>(),
  ])

  return c.json({
    success: true,
    data: rows.results,
    total: countRow?.n ?? 0,
    page,
    page_size: size,
    summary: summaryRow ?? {
      total: 0,
      missing_business_event: 0,
      missing_journal_link: 0,
      event_link_mismatch: 0,
      posted_without_journal: 0,
      fully_linked: 0,
    },
  })
})

// ── GET /api/gl/reconciliation/integrity ─────────────────────────────────────
// Full GL integrity audit. Returns 5 checks:
//   1. unbalanced_entries  — journal entries where SUM(debit) ≠ SUM(credit)
//   2. phantom_accounts    — journal_entry_lines referencing codes not in chart_of_accounts
//   3. ops_gl_gap          — operational modules with amounts that don't match GL
//   4. missing_period      — entries with no accounting period assigned
//   5. duplicate_events    — business events posted more than once to GL

reconciliation.get('/integrity', async (c) => {
  const { company_id } = getUser(c)

  const [
    unbalancedRows,
    phantomRows,
    opsGapRow,
    missingPeriodRow,
    duplicateEventRows,
  ] = await Promise.all([

    // 1. Unbalanced journal entries (DR ≠ CR by more than 0.01 rounding tolerance)
    c.env.DB.prepare(
      `SELECT
         je.id,
         je.entry_number,
         je.entry_date,
         je.description,
         je.ref_type AS source_module,
         ROUND(SUM(jel.debit),  2) AS total_dr,
         ROUND(SUM(jel.credit), 2) AS total_cr,
         ROUND(ABS(SUM(jel.debit) - SUM(jel.credit)), 4) AS imbalance
       FROM journal_entries je
       JOIN journal_entry_lines jel ON jel.entry_id = je.id
       WHERE je.company_id = ?
       GROUP BY je.id
       HAVING ABS(SUM(jel.debit) - SUM(jel.credit)) > 0.01
       ORDER BY imbalance DESC
       LIMIT 100`
    ).bind(company_id).all<{
      id: number; entry_number: string | null; entry_date: string
      description: string | null; source_module: string | null
      total_dr: number; total_cr: number; imbalance: number
    }>(),

    // 2. Journal lines referencing account codes not in chart_of_accounts
    c.env.DB.prepare(
      `SELECT DISTINCT
         jel.account_code,
         COUNT(*)                AS line_count,
         ROUND(SUM(jel.debit - jel.credit), 2) AS net_impact,
         MIN(je.entry_date)      AS first_seen,
         MAX(je.entry_date)      AS last_seen
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = ?
       LEFT JOIN chart_of_accounts coa
         ON coa.company_id = je.company_id AND coa.code = jel.account_code
       WHERE coa.id IS NULL
       GROUP BY jel.account_code
       ORDER BY line_count DESC
       LIMIT 50`
    ).bind(company_id).all<{
      account_code: string; line_count: number; net_impact: number
      first_seen: string; last_seen: string
    }>(),

    // 3. Ops-vs-GL gap: compare operational module totals to GL by source_ledger
    c.env.DB.prepare(
      `SELECT
         -- Cash transactions
         ROUND((SELECT COALESCE(SUM(ABS(ct.amount)),0)
                FROM cash_transactions ct
                WHERE ct.company_id = ? AND ct.journal_entry_id IS NOT NULL), 2)   AS cash_ops_posted,
         ROUND((SELECT COALESCE(SUM(ABS(jel.debit - jel.credit)),0)
                FROM journal_entry_lines jel
                JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = ?
                WHERE jel.source_ledger = 'cash'), 2)                             AS cash_gl_total,

         -- Supplier transactions
         ROUND((SELECT COALESCE(SUM(ABS(st.amount)),0)
                FROM supplier_transactions st
                WHERE st.company_id = ? AND st.journal_entry_id IS NOT NULL), 2)  AS supplier_ops_posted,
         ROUND((SELECT COALESCE(SUM(ABS(jel.debit - jel.credit)),0)
                FROM journal_entry_lines jel
                JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = ?
                WHERE jel.source_ledger = 'supplier'), 2)                         AS supplier_gl_total,

         -- Inventory movements
         ROUND((SELECT COALESCE(SUM(COALESCE(im.value_in,0) + COALESCE(im.value_out,0)),0)
                FROM inventory_movements im
                WHERE im.company_id = ? AND im.gl_posting_status = 'posted'
                  AND im.journal_entry_id IS NOT NULL), 2)                        AS inventory_ops_posted,
         ROUND((SELECT COALESCE(SUM(ABS(jel.debit - jel.credit)),0)
                FROM journal_entry_lines jel
                JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = ?
                WHERE jel.source_ledger = 'inventory'), 2)                        AS inventory_gl_total`
    ).bind(
      company_id, company_id,
      company_id, company_id,
      company_id, company_id,
    ).first<{
      cash_ops_posted: number; cash_gl_total: number
      supplier_ops_posted: number; supplier_gl_total: number
      inventory_ops_posted: number; inventory_gl_total: number
    }>(),

    // 4. Entries with no period assigned
    c.env.DB.prepare(
      `SELECT COUNT(*) AS cnt,
              ROUND(SUM(jel.debit), 2) AS total_debit
       FROM journal_entries je
       JOIN journal_entry_lines jel ON jel.entry_id = je.id
       WHERE je.company_id = ? AND je.period_id IS NULL`
    ).bind(company_id).first<{ cnt: number; total_debit: number }>(),

    // 5. Business events posted more than once (duplicate GL entries for same source)
    c.env.DB.prepare(
      `SELECT
         event_type,
         source_module,
         source_id,
         COUNT(DISTINCT journal_entry_id) AS entry_count
       FROM business_events
       WHERE company_id = ?
         AND journal_entry_id IS NOT NULL
       GROUP BY event_type, source_module, source_id
       HAVING COUNT(DISTINCT journal_entry_id) > 1
       ORDER BY entry_count DESC
       LIMIT 50`
    ).bind(company_id).all<{
      event_type: string; source_module: string
      source_id: number; entry_count: number
    }>(),
  ])

  const ops = opsGapRow ?? {
    cash_ops_posted: 0, cash_gl_total: 0,
    supplier_ops_posted: 0, supplier_gl_total: 0,
    inventory_ops_posted: 0, inventory_gl_total: 0,
  }

  const cashGap      = Math.abs(ops.cash_ops_posted - ops.cash_gl_total)
  const supplierGap  = Math.abs(ops.supplier_ops_posted - ops.supplier_gl_total)
  const inventoryGap = Math.abs(ops.inventory_ops_posted - ops.inventory_gl_total)

  const criticalIssues = (
    unbalancedRows.results.length +
    (phantomRows.results.length > 0 ? 1 : 0) +
    (cashGap > 1 ? 1 : 0) +
    (supplierGap > 1 ? 1 : 0) +
    (inventoryGap > 1 ? 1 : 0) +
    duplicateEventRows.results.length
  )

  return c.json({
    success: true,
    data: {
      health: criticalIssues === 0 ? 'clean' : criticalIssues <= 3 ? 'warning' : 'critical',
      critical_issues: criticalIssues,
      generated_at: new Date().toISOString(),

      unbalanced_entries: {
        count: unbalancedRows.results.length,
        rows:  unbalancedRows.results,
      },

      phantom_accounts: {
        count: phantomRows.results.length,
        rows:  phantomRows.results,
        note:  phantomRows.results.length > 0
          ? 'These account codes exist in journal_entry_lines but not in chart_of_accounts. Run migration 0080 to seed missing CoA accounts.'
          : null,
      },

      ops_vs_gl: {
        cash:      { ops_total: ops.cash_ops_posted,      gl_total: ops.cash_gl_total,      gap: cashGap,      ok: cashGap <= 1 },
        suppliers: { ops_total: ops.supplier_ops_posted,  gl_total: ops.supplier_gl_total,  gap: supplierGap,  ok: supplierGap <= 1 },
        inventory: { ops_total: ops.inventory_ops_posted, gl_total: ops.inventory_gl_total, gap: inventoryGap, ok: inventoryGap <= 1 },
        note: 'Gap > 1 EGP means operational records have been posted but journal amounts differ. Likely caused by phantom accounts or partial posting failures.',
      },

      missing_period: {
        entry_count: missingPeriodRow?.cnt ?? 0,
        total_debit: missingPeriodRow?.total_debit ?? 0,
        note: (missingPeriodRow?.cnt ?? 0) > 0
          ? 'Entries without a period cannot be included in period-close reports.'
          : null,
      },

      duplicate_events: {
        count: duplicateEventRows.results.length,
        rows:  duplicateEventRows.results,
        note:  duplicateEventRows.results.length > 0
          ? 'Same source event has multiple GL entries. Review and reverse duplicates manually.'
          : null,
      },
    },
  })
})

// ── GET /api/gl/reconciliation/trial-balance ──────────────────────────────────
// Full trial balance: every account with a non-zero balance, summed from
// journal_entry_lines. Optionally filtered by date range.

reconciliation.get('/trial-balance', async (c) => {
  const { company_id } = getUser(c)
  const from = c.req.query('from') ?? ''
  const to   = c.req.query('to')   ?? ''

  const dateFilter = from && to
    ? `AND je.entry_date BETWEEN ? AND ?`
    : from ? `AND je.entry_date >= ?`
    : to   ? `AND je.entry_date <= ?`
    : ''
  const dateBinds = from && to ? [from, to] : from ? [from] : to ? [to] : []

  const { results } = await c.env.DB.prepare(
    `SELECT
       jel.account_code,
       coa.name           AS account_name,
       coa.account_type,
       coa.normal_balance,
       ROUND(SUM(jel.debit),  2) AS total_debit,
       ROUND(SUM(jel.credit), 2) AS total_credit,
       ROUND(SUM(jel.debit) - SUM(jel.credit), 2) AS net_balance,
       COUNT(DISTINCT je.id)     AS entry_count
     FROM journal_entry_lines jel
     JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = ?
     LEFT JOIN chart_of_accounts coa
       ON coa.company_id = je.company_id AND coa.code = jel.account_code
     WHERE 1=1 ${dateFilter}
     GROUP BY jel.account_code
     HAVING ABS(SUM(jel.debit) - SUM(jel.credit)) > 0.001
     ORDER BY coa.account_type, jel.account_code`
  ).bind(company_id, ...dateBinds).all<{
    account_code: string; account_name: string | null
    account_type: string | null; normal_balance: string | null
    total_debit: number; total_credit: number
    net_balance: number; entry_count: number
  }>()

  const totalDR = results.reduce((s, r) => s + r.total_debit,  0)
  const totalCR = results.reduce((s, r) => s + r.total_credit, 0)

  return c.json({
    success: true,
    data: {
      rows:           results,
      totals:         { total_debit: Math.round(totalDR * 100) / 100, total_credit: Math.round(totalCR * 100) / 100 },
      is_balanced:    Math.abs(totalDR - totalCR) < 0.01,
      phantom_count:  results.filter(r => !r.account_name).length,
      date_range:     { from: from || null, to: to || null },
    },
  })
})

// ── POST /api/gl/reconciliation/repair-phantom-accounts ──────────────────────
// Promote phantom account codes found in journal_entry_lines into
// chart_of_accounts as unclassified placeholders so they become visible
// in the trial balance and don't block reporting.
// This is non-destructive — it never modifies existing GL lines.

reconciliation.post('/repair-phantom-accounts', async (c) => {
  const { company_id } = getUser(c)

  // Find phantom codes
  const { results: phantoms } = await c.env.DB.prepare(
    `SELECT DISTINCT jel.account_code
     FROM journal_entry_lines jel
     JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = ?
     LEFT JOIN chart_of_accounts coa
       ON coa.company_id = je.company_id AND coa.code = jel.account_code
     WHERE coa.id IS NULL`
  ).bind(company_id).all<{ account_code: string }>()

  if (!phantoms.length) {
    return c.json({ success: true, data: { inserted: 0, message: 'No phantom accounts found — GL is clean.' } })
  }

  const stmts = phantoms.map(p =>
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO chart_of_accounts
         (company_id, code, name, account_type, normal_balance, level, is_header, is_active)
       VALUES (?, ?, ?, 'expense', 'debit', 1, 0, 1)`
    ).bind(company_id, p.account_code, `[مستورد] حساب ${p.account_code}`)
  )

  await c.env.DB.batch(stmts)

  return c.json({
    success: true,
    data: {
      inserted: phantoms.length,
      codes:    phantoms.map(p => p.account_code),
      message:  `${phantoms.length} phantom accounts promoted to chart_of_accounts as unclassified placeholders. Review and reclassify each one.`,
    },
  })
})

// ── POST /api/gl/reconciliation/backfill-account-codes ───────────────────────
// Applies the phantom→real account code remapping from migration 0081 at
// runtime (for companies beyond company_id=1, or when re-running is needed).
// Only remaps lines whose target code exists in chart_of_accounts.
// Idempotent — safe to run multiple times.

reconciliation.post('/backfill-account-codes', async (c) => {
  const { company_id } = getUser(c)

  const REMAP: Array<{ from: string; to: string; label: string }> = [
    { from: '2100',  to: '212000010', label: 'accounts_payable' },
    { from: '2101',  to: '21200001',  label: 'wages_payable' },
    { from: '5100',  to: '51010001',  label: 'wages_expense' },
    { from: '1001',  to: '14010101',  label: 'cash' },
    { from: '5300',  to: '5503',      label: 'depreciation_expense' },
    { from: '6200',  to: '5503',      label: 'depreciation_expense_alt' },
    { from: '1590',  to: '2203',      label: 'accumulated_depreciation' },
    { from: '1690',  to: '2203',      label: 'accumulated_depreciation_alt' },
    { from: '1350',  to: '1302',      label: 'wip_asset' },
    { from: '3350',  to: '3001',      label: 'wip_contra' },
  ]

  const results: Array<{ from: string; to: string; label: string; rows_updated: number; skipped: boolean }> = []

  for (const map of REMAP) {
    const target = await c.env.DB.prepare(
      `SELECT 1 FROM chart_of_accounts WHERE company_id = ? AND code = ?`
    ).bind(company_id, map.to).first()

    if (!target) {
      results.push({ ...map, rows_updated: 0, skipped: true })
      continue
    }

    const r = await c.env.DB.prepare(
      `UPDATE journal_entry_lines
       SET account_code = ?
       WHERE account_code = ?
         AND entry_id IN (SELECT id FROM journal_entries WHERE company_id = ?)`
    ).bind(map.to, map.from, company_id).run()

    results.push({ ...map, rows_updated: r.meta.changes ?? 0, skipped: false })
  }

  const totalUpdated = results.reduce((s, r) => s + r.rows_updated, 0)

  return c.json({
    success: true,
    data: {
      total_lines_updated: totalUpdated,
      detail: results,
      message: totalUpdated > 0
        ? `تم تحديث ${totalUpdated} سطر محاسبي من الحسابات الوهمية إلى الحسابات الحقيقية.`
        : 'لا توجد سطور بحاجة إلى تحديث — البيانات نظيفة.',
    },
  })
})

export default reconciliation
