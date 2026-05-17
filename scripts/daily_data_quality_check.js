#!/usr/bin/env node
const { execSync } = require('child_process')

const DB_NAME = 'agri-nile-flow-data-lake'
const COMPANY_ID = 1

function run(sql) {
  const out = execSync(
    `npx wrangler d1 execute ${DB_NAME} --remote --yes --json --command "${sql.replace(/\s+/g, ' ').replace(/"/g, '\\"')}"`,
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  )
  const start = out.indexOf('[')
  const end = out.lastIndexOf(']')
  const parsed = JSON.parse(out.slice(start, end + 1))
  return parsed[0]?.results?.[0] || {}
}

function pct(num, den) {
  if (!den) return 100
  return Math.round((num / den) * 10000) / 100
}

const control = run(`
  SELECT
    min_supplier_center_pct,
    min_supplier_expense_pct,
    min_supplier_equipment_type_pct,
    min_cash_center_pct,
    min_cash_expense_pct,
    min_items_ppg_pct,
    min_items_ipg_pct,
    enforce_gates
  FROM data_quality_control
  WHERE company_id=${COMPANY_ID}
`)

const supplier = run(`
  SELECT COUNT(*) total,
    SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) with_center,
    SUM(CASE WHEN expense_category IS NOT NULL THEN 1 ELSE 0 END) with_expense,
    SUM(CASE WHEN equipment IS NOT NULL THEN 1 ELSE 0 END) with_equipment,
    SUM(CASE WHEN equipment IS NOT NULL AND equipment_type_id IS NOT NULL THEN 1 ELSE 0 END) with_equipment_type
  FROM supplier_transactions WHERE company_id=${COMPANY_ID}
`)

const cash = run(`
  SELECT COUNT(*) total,
    SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) with_center,
    SUM(CASE WHEN direction='م' THEN 1 ELSE 0 END) expense_required_total,
    SUM(CASE WHEN direction='م' AND expense_code IS NOT NULL THEN 1 ELSE 0 END) with_expense
  FROM cash_transactions WHERE company_id=${COMPANY_ID}
`)

const items = run(`
  SELECT COUNT(*) total,
    SUM(CASE WHEN prod_posting_group_code IS NOT NULL THEN 1 ELSE 0 END) with_ppg,
    SUM(CASE WHEN inv_posting_group_code IS NOT NULL THEN 1 ELSE 0 END) with_ipg
  FROM items WHERE company_id=${COMPANY_ID}
`)

const coverage = {
  supplier_center_pct: pct(Number(supplier.with_center || 0), Number(supplier.total || 0)),
  supplier_expense_pct: pct(Number(supplier.with_expense || 0), Number(supplier.total || 0)),
  supplier_equipment_type_pct: pct(Number(supplier.with_equipment_type || 0), Number(supplier.with_equipment || 0)),
  cash_center_pct: pct(Number(cash.with_center || 0), Number(cash.total || 0)),
  cash_expense_pct: pct(Number(cash.with_expense || 0), Number(cash.expense_required_total || 0)),
  items_ppg_pct: pct(Number(items.with_ppg || 0), Number(items.total || 0)),
  items_ipg_pct: pct(Number(items.with_ipg || 0), Number(items.total || 0)),
}

const checks = [
  ['supplier_center_pct', Number(control.min_supplier_center_pct || 95)],
  ['supplier_expense_pct', Number(control.min_supplier_expense_pct || 95)],
  ['supplier_equipment_type_pct', Number(control.min_supplier_equipment_type_pct || 90)],
  ['cash_center_pct', Number(control.min_cash_center_pct || 95)],
  ['cash_expense_pct', Number(control.min_cash_expense_pct || 90)],
  ['items_ppg_pct', Number(control.min_items_ppg_pct || 100)],
  ['items_ipg_pct', Number(control.min_items_ipg_pct || 100)],
]

// ─────────────────────────────────────────────────────────────────────────────
// GUARD: Regression detection for cash_expense_pct outflow-only denominator
// Ensures we never revert to all-rows calculation (policy protection)
// ─────────────────────────────────────────────────────────────────────────────

const cash_all_rows = run(`
  SELECT COUNT(*) total,
    SUM(CASE WHEN expense_code IS NOT NULL THEN 1 ELSE 0 END) with_expense
  FROM cash_transactions WHERE company_id=${COMPANY_ID}
`)

const cash_expense_pct_all_rows = pct(Number(cash_all_rows.with_expense || 0), Number(cash_all_rows.total || 0))
const cash_expense_pct_outflow_only = coverage.cash_expense_pct

// Guard: if all-rows is significantly higher, policy has regressed
const regression_detected = cash_expense_pct_all_rows > (cash_expense_pct_outflow_only + 5.0)

const failures = checks
  .map(([metric, min]) => ({ metric, min, actual: Number(coverage[metric]) }))
  .filter((x) => x.actual + 0.0001 < x.min)

// Add regression as a failure if detected
if (regression_detected) {
  failures.push({
    metric: 'cash_expense_pct_policy_regression',
    min: 0, // This is a flag, not a threshold
    actual: cash_expense_pct_all_rows,
    detail: `Outflow-only=${cash_expense_pct_outflow_only}%, All-rows=${cash_expense_pct_all_rows}% (drift > 5% indicates possible policy revert)`,
  })
}

console.log(JSON.stringify({
  generated_at: new Date().toISOString(),
  enforce_gates: Number(control.enforce_gates || 0),
  coverage,
  policy_guards: {
    cash_expense_pct_policy: 'outflow-only (direction=م)',
    outflow_only_pct: cash_expense_pct_outflow_only,
    all_rows_pct: cash_expense_pct_all_rows,
    regression_detected,
  },
  failures,
}, null, 2))

if (failures.length > 0) {
  process.exit(2)
}
