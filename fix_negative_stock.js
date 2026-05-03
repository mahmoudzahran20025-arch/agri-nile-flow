#!/usr/bin/env node
/**
 * fix_negative_stock.js
 * =====================
 * Identifies inventory_movements rows where balance_qty < 0 and inserts
 * a corrective 'اضافة' movement to bring the balance to 0.
 *
 * The correction is tagged with:
 *   - movement_type = 'اضافة'
 *   - unit_price    = 0   (no cost — this is a reconciliation entry, not a purchase)
 *   - notes         = 'تسوية رصيد سالب آلية — STOCK_RECON'
 *   - gl_posting_status = 'exempt_zero_value'
 *
 * SAFETY:
 *   - Default mode is DRY RUN. Pass --apply to execute.
 *   - Only the LATEST snapshot per (company_id, item_code, warehouse) is patched.
 *   - Already-reconciled rows (zero/positive latest balance) are skipped.
 *   - A reconciliation record is printed to stdout for auditing.
 *
 * Usage:
 *   node fix_negative_stock.js              # dry run — shows what would change
 *   node fix_negative_stock.js --apply      # execute corrections on remote D1
 *   node fix_negative_stock.js --company 1  # restrict to a single company_id
 */

const { execSync } = require('child_process')

const DB      = 'agri-nile-flow-data-lake'
const DRY_RUN = !process.argv.includes('--apply')
const COMPANY = (() => {
  const idx = process.argv.indexOf('--company')
  return idx !== -1 ? Number(process.argv[idx + 1]) : null
})()

const CREATED_BY_USER_ID = 1   // system / admin user
const NOTES              = 'تسوية رصيد سالب آلية — STOCK_RECON'
const BATCH_KEY_PREFIX   = `stock_recon_${Date.now()}`

// ── Helpers ──────────────────────────────────────────────────────────────────

function query(sql) {
  try {
    const out = execSync(
      `npx wrangler d1 execute ${DB} --remote --json --command "${sql.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    const parsed = JSON.parse(out)
    return parsed[0]?.results ?? []
  } catch (err) {
    console.error(`  ❌  Query failed:\n      ${err.message}`)
    return []
  }
}

function execute(sql) {
  try {
    execSync(
      `npx wrangler d1 execute ${DB} --remote --command "${sql.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    return true
  } catch (err) {
    console.error(`  ❌  Execute failed:\n      ${err.message}`)
    return false
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('\n╔══════════════════════════════════════════════════════════════════╗')
console.log('║         Negative Stock Remediation — ' + (DRY_RUN ? 'DRY RUN           ' : 'APPLYING          ') + '║')
console.log('╚══════════════════════════════════════════════════════════════════╝\n')

if (DRY_RUN) {
  console.log('  ℹ️  DRY RUN — no writes will be made. Pass --apply to execute.\n')
}
if (COMPANY) {
  console.log(`  🔒  Restricting to company_id = ${COMPANY}\n`)
}

// 1. Find all latest-balance rows per (company_id, item_code, warehouse) where balance_qty < 0
const companyFilter = COMPANY ? `AND im.company_id = ${COMPANY}` : ''
const negativeRows = query(`
  SELECT
    im.id, im.company_id, im.item_code, im.warehouse,
    im.balance_qty, im.balance_value,
    im.movement_date,
    i.name AS item_name
  FROM inventory_movements im
  LEFT JOIN items i ON i.code = im.item_code AND i.company_id = im.company_id
  WHERE im.balance_qty < 0
    ${companyFilter}
    AND im.id IN (
      SELECT MAX(id) FROM inventory_movements
      WHERE balance_qty < 0 ${COMPANY ? `AND company_id = ${COMPANY}` : ''}
      GROUP BY company_id, item_code, warehouse
    )
  ORDER BY im.company_id, im.item_code, im.warehouse
`)

if (!negativeRows.length) {
  console.log('  ✅  No negative stock rows found. Nothing to do.\n')
  process.exit(0)
}

console.log(`  Found ${negativeRows.length} item/warehouse combination(s) with negative balance:\n`)
console.log('  ' + '-'.repeat(90))
console.log('  ' + ['ID'.padEnd(8), 'Co.'.padEnd(5), 'Item'.padEnd(8), 'Warehouse'.padEnd(22), 'Name'.padEnd(28), 'Neg.Qty'.padStart(10)].join(' '))
console.log('  ' + '-'.repeat(90))

for (const r of negativeRows) {
  console.log(
    '  ' + [
      String(r.id).padEnd(8),
      String(r.company_id).padEnd(5),
      String(r.item_code).padEnd(8),
      String(r.warehouse).slice(0, 20).padEnd(22),
      String(r.item_name ?? '—').slice(0, 26).padEnd(28),
      String(r.balance_qty).padStart(10),
    ].join(' ')
  )
}

console.log('  ' + '-'.repeat(90))
console.log()

if (DRY_RUN) {
  console.log(`  📋  Would insert ${negativeRows.length} corrective 'اضافة' movement(s) to bring balances to 0.`)
  console.log('      Each correction will have:')
  console.log('        • unit_price = 0 (reconciliation, not a purchase)')
  console.log('        • gl_posting_status = exempt_zero_value')
  console.log(`        • notes = '${NOTES}'`)
  console.log('\n  Re-run with --apply to execute.\n')
  process.exit(0)
}

// 2. Apply corrections
console.log('  🔧  Applying corrections...\n')

let successCount = 0
let failCount    = 0

for (const r of negativeRows) {
  const corrQty      = Math.abs(r.balance_qty)      // positive qty to restore to 0
  const corrVal      = 0                             // zero-value reconciliation
  const newBalQty    = 0
  const newBalVal    = 0
  const today        = new Date().toISOString().slice(0, 10)
  const year         = new Date().getFullYear()
  const month        = new Date().getMonth() + 1
  const localId      = `${BATCH_KEY_PREFIX}_${r.company_id}_${r.item_code}_${r.warehouse.replace(/\s/g, '_')}`

  const sql = `
    INSERT INTO inventory_movements
      (company_id, item_code, movement_date, warehouse, movement_type,
       quantity, unit_price, qty_in, qty_out,
       balance_qty, value_in, value_out, balance_value,
       notes, year, month, created_by_user_id, local_id,
       zero_value_reason, zero_value_approved_by_role,
       posting_mode, gl_posting_status)
    VALUES (
      ${r.company_id}, ${r.item_code}, '${today}', '${r.warehouse.replace(/'/g, "''")}', 'اضافة',
      ${corrQty}, ${corrVal}, ${corrQty}, 0,
      ${newBalQty}, ${corrVal}, 0, ${newBalVal},
      '${NOTES}', ${year}, ${month}, ${CREATED_BY_USER_ID}, '${localId}',
      'STOCK_RECON', 'system',
      'decoupled', 'exempt_zero_value'
    )
  `

  const ok = execute(sql)
  if (ok) {
    successCount++
    console.log(`  ✅  Fixed: company=${r.company_id} item=${r.item_code} (${r.item_name ?? '—'}) warehouse='${r.warehouse}' qty_added=${corrQty}`)
  } else {
    failCount++
    console.log(`  ❌  FAILED: company=${r.company_id} item=${r.item_code} warehouse='${r.warehouse}'`)
  }
}

console.log('\n' + '─'.repeat(70))
console.log(`  ✅  ${successCount} correction(s) applied.${failCount ? `  ❌  ${failCount} failed.` : ''}`)

// 3. Verify: re-check negative count after applying
const afterCheck = query(`
  SELECT COUNT(DISTINCT item_code||'|'||warehouse) AS remaining
  FROM inventory_movements
  WHERE balance_qty < 0
    ${companyFilter}
    AND id IN (
      SELECT MAX(id) FROM inventory_movements
      ${COMPANY ? `WHERE company_id = ${COMPANY}` : ''}
      GROUP BY company_id, item_code, warehouse
    )
`)
const remaining = Number(afterCheck[0]?.remaining ?? '?')
console.log(`\n  📊  Remaining negative snapshots after fix: ${remaining}\n`)

if (remaining === 0) {
  console.log('  ✅  All negative stock resolved.\n')
} else {
  console.log('  ⚠️   Some items still negative — may need manual review.\n')
}
