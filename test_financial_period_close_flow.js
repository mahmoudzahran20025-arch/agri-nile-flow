#!/usr/bin/env node
/*
  Financial Period Close End-to-End Test Runner
  Usage:
    node test_financial_period_close_flow.js --period 5
    node test_financial_period_close_flow.js --period 5 --company 1
*/

const { execSync } = require('child_process')

const args = process.argv.slice(2)
const periodId = Number(getArg('--period') || 0)
const companyId = Number(getArg('--company') || 1)
const dbName = getArg('--db') || 'agri-nile-flow-data-lake'

if (!Number.isFinite(periodId) || periodId <= 0) {
  console.error('Missing required --period <id>')
  process.exit(1)
}

function getArg(name) {
  const i = args.indexOf(name)
  if (i === -1) return ''
  return args[i + 1] || ''
}

function query(sql) {
  const escaped = sql.replace(/"/g, '\\"').replace(/\n/g, ' ')
  const cmd = `npx wrangler d1 execute ${dbName} --remote --json --command "${escaped}"`
  const out = execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' })
  const parsed = JSON.parse(out)
  const first = Array.isArray(parsed) ? parsed[0] : parsed
  return first.results || []
}

function printScenario(name, pass, detail) {
  const icon = pass ? 'PASS' : 'FAIL'
  console.log(`${icon} | ${name}`)
  if (detail) console.log(`      ${detail}`)
}

function main() {
  console.log('=== Financial Close Scenario Runner ===')
  console.log(`Company: ${companyId} | Period: ${periodId}`)

  const periodRows = query(`
    SELECT id, name, start_date, end_date, is_closed, status
    FROM financial_periods
    WHERE id=${periodId} AND company_id=${companyId}
    LIMIT 1
  `)

  if (periodRows.length === 0) {
    console.error('Period not found')
    process.exit(1)
  }

  const period = periodRows[0]
  console.log(`Period Name: ${period.name}`)
  console.log(`Range: ${period.start_date} -> ${period.end_date}`)

  const checks = []

  // Scenario 1: Exactly one open period (policy gate)
  const openRows = query(`
    SELECT COUNT(*) AS n
    FROM financial_periods
    WHERE company_id=${companyId} AND is_closed=0
  `)
  const openCount = Number(openRows[0]?.n || 0)
  checks.push({
    name: 'Single Open Period Policy',
    pass: openCount === 1,
    detail: `open periods = ${openCount}`,
  })

  // Scenario 2: No pending/failed inventory -> GL postings in period range
  const invRows = query(`
    SELECT COUNT(*) AS n
    FROM inventory_movements
    WHERE company_id=${companyId}
      AND movement_date >= '${period.start_date}'
      AND movement_date <= '${period.end_date}'
      AND gl_posting_status IN ('pending','failed','outbox_pending')
  `)
  const pendingInv = Number(invRows[0]?.n || 0)
  checks.push({
    name: 'Inventory Posting Completeness',
    pass: pendingInv === 0,
    detail: `pending/failed inventory postings = ${pendingInv}`,
  })

  // Scenario 3: No unposted journal entries in period
  const unpostedRows = query(`
    SELECT COUNT(*) AS n
    FROM journal_entries
    WHERE company_id=${companyId}
      AND period_id=${periodId}
      AND is_posted=0
  `)
  const unposted = Number(unpostedRows[0]?.n || 0)
  checks.push({
    name: 'No Unposted Journal Entries',
    pass: unposted === 0,
    detail: `unposted entries = ${unposted}`,
  })

  // Scenario 4: Balanced journal entries for this period
  const unbalancedRows = query(`
    SELECT COUNT(*) AS n FROM (
      SELECT je.id
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.entry_id = je.id
      WHERE je.company_id=${companyId}
        AND je.period_id=${periodId}
      GROUP BY je.id
      HAVING ABS(ROUND(SUM(jel.debit), 2) - ROUND(SUM(jel.credit), 2)) > 0.01
    )
  `)
  const unbalanced = Number(unbalancedRows[0]?.n || 0)
  checks.push({
    name: 'Double-Entry Balance',
    pass: unbalanced === 0,
    detail: `unbalanced entries = ${unbalanced}`,
  })

  // Scenario 5: Orphan entries in range (warning)
  const orphanRows = query(`
    SELECT COUNT(*) AS n
    FROM journal_entries
    WHERE company_id=${companyId}
      AND period_id IS NULL
      AND entry_date >= '${period.start_date}'
      AND entry_date <= '${period.end_date}'
  `)
  const orphan = Number(orphanRows[0]?.n || 0)
  checks.push({
    name: 'No Orphan Entries In Range',
    pass: orphan === 0,
    detail: `orphan entries = ${orphan}`,
  })

  // Scenario 6: Opening balance snapshot exists if period already closed
  if (Number(period.is_closed) === 1) {
    const snapRows = query(`
      SELECT COUNT(*) AS n
      FROM period_account_balances
      WHERE company_id=${companyId}
        AND period_id=${periodId}
    `)
    const snapshots = Number(snapRows[0]?.n || 0)
    checks.push({
      name: 'Opening/Closing Balance Snapshot Exists',
      pass: snapshots > 0,
      detail: `period_account_balances rows = ${snapshots}`,
    })
  }

  // Scenario 7: Checklist rows exist and critical checks passed (if workflow executed)
  const checklistRows = query(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN is_critical=1 AND status='passed' THEN 1 ELSE 0 END) AS critical_passed,
           SUM(CASE WHEN is_critical=1 THEN 1 ELSE 0 END) AS critical_total
    FROM period_close_checklist
    WHERE company_id=${companyId} AND period_id=${periodId}
  `)
  const totalChecklist = Number(checklistRows[0]?.total || 0)
  const criticalPassed = Number(checklistRows[0]?.critical_passed || 0)
  const criticalTotal = Number(checklistRows[0]?.critical_total || 0)
  checks.push({
    name: 'Checklist Coverage',
    pass: totalChecklist === 0 || criticalPassed === criticalTotal,
    detail: `checklist rows = ${totalChecklist}, critical passed = ${criticalPassed}/${criticalTotal}`,
  })

  console.log('\n--- Results ---')
  let passCount = 0
  for (const c of checks) {
    if (c.pass) passCount += 1
    printScenario(c.name, c.pass, c.detail)
  }

  console.log(`\nSummary: ${passCount}/${checks.length} scenarios passed`)
  if (passCount !== checks.length) {
    console.log('Close Recommendation: DO NOT CLOSE until failing scenarios are resolved.')
    process.exitCode = 2
    return
  }

  console.log('Close Recommendation: READY FOR CLOSE (subject to in-app authorization checks).')
}

main()
