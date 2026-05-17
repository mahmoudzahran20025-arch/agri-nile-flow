const { execSync } = require('node:child_process')

function parseJsonBlock(raw) {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Could not parse Wrangler JSON output for COA audit.')
  }
  return JSON.parse(raw.slice(start, end + 1))
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function runAudit() {
  const cmd = [
    'npx wrangler d1 execute agri-nile-flow-data-lake',
    '--remote',
    '--json',
    '--command "SELECT metric, severity, issue_count FROM vw_coa_audit_metrics ORDER BY metric"',
  ].join(' ')

  const raw = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  const parsed = parseJsonBlock(raw)
  const rows = parsed?.[0]?.results || []

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('COA audit returned no rows. Ensure migration 0094 is applied.')
  }

  console.log('COA Governance Metrics:')
  for (const row of rows) {
    console.log(`- ${row.metric}: ${row.issue_count} (${row.severity})`)
  }

  const criticalCount = rows
    .filter((r) => String(r.severity).toLowerCase() === 'critical')
    .reduce((sum, r) => sum + toNumber(r.issue_count), 0)

  if (criticalCount > 0) {
    throw new Error(`COA governance audit failed: ${criticalCount} critical issue(s) detected.`)
  }

  console.log('COA governance audit passed (no critical issues).')
}

try {
  runAudit()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
}
