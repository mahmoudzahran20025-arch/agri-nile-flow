#!/usr/bin/env node
/**
 * Fix running balance corruption for supplier 20900353
 * (شركة عرفة للتصدير والتنمية الزراعية واستصلاح الاراضي)
 *
 * Root cause: 6 future-dated transactions (Dec 2026, ids 3827-3832)
 * were inserted with corrupted balance_no_checks / balance_with_checks values.
 * The GL and computed balance agree at -0.35 EGP.
 * Only the stored running balance field is wrong.
 *
 * Fix: Full sequential rebalance — recalculate balance_no_checks
 * for every posted transaction in chronological order (transaction_date ASC, id ASC).
 *
 * Run: node scripts/fix_supplier_20900353_balance.js [--apply]
 */

const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const DB_NAME = 'agri-nile-flow-data-lake'
const COMPANY_ID = 1
const SUPPLIER_CODE = 20900353
const APPLY = process.argv.includes('--apply')

function runD1Json(sql) {
  const compact = sql.replace(/\s+/g, ' ').trim()
  const escaped = compact.replace(/"/g, '\\"')
  const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --yes --json --command "${escaped}"`
  const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  const start = out.indexOf('[')
  const end = out.lastIndexOf(']')
  if (start < 0 || end < 0) throw new Error('Failed to parse: ' + out.slice(0, 300))
  return JSON.parse(out.slice(start, end + 1))
}

function query(sql) { return runD1Json(sql)[0]?.results ?? [] }

console.log(`\n=== Fix Supplier 20900353 Running Balance ===`)
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`)

// Fetch all posted rows in correct chronological order
const rows = query(`
  SELECT id, transaction_date, credit, debit, check_amount, balance_no_checks, balance_with_checks
  FROM supplier_transactions
  WHERE company_id = ${COMPANY_ID} AND supplier_code = ${SUPPLIER_CODE} AND status = 'posted'
  ORDER BY transaction_date ASC, id ASC
`)

console.log(`\nRows to rebalance: ${rows.length}`)
console.log('─'.repeat(90))

// Recompute running balance sequentially
let runningBalance = 0
let runningBalanceWithChecks = 0
const updates = []

for (const row of rows) {
  const credit = Number(row.credit ?? 0)
  const debit  = Number(row.debit ?? 0)
  const check  = Number(row.check_amount ?? 0)

  runningBalance = Math.round((runningBalance + credit - debit) * 10000) / 10000
  // balance_with_checks: pending checks reduce available balance
  runningBalanceWithChecks = Math.round((runningBalance - check) * 10000) / 10000

  const oldBal = Number(row.balance_no_checks ?? 0)
  const diff = Math.round(Math.abs(runningBalance - oldBal) * 100) / 100

  const flag = diff > 0.01 ? ' ← FIX' : ''
  console.log(
    `id=${String(row.id).padEnd(6)} ${row.transaction_date}  ` +
    `cr=${String(credit.toFixed(2)).padStart(12)}  dr=${String(debit.toFixed(2)).padStart(12)}  ` +
    `old_bal=${String(oldBal.toFixed(2)).padStart(14)}  new_bal=${String(runningBalance.toFixed(4)).padStart(14)}${flag}`
  )

  if (diff > 0.01) {
    updates.push({ id: row.id, balance_no_checks: runningBalance, balance_with_checks: runningBalanceWithChecks })
  }
}

console.log('─'.repeat(90))
console.log(`\nFinal computed balance: ${runningBalance.toFixed(4)} EGP`)
console.log(`Rows requiring correction: ${updates.length}`)

if (!APPLY) {
  console.log('\n→ Run with --apply to fix the corrupted rows.')
  process.exit(updates.length > 0 ? 1 : 0)
}

// Write SQL file and apply
const sqlLines = [
  `-- Fix running balance for supplier 20900353 (${new Date().toISOString()})`,
  `-- ${updates.length} rows corrected`,
]
for (const u of updates) {
  sqlLines.push(
    `UPDATE supplier_transactions SET balance_no_checks = ${u.balance_no_checks}, balance_with_checks = ${u.balance_with_checks} WHERE id = ${u.id} AND company_id = ${COMPANY_ID};`
  )
}

const sqlPath = path.join(process.cwd(), 'sql', `fix_20900353_balance_${Date.now()}.sql`)
fs.mkdirSync(path.dirname(sqlPath), { recursive: true })
fs.writeFileSync(sqlPath, sqlLines.join('\n') + '\n')
console.log(`\nSQL written to: ${sqlPath}`)

execSync(
  `npx wrangler d1 execute ${DB_NAME} --remote --yes --file "${sqlPath}"`,
  { encoding: 'utf8', stdio: 'inherit' }
)

console.log('\n✓ Balance correction applied.')
console.log('→ Run subledger_reconciliation_snapshot.js --apply to verify drift is resolved.')
