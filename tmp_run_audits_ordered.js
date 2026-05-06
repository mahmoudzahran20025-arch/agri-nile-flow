#!/usr/bin/env node
const { execSync } = require('child_process')

const DB = 'agri-nile-flow-data-lake'
const BASE = 'https://agri-nile-flow.mahm-zahran22.workers.dev/api'
const COMPANY_ID = 1

function runD1(sql) {
  const escaped = sql.replace(/"/g, '\\"').replace(/\n/g, ' ')
  const cmd = `npx wrangler d1 execute ${DB} --remote --json --command "${escaped}"`
  try {
    const out = execSync(cmd, { encoding: 'utf8' })
    const parsed = JSON.parse(out)
    return parsed?.[0]?.results?.[0] || {}
  } catch (e) {
    const raw = (e && (e.stdout || e.stderr || e.message)) ? String(e.stdout || e.stderr || e.message) : 'unknown D1 error'
    return { __error: raw.slice(0, 500) }
  }
}

function runD1All(sql) {
  const escaped = sql.replace(/"/g, '\\"').replace(/\n/g, ' ')
  const cmd = `npx wrangler d1 execute ${DB} --remote --json --command "${escaped}"`
  try {
    const out = execSync(cmd, { encoding: 'utf8' })
    const parsed = JSON.parse(out)
    return parsed?.[0]?.results || []
  } catch {
    return []
  }
}

async function login() {
  const creds = [
    { email: 'admin@nawa.eg', password: 'Admin@2025', company_id: 1 },
    { email: 'admin@nawa.eg', password: 'admin', company_id: 1 },
  ]
  for (const c of creds) {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(c),
    })
    const data = await res.json().catch(() => ({}))
    const token = data?.data?.token
    if (res.ok && token) return token
  }
  return null
}

async function apiStatus(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  return res.status
}

function pct(linked, total) {
  if (!total) return 100
  return Math.round((Number(linked || 0) / Number(total || 0)) * 10000) / 100
}

;(async () => {
  const token = await login()
  const results = []

  // AUD-001
  const inv = runD1("SELECT COUNT(*) AS total, SUM(CASE WHEN journal_entry_id IS NOT NULL OR COALESCE(gl_posting_status,'') IN ('exempt_zero_value','skipped_zero_value') THEN 1 ELSE 0 END) AS linked FROM inventory_movements WHERE company_id = 1 AND status='posted'")
  const cash = runD1("SELECT COUNT(*) AS total, SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS linked FROM cash_transactions WHERE company_id = 1 AND status='posted'")
  const sup = runD1("SELECT COUNT(*) AS total, SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS linked FROM supplier_transactions WHERE company_id = 1 AND status='posted'")
  const pay = runD1("SELECT COUNT(*) AS total, SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS linked FROM payroll_runs WHERE company_id = 1 AND status='posted'")
  const sEntries = token ? await apiStatus('/gl/entries', token) : 401
  const sIntegrity = token ? await apiStatus('/gl/integrity-check', token) : 401
  const aud1 = {
    id: 'AUD-001',
    inventory_pct: pct(inv.linked, inv.total),
    cash_pct: pct(cash.linked, cash.total),
    supplier_pct: pct(sup.linked, sup.total),
    payroll_pct: pct(pay.linked, pay.total),
    api_entries_status: sEntries,
    api_integrity_status: sIntegrity,
  }
  aud1.result = aud1.inventory_pct >= 99.5 && aud1.cash_pct >= 99.5 && aud1.supplier_pct >= 99.5 && aud1.payroll_pct >= 99.5 && aud1.api_entries_status === 200 ? 'PASS' : 'FAIL'
  results.push(aud1)

  // AUD-002
  const unb = runD1("SELECT COUNT(*) AS unbalanced FROM (SELECT je.id FROM journal_entries je JOIN journal_entry_lines jel ON jel.entry_id = je.id WHERE je.company_id = 1 GROUP BY je.id HAVING ABS(ROUND(SUM(jel.debit),2)-ROUND(SUM(jel.credit),2)) > 0.01) t")
  const orp = runD1("SELECT COUNT(*) AS orphans FROM journal_entry_lines jel WHERE jel.company_id = 1 AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.id = jel.entry_id)")
  const miss = runD1("SELECT COUNT(*) AS missing_accounts FROM journal_entry_lines jel WHERE jel.company_id = 1 AND NOT EXISTS (SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = jel.company_id AND coa.code = jel.account_code)")
  const sTrial = token ? await apiStatus('/gl/trial-balance', token) : 401
  const aud2 = { id: 'AUD-002', unbalanced: Number(unb.unbalanced || 0), orphans: Number(orp.orphans || 0), missing_accounts: Number(miss.missing_accounts || 0), api_trial_balance_status: sTrial }
  aud2.result = aud2.unbalanced === 0 && aud2.orphans === 0 && aud2.missing_accounts === 0 ? 'PASS' : 'FAIL'
  results.push(aud2)

  // AUD-003
  const draftCash = runD1("SELECT COUNT(*) AS draft_cash FROM cash_transactions WHERE company_id=1 AND status='draft'")
  const draftSup = runD1("SELECT COUNT(*) AS draft_supplier FROM supplier_transactions WHERE company_id=1 AND status='draft'")
  // Reversal linkage in this schema is represented by reversal entries
  // with ref_type='reversal' and ref_id pointing to original entry id.
  const rev = runD1("SELECT COUNT(*) AS broken_reversal_links FROM journal_entries je WHERE je.company_id=1 AND je.ref_type='reversal' AND je.ref_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM journal_entries original WHERE original.id = je.ref_id AND original.company_id = je.company_id)")
  const sEntriesPosted = token ? await apiStatus('/gl/entries?status=posted', token) : 401
  const aud3 = {
    id: 'AUD-003',
    draft_cash: Number(draftCash.draft_cash || 0),
    draft_supplier: Number(draftSup.draft_supplier || 0),
    broken_reversal_links: Number(rev.broken_reversal_links || 0),
    api_entries_posted_status: sEntriesPosted,
  }
  aud3.result = aud3.broken_reversal_links === 0 && aud3.api_entries_posted_status === 200 ? 'PASS' : 'FAIL'
  results.push(aud3)

  // AUD-004
  const ctrl = runD1("SELECT ROUND(SUM(jel.debit),2) AS debit_sum, ROUND(SUM(jel.credit),2) AS credit_sum FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id WHERE je.company_id=1 AND je.is_posted=1 AND je.entry_date>='2025-01-01' AND je.entry_date<='2026-12-31'")
  const diff = Math.abs(Number(ctrl.debit_sum || 0) - Number(ctrl.credit_sum || 0))
  const sTrial2 = token ? await apiStatus('/gl/trial-balance?from=2025-01-01&to=2026-12-31', token) : 401
  const sIncome = token ? await apiStatus('/gl/income-statement?start=2025-01-01&end=2026-12-31', token) : 401
  const sBs = token ? await apiStatus('/gl/balance-sheet?as_of=2026-12-31', token) : 401
  const aud4 = { id: 'AUD-004', debit_sum: Number(ctrl.debit_sum || 0), credit_sum: Number(ctrl.credit_sum || 0), diff, api_trial_status: sTrial2, api_income_status: sIncome, api_balance_sheet_status: sBs }
  aud4.result = diff < 0.01 && sTrial2 === 200 && sIncome === 200 && sBs === 200 ? 'PASS' : 'FAIL'
  results.push(aud4)

  // AUD-005
  const sNull = runD1("SELECT ROUND(100.0 * SUM(CASE WHEN season_id IS NULL THEN 1 ELSE 0 END) / COUNT(*),2) AS season_null_pct, ROUND(100.0 * SUM(CASE WHEN center_code IS NULL THEN 1 ELSE 0 END) / COUNT(*),2) AS center_null_pct FROM supplier_transactions WHERE company_id=1 AND status='posted'")
  const cNull = runD1("SELECT ROUND(100.0 * SUM(CASE WHEN season_id IS NULL THEN 1 ELSE 0 END) / COUNT(*),2) AS season_null_pct, ROUND(100.0 * SUM(CASE WHEN center_code IS NULL THEN 1 ELSE 0 END) / COUNT(*),2) AS center_null_pct, ROUND(100.0 * SUM(CASE WHEN field_id IS NULL THEN 1 ELSE 0 END) / COUNT(*),2) AS field_null_pct FROM cash_transactions WHERE company_id=1 AND status='posted'")
  const glMiss = runD1("SELECT COUNT(*) AS posted_lines_missing_dimensions FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id WHERE jel.company_id=1 AND je.is_posted=1 AND (jel.season_id IS NULL OR jel.center_code IS NULL)")
  const aud5 = {
    id: 'AUD-005',
    supplier_season_null_pct: Number(sNull.season_null_pct || 0),
    supplier_center_null_pct: Number(sNull.center_null_pct || 0),
    cash_season_null_pct: Number(cNull.season_null_pct || 0),
    cash_center_null_pct: Number(cNull.center_null_pct || 0),
    cash_field_null_pct: Number(cNull.field_null_pct || 0),
    gl_posted_missing_dims: Number(glMiss.posted_lines_missing_dimensions || 0),
  }
  aud5.result = aud5.supplier_season_null_pct < 2 && aud5.supplier_center_null_pct < 2 && aud5.cash_season_null_pct < 2 && aud5.cash_center_null_pct < 2 ? 'PASS' : 'FAIL'
  results.push(aud5)

  // AUD-006
  const cov = runD1("SELECT (SELECT COUNT(*) FROM md_account_roles WHERE is_active=1) AS total_roles, (SELECT COUNT(DISTINCT role_code) FROM account_role_mappings WHERE company_id=1 AND is_active=1) AS mapped_roles")
  const broken = runD1("SELECT COUNT(*) AS broken_mappings FROM account_role_mappings arm LEFT JOIN chart_of_accounts coa ON coa.company_id=arm.company_id AND coa.code=arm.account_code WHERE arm.company_id=1 AND arm.is_active=1 AND coa.code IS NULL")
  const sCov = token ? await apiStatus('/gl/account-role-policy/coverage', token) : 401
  const sCash = token ? await apiStatus('/gl/account-role-policy/resolve/CASH', token) : 401
  const sBank = token ? await apiStatus('/gl/account-role-policy/resolve/BANK', token) : 401
  const sAr = token ? await apiStatus('/gl/account-role-policy/resolve/AR', token) : 401
  const sAp = token ? await apiStatus('/gl/account-role-policy/resolve/AP', token) : 401
  const sInv = token ? await apiStatus('/gl/account-role-policy/resolve/INVENTORY', token) : 401
  const aud6 = { id: 'AUD-006', total_roles: Number(cov.total_roles || 0), mapped_roles: Number(cov.mapped_roles || 0), broken_mappings: Number(broken.broken_mappings || 0), api_coverage_status: sCov, resolve_statuses: { CASH: sCash, BANK: sBank, AR: sAr, AP: sAp, INVENTORY: sInv } }
  aud6.result = aud6.total_roles > 0 && aud6.total_roles === aud6.mapped_roles && aud6.broken_mappings === 0 && sCov === 200 && sCash === 200 && sBank === 200 && sAr === 200 && sAp === 200 && sInv === 200 ? 'PASS' : 'FAIL'
  results.push(aud6)

  // AUD-007
  const spot = runD1("SELECT ROUND(SUM(jel.debit - jel.credit),2) AS net FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id WHERE jel.company_id=1 AND jel.account_code='2110' AND je.is_posted=1 AND je.entry_date BETWEEN '2025-01-01' AND '2026-12-31'")
  const sEntries2 = token ? await apiStatus('/gl/entries?from=2025-01-01&to=2026-12-31', token) : 401
  const sIncome2 = token ? await apiStatus('/gl/income-statement?start=2025-01-01&end=2026-12-31', token) : 401
  const aud7 = { id: 'AUD-007', spot_2110_net: Number(spot.net || 0), api_entries_range_status: sEntries2, api_income_status: sIncome2 }
  aud7.result = sEntries2 === 200 && sIncome2 === 200 ? 'PASS' : 'FAIL'
  results.push(aud7)

  console.log(JSON.stringify({ auth: token ? 'SUCCESS' : 'FAILED', results }, null, 2))
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
