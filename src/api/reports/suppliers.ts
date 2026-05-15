import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser } from '../../middleware/auth'
import { getFlag, buildPostingMeta } from '../../lib/hardening'

const suppliers = new Hono<{ Bindings: Env }>()

type LegacyCoverage = {
  has_legacy_gaps: boolean
  posted_events_total: number
  covered_events: number
  missing_journal_link_events: number
  missing_supplier_code_events: number
  coverage_rate_pct: number
  notes: string
}

async function getLegacyCoverage(db: Env['DB'], companyId: number): Promise<LegacyCoverage> {
  const legacy = await db.prepare(
    `SELECT
       COUNT(*) AS posted_events_total,
       SUM(CASE WHEN journal_entry_id IS NULL THEN 1 ELSE 0 END) AS missing_journal_link_events,
       SUM(CASE WHEN json_extract(payload, '$.supplier_code') IS NULL THEN 1 ELSE 0 END) AS missing_supplier_code_events
     FROM business_events
     WHERE company_id = ?
       AND source_module = 'suppliers'
       AND status = 'posted'`
  ).bind(companyId).first<{
    posted_events_total: number | null
    missing_journal_link_events: number | null
    missing_supplier_code_events: number | null
  }>()

  const postedTotal = Number(legacy?.posted_events_total ?? 0)
  const missingJournal = Number(legacy?.missing_journal_link_events ?? 0)
  const missingSupplier = Number(legacy?.missing_supplier_code_events ?? 0)
  const covered = Math.max(postedTotal - missingJournal - missingSupplier, 0)

  return {
    has_legacy_gaps: missingJournal > 0 || missingSupplier > 0,
    posted_events_total: postedTotal,
    covered_events: covered,
    missing_journal_link_events: missingJournal,
    missing_supplier_code_events: missingSupplier,
    coverage_rate_pct: postedTotal > 0 ? Math.round((covered / postedTotal) * 10000) / 100 : 100,
    notes: 'Rows with missing supplier_code in old payloads are excluded from supplier-level projection.',
  }
}

async function buildUnifiedApProjection(
  db: Env['DB'],
  companyId: number,
  opts: { seasonId?: number | null; supplierCode?: number | null } = {},
) {
  const seasonId = opts.seasonId ?? null
  const supplierCode = opts.supplierCode ?? null
  const legacyCoverage = await getLegacyCoverage(db, companyId)

  const ap = await db.prepare(
    `SELECT account_code
     FROM posting_rules
     WHERE company_id = ?
       AND rule_type = 'control'
       AND mapping_key IN ('accounts_payable', 'wages_payable')
       AND is_active = 1
     ORDER BY CASE WHEN mapping_key = 'accounts_payable' THEN 0 ELSE 1 END,
              priority ASC,
              id DESC
     LIMIT 1`
  ).bind(companyId).first<{ account_code: string }>()

  if (!ap?.account_code) {
    return {
      ok: false as const,
      error: 'No active control mapping found for accounts_payable/wages_payable in posting_rules',
      code: 'MISSING_AP_CONTROL_MAPPING',
      legacyCoverage,
    }
  }

  const seasonWhere = seasonId ? 'AND jl.season_id = ?' : ''
  const supplierWhere = supplierCode ? 'AND s.code = ?' : ''

  const rowsBinds: unknown[] = [
    companyId,
    ...(seasonId ? [seasonId] : []),
    ap.account_code,
    ap.account_code,
    ap.account_code,
    companyId,
    ...(supplierCode ? [supplierCode] : []),
  ]

  const { results: rows } = await db.prepare(
    `WITH event_lines AS (
       SELECT
         CAST(json_extract(be.payload, '$.supplier_code') AS INTEGER) AS supplier_code,
         je.id AS journal_entry_id,
         jl.account_code,
         jl.credit,
         jl.debit
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
     ),
     gl_by_supplier AS (
       SELECT
         supplier_code,
         COALESCE(SUM(CASE WHEN account_code = ? THEN credit ELSE 0 END), 0) AS total_credit,
         COALESCE(SUM(CASE WHEN account_code = ? THEN debit  ELSE 0 END), 0) AS total_debit,
         COUNT(DISTINCT journal_entry_id) AS tx_count
       FROM event_lines
       GROUP BY supplier_code
     )
     SELECT
       s.code,
       s.name,
       s.activity,
       COALESCE(g.total_credit, 0) AS total_credit,
       COALESCE(g.total_debit,  0) AS total_debit,
       COALESCE(g.total_credit - g.total_debit, 0) AS balance,
       COALESCE(g.total_credit - g.total_debit, 0) AS last_balance,
       COALESCE(g.tx_count, 0) AS tx_count,
       'gl_business_events_unified_ap_v2' AS data_source,
       ? AS control_account
     FROM suppliers s
     LEFT JOIN gl_by_supplier g ON g.supplier_code = s.code
     WHERE s.company_id = ?
       ${supplierWhere}
     ORDER BY ABS(balance) DESC`
  ).bind(...rowsBinds).all<{
    code: number
    name: string
    activity: string | null
    total_credit: number
    total_debit: number
    balance: number
    last_balance: number
    tx_count: number
    data_source: string
    control_account: string
  }>()

  return {
    ok: true as const,
    rows,
    controlAccount: ap.account_code,
    legacyCoverage,
  }
}

suppliers.get('/supplier-payments', async (c) => {
  const { company_id } = getUser(c)
  const supplierCode = c.req.query('supplier_code') ? Number(c.req.query('supplier_code')) : null
  const seasonId     = c.req.query('season_id')     ? Number(c.req.query('season_id'))     : null

  // buildUnifiedApProjection summary
  const unified = await buildUnifiedApProjection(c.env.DB, company_id, { seasonId, supplierCode })

  const stConds: string[] = ['st.company_id = ?', "st.status = 'posted'"]
  const stBinds: unknown[] = [company_id]

  if (supplierCode) {
    stConds.push('st.supplier_code = ?')
    stBinds.push(supplierCode)
  }

  if (seasonId) {
    stConds.push('st.season_id = ?')
    stBinds.push(seasonId)
  }

  const statementsSql = `
    SELECT
      st.id,
      st.transaction_date,
      st.document_type,
      st.document_number,
      st.expense_category,
      st.equipment,
      st.unit,
      st.quantity,
      st.unit_price,
      st.amount,
      st.credit,
      st.debit,
      st.check_amount,
      st.balance_no_checks,
      st.balance_with_checks,
      st.due_date,
      st.check_clearance_date,
      st.year,
      st.month,
      st.notes,
      st.center_code,
      COALESCE(cc.name_ar, cc.name_en) AS center_name,
      st.supplier_code,
      s.name AS supplier_name,
      st.journal_entry_id,
      st.financial_account_id,
      st.equipment_type_id,
      st.equipment_usage_mode,
      je.is_posted AS gl_posted,
      'supplier_transactions' AS source_table
    FROM supplier_transactions st
    LEFT JOIN cost_centers cc ON cc.code = st.center_code AND cc.company_id = st.company_id
    LEFT JOIN suppliers s ON s.code = st.supplier_code AND s.company_id = st.company_id
    LEFT JOIN journal_entries je ON je.id = st.journal_entry_id AND je.company_id = st.company_id
    WHERE ${stConds.join(' AND ')}
    ORDER BY st.transaction_date ASC, st.id ASC
  `

  const { results: statements } = await c.env.DB.prepare(statementsSql).bind(...stBinds, company_id, company_id, company_id).all()

  let summary: any[] = []
  if (unified.ok) {
    summary = unified.rows
      .filter((r) => Number(r.total_credit ?? 0) !== 0 || Number(r.total_debit ?? 0) !== 0 || (!!supplierCode && Number(r.code) === supplierCode))
      .map((r) => ({
        supplier_code: r.code,
        supplier_name: r.name,
        total_credit: Number(r.total_credit ?? 0),
        total_debit: Number(r.total_debit ?? 0),
        balance: Number(r.balance ?? 0),
        tx_count: Number(r.tx_count ?? 0),
        data_source: r.data_source,
        control_account: r.control_account,
      }))
  }

  const strictPosting = await getFlag(c.env.DB, company_id, 'strict_posting_mode')
  const meta = buildPostingMeta({
    isGlPrimary: unified.ok,
    degradedReason: !unified.ok ? unified.error : undefined,
    strictPostingActive: strictPosting,
  })

  return c.json({
    success: true,
    data: statements,
    summary,
    legacy_coverage: unified.legacyCoverage,
    warning: unified.ok ? null : { code: unified.code, message: unified.error },
    meta,
  })
})

suppliers.get('/suppliers-balance', async (c) => {
  const { company_id } = getUser(c)
  const seasonId = c.req.query('season_id') ? Number(c.req.query('season_id')) : null

  const [unified, strictPosting] = await Promise.all([
    buildUnifiedApProjection(c.env.DB, company_id, { seasonId }),
    getFlag(c.env.DB, company_id, 'strict_posting_mode'),
  ])

  if (unified.ok) {
    return c.json({
      success: true,
      data: unified.rows,
      legacy_coverage: unified.legacyCoverage,
      meta: buildPostingMeta({ isGlPrimary: true, strictPostingActive: strictPosting }),
    })
  }

  // Fallback to direct table aggregation if GL projection failed
  const { results } = await c.env.DB.prepare(
    `SELECT
       s.code,
       s.name,
       s.activity,
       COALESCE(SUM(st.credit), 0) AS total_credit,
       COALESCE(SUM(st.debit), 0) AS total_debit,
       COALESCE(SUM(st.credit), 0) - COALESCE(SUM(st.debit), 0) AS balance,
       COUNT(st.id) AS tx_count
     FROM suppliers s
     LEFT JOIN supplier_transactions st
       ON st.supplier_code = s.code
      AND st.company_id = s.company_id
      AND st.status = 'posted'
      ${seasonId ? 'AND st.season_id = ?' : ''}
     WHERE s.company_id = ?
     GROUP BY s.code, s.name, s.activity
     ORDER BY ABS(balance) DESC`
  ).bind(...(seasonId ? [seasonId, company_id] : [company_id])).all()

  return c.json({
    success: true,
    data: results ?? [],
    legacy_coverage: unified.legacyCoverage,
    warning: { code: unified.code, message: unified.error },
    meta: buildPostingMeta({ isGlPrimary: false, degradedReason: unified.error, strictPostingActive: strictPosting }),
  })
})

// ── GET /reports/supplier-ap-summary — AP aging ──
suppliers.get('/supplier-ap-summary', async (c) => {
  const { company_id } = getUser(c)
  const supplierCode  = c.req.query('supplier_code') ? Number(c.req.query('supplier_code')) : null
  
  const agingFilters: string[] = ['sal.company_id = ?', 'sal.open_amount > 0']
  const agingBinds: unknown[] = [company_id]
  if (supplierCode) {
    agingFilters.push('sal.supplier_code = ?')
    agingBinds.push(supplierCode)
  }

  const { results: agingRows } = await c.env.DB.prepare(`
    SELECT
      sal.supplier_code,
      s.name AS supplier_name,
      sal.open_invoice_count,
      sal.open_amount,
      sal.paid_amount,
      sal.net_ap_balance,
      sal.oldest_due_date,
      sal.days_overdue_max
    FROM supplier_ap_ledger sal
    JOIN suppliers s ON s.code = sal.supplier_code AND s.company_id = sal.company_id
    WHERE ${agingFilters.join(' AND ')}
    ORDER BY sal.days_overdue_max DESC, sal.net_ap_balance DESC
  `).bind(...agingBinds).all()

  return c.json({ success: true, data: { suppliers: agingRows } })
})

export default suppliers
