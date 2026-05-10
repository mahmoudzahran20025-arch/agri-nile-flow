#!/usr/bin/env node
/**
 * Subledger Reconciliation Snapshot Job
 *
 * Computes per-supplier balance triplet and writes to supplier_balance_snapshots:
 *   - computed_balance: SUM(credit - debit) from posted supplier_transactions
 *   - stored_balance:   balance_no_checks from the latest posted transaction row
 *   - gl_ap_balance:    net from journal_entry_lines on AP accounts (212*)
 *
 * Run: node scripts/subledger_reconciliation_snapshot.js [--apply]
 * Schedule: daily via Windows Task Scheduler or GitHub Actions cron.
 */

const { execSync } = require('node:child_process')

const DB_NAME = 'agri-nile-flow-data-lake'
const COMPANY_ID = 1
const APPLY = process.argv.includes('--apply')

function runD1Json(sql) {
  const compact = sql.replace(/\s+/g, ' ').trim()
  const escaped = compact.replace(/"/g, '\\"')
  const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --yes --json --command "${escaped}"`
  const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  const start = out.indexOf('[')
  const end = out.lastIndexOf(']')
  if (start < 0 || end < 0 || end < start) throw new Error('Failed to parse D1 output: ' + out.slice(0, 200))
  return JSON.parse(out.slice(start, end + 1))
}

function query(sql) { return runD1Json(sql)[0]?.results ?? [] }

function runMutation(sql) {
  const compact = sql.replace(/\s+/g, ' ').trim()
  const escaped = compact.replace(/"/g, '\\"')
  execSync(`npx wrangler d1 execute ${DB_NAME} --remote --yes --command "${escaped}"`, { encoding: 'utf8' })
}

console.log(`\n=== Subledger Reconciliation Snapshot === ${new Date().toISOString().slice(0, 10)}`)
console.log(`Mode: ${APPLY ? 'APPLY (writes to DB)' : 'DRY RUN (read-only)'}`)
console.log()

// Step 1: Compute all three balance dimensions per supplier
const rows = query(`
  SELECT
    s.code AS supplier_code,
    s.name AS supplier_name,
    ROUND(COALESCE(SUM(st.credit), 0) - COALESCE(SUM(st.debit), 0), 4) AS computed_balance,
    (
      SELECT st2.balance_no_checks
      FROM supplier_transactions st2
      WHERE st2.supplier_code = s.code AND st2.company_id = s.company_id AND st2.status = 'posted'
      ORDER BY st2.transaction_date DESC, st2.id DESC
      LIMIT 1
    ) AS stored_balance,
    ROUND(COALESCE((
      SELECT SUM(jel.credit) - SUM(jel.debit)
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = s.company_id
      WHERE je.is_posted = 1
        AND jel.account_code LIKE '212%'
        AND EXISTS (
          SELECT 1 FROM business_events be
          WHERE be.journal_entry_id = je.id
            AND be.company_id = s.company_id
            AND be.source_module = 'suppliers'
            AND json_extract(be.payload, '$.supplier_code') = CAST(s.code AS TEXT)
        )
    ), 0), 4) AS gl_ap_balance
  FROM suppliers s
  LEFT JOIN supplier_transactions st
    ON st.supplier_code = s.code AND st.company_id = s.company_id AND st.status = 'posted'
  WHERE s.company_id = ${COMPANY_ID}
  GROUP BY s.code, s.name
  ORDER BY s.code
`)

// Step 2: Report and optionally persist
console.log(`Suppliers audited: ${rows.length}`)
console.log('─'.repeat(110))

let driftCount = 0
let maxDrift = 0
const driftSuppliers = []

for (const row of rows) {
  const computed = Number(row.computed_balance ?? 0)
  const stored   = row.stored_balance === null ? null : Number(row.stored_balance)
  const gl       = Number(row.gl_ap_balance ?? 0)
  const driftCS  = stored === null ? 0 : Math.round(Math.abs(computed - stored) * 100) / 100
  const driftCG  = Math.round(Math.abs(computed - gl) * 100) / 100

  const flag = driftCS > 0.5 ? ' ⚠ DRIFT' : ''
  console.log(
    `[${String(row.supplier_code).padEnd(10)}] ${String(row.supplier_name).slice(0, 40).padEnd(42)} | ` +
    `computed=${computed.toFixed(2).padStart(14)} | stored=${stored === null ? '        N/A' : stored.toFixed(2).padStart(14)} | ` +
    `gl=${gl.toFixed(2).padStart(14)} | drift_cs=${driftCS.toFixed(2)}${flag}`
  )

  if (driftCS > 0.5) {
    driftCount++
    if (driftCS > maxDrift) maxDrift = driftCS
    driftSuppliers.push({ code: row.supplier_code, name: row.supplier_name, driftCS, driftCG })
  }

  if (APPLY) {
    const storedVal = stored === null ? 'NULL' : stored
    runMutation(`
      INSERT OR REPLACE INTO supplier_balance_snapshots
        (company_id, supplier_code, snapshot_date, computed_balance, stored_balance, gl_ap_balance)
      VALUES
        (${COMPANY_ID}, ${row.supplier_code}, date('now'), ${computed}, ${storedVal}, ${gl})
    `)
  }
}

console.log('─'.repeat(110))
console.log(`\nSummary: ${driftCount} supplier(s) with drift > 0.5 EGP | Max drift: ${maxDrift.toFixed(2)} EGP`)

if (driftCount > 0) {
  console.log('\nDrift detail:')
  for (const d of driftSuppliers) {
    console.log(`  [${d.code}] ${d.name}: computed-stored drift=${d.driftCS.toFixed(2)} EGP, computed-gl drift=${d.driftCG.toFixed(2)} EGP`)
  }
}

if (!APPLY) {
  console.log('\n→ Run with --apply to write snapshots to supplier_balance_snapshots table.')
} else {
  console.log(`\n✓ Snapshots written to supplier_balance_snapshots for ${rows.length} suppliers.`)
}

if (driftCount > 0) {
  console.log('\n⚠  Drift detected — open GL investigation required (Week 5 reconciliation plan).')
  process.exit(1)
}

console.log('\n✓ No significant subledger drift detected.')
