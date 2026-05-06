import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser } from '../../middleware/auth'

const suppliers = new Hono<{ Bindings: Env }>()

async function buildUnifiedApProjection(
  db: Env['DB'],
  companyId: number,
  opts: { seasonId?: number | null; supplierCode?: number | null } = {},
) {
  const seasonId = opts.seasonId ?? null
  const supplierCode = opts.supplierCode ?? null

  const ap = await db.prepare(
    `SELECT account_code
     FROM posting_rules
     WHERE company_id = ?
       AND rule_type = 'control'
       AND mapping_key = 'accounts_payable'
       AND is_active = 1
     ORDER BY priority ASC, id DESC
     LIMIT 1`
  ).bind(companyId).first<{ account_code: string }>()

  if (!ap?.account_code) {
    return {
      ok: false as const,
      error: 'No active control mapping found for accounts_payable in posting_rules',
      code: 'MISSING_AP_CONTROL_MAPPING',
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
    ok: true as const,
    rows,
    controlAccount: ap.account_code,
    legacyCoverage: {
      has_legacy_gaps: missingJournal > 0 || missingSupplier > 0,
      posted_events_total: postedTotal,
      covered_events: covered,
      missing_journal_link_events: missingJournal,
      missing_supplier_code_events: missingSupplier,
      coverage_rate_pct: postedTotal > 0 ? Math.round((covered / postedTotal) * 10000) / 100 : 100,
      notes: 'Rows with missing supplier_code in old payloads are excluded from supplier-level projection.',
    },
  }
}

suppliers.get('/supplier-payments', async (c) => {
  const { company_id } = getUser(c)
  const supplierCode = c.req.query('supplier_code') ? Number(c.req.query('supplier_code')) : null
  const seasonId     = c.req.query('season_id')     ? Number(c.req.query('season_id'))     : null
  const sourceTableParam = c.req.query('source_table')
  const sourceTable =
    sourceTableParam === 'supplier_transactions' || sourceTableParam === 'supplier_invoices'
      ? sourceTableParam
      : null

  if (sourceTableParam && !sourceTable) {
    return c.json({
      success: false,
      error: 'source_table must be one of: supplier_transactions, supplier_invoices',
      code: 'INVALID_SOURCE_TABLE_FILTER',
    }, 400)
  }

  const unified = await buildUnifiedApProjection(c.env.DB, company_id, { seasonId, supplierCode })
  if (!unified.ok) {
    return c.json({ success: false, error: unified.error, code: unified.code }, 409)
  }

  const stConds: string[] = ['st.company_id = ?', "st.status = 'posted'"]
  const siConds: string[] = ['si.company_id = ?', 'si.journal_entry_id IS NOT NULL']
  const stBinds: unknown[] = [company_id]
  const siBinds: unknown[] = [company_id]

  if (supplierCode) {
    stConds.push('st.supplier_code = ?')
    siConds.push('si.supplier_code = ?')
    stBinds.push(supplierCode)
    siBinds.push(supplierCode)
  }

  if (seasonId) {
    stConds.push('st.season_id = ?')
    stBinds.push(seasonId)
    // supplier_invoices has no season_id column; infer via linked GL lines.
    siConds.push(`EXISTS (
      SELECT 1
      FROM journal_entry_lines jl
      WHERE jl.company_id = si.company_id
        AND jl.entry_id = si.journal_entry_id
        AND jl.season_id = ?
    )`)
    siBinds.push(seasonId)
  }

  const statementsSql = `
    WITH ap_source AS (
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
        st.supplier_code,
        st.journal_entry_id,
        st.financial_account_id,
        st.equipment_type_id,
        st.equipment_usage_mode,
        'supplier_transactions' AS source_table
      FROM supplier_transactions st
      WHERE ${stConds.join(' AND ')}

      UNION ALL

      SELECT
        si.id,
        si.invoice_date AS transaction_date,
        'فاتورة مشتريات' AS document_type,
        si.invoice_number AS document_number,
        'فاتورة مشتريات' AS expense_category,
        NULL AS equipment,
        NULL AS unit,
        NULL AS quantity,
        NULL AS unit_price,
        si.total_amount AS amount,
        si.total_amount AS credit,
        0 AS debit,
        0 AS check_amount,
        NULL AS balance_no_checks,
        NULL AS balance_with_checks,
        NULL AS due_date,
        NULL AS check_clearance_date,
        CAST(strftime('%Y', si.invoice_date) AS INTEGER) AS year,
        CAST(strftime('%m', si.invoice_date) AS INTEGER) AS month,
        si.notes,
        NULL AS center_code,
        si.supplier_code,
        si.journal_entry_id,
        NULL AS financial_account_id,
        NULL AS equipment_type_id,
        NULL AS equipment_usage_mode,
        'supplier_invoices' AS source_table
      FROM supplier_invoices si
      WHERE ${siConds.join(' AND ')}
    )
    SELECT
      ap.id, ap.transaction_date, ap.document_type, ap.document_number,
      ap.expense_category, ap.equipment, ap.unit, ap.quantity, ap.unit_price,
      ap.amount, ap.credit, ap.debit, ap.check_amount,
      ap.balance_no_checks, ap.balance_with_checks,
      ap.due_date, ap.check_clearance_date,
      ap.year, ap.month, ap.notes,
      ap.supplier_code,
      ap.center_code, COALESCE(cc.name_ar, cc.name_en) AS center_name,
      ap.source_table,
      ap.financial_account_id,
      ap.equipment_type_id,
      ap.equipment_usage_mode,
      s.name AS supplier_name,
      ap.journal_entry_id,
      je.is_posted AS gl_posted
    FROM ap_source ap
    LEFT JOIN cost_centers cc ON cc.code = ap.center_code AND cc.company_id = ?
    LEFT JOIN suppliers s ON s.code = ap.supplier_code AND s.company_id = ?
    LEFT JOIN journal_entries je ON je.id = ap.journal_entry_id AND je.company_id = ?
    WHERE (? IS NULL OR ap.source_table = ?)
    ORDER BY ap.transaction_date ASC, ap.id ASC
  `

  const statementsBinds = [
    ...stBinds,
    ...siBinds,
    company_id,
    company_id,
    company_id,
    sourceTable,
    sourceTable,
  ]

  const { results: statements } = await c.env.DB.prepare(statementsSql).bind(...statementsBinds).all()

  let summary: Array<{
    supplier_code: number
    supplier_name: string
    total_credit: number
    total_debit: number
    balance: number
    tx_count: number
    data_source: string
    control_account: string
  }>

  if (sourceTable) {
    const summaryMap = new Map<number, {
      supplier_code: number
      supplier_name: string
      total_credit: number
      total_debit: number
      balance: number
      tx_count: number
      data_source: string
      control_account: string
    }>()

    for (const row of (statements as Array<Record<string, unknown>>)) {
      const code = Number(row.supplier_code)
      if (!Number.isFinite(code) || code <= 0) continue

      const existing = summaryMap.get(code) ?? {
        supplier_code: code,
        supplier_name: String(row.supplier_name ?? ''),
        total_credit: 0,
        total_debit: 0,
        balance: 0,
        tx_count: 0,
        data_source: `${sourceTable}_filtered`,
        control_account: unified.controlAccount,
      }

      existing.total_credit += Number(row.credit ?? 0)
      existing.total_debit += Number(row.debit ?? 0)
      existing.balance = existing.total_credit - existing.total_debit
      existing.tx_count += 1

      summaryMap.set(code, existing)
    }

    summary = Array.from(summaryMap.values())
  } else {
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

  return c.json({
    success: true,
    data: statements,
    summary,
    legacy_coverage: unified.legacyCoverage,
  })
})

suppliers.get('/suppliers-balance', async (c) => {
  const { company_id } = getUser(c)
  const seasonId = c.req.query('season_id') ? Number(c.req.query('season_id')) : null

  const unified = await buildUnifiedApProjection(c.env.DB, company_id, { seasonId })
  if (!unified.ok) {
    return c.json({ success: false, error: unified.error, code: unified.code }, 409)
  }

  return c.json({
    success: true,
    data: unified.rows,
    legacy_coverage: unified.legacyCoverage,
  })
})

export default suppliers
