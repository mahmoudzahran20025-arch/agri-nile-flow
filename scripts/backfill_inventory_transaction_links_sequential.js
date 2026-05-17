const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const DB_NAME = 'agri-nile-flow-data-lake'
const COMPANY_ID = 1
const APPLY = process.argv.includes('--apply')
function parseJsonBlock(raw) {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Could not parse Wrangler JSON output.')
  }
  return JSON.parse(raw.slice(start, end + 1))
}

function runSql(sql) {
  const compactSql = sql.replace(/\s+/g, ' ').trim()
  const escapedSql = compactSql.replace(/"/g, '\\"')
  const command = `npx wrangler d1 execute ${DB_NAME} --remote --json --command "${escapedSql}"`
  const raw = execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  return parseJsonBlock(raw)
}

function runSqlFile(sqlText) {
  const tempFile = path.join(os.tmpdir(), `inventory-link-backfill-${Date.now()}.sql`)
  fs.writeFileSync(tempFile, sqlText, 'utf8')
  try {
    const command = `npx wrangler d1 execute ${DB_NAME} --remote --yes --file "${tempFile}"`
    return execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  } finally {
    try { fs.unlinkSync(tempFile) } catch {}
  }
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function groupKey(row) {
  return [row.movement_date, row.warehouse, row.transaction_type].join('|')
}

function sqlString(value) {
  if (value == null) return 'NULL'
  return `'${String(value).replace(/'/g, "''")}'`
}

function fetchHeaders() {
  const sql = `
    SELECT it.id, it.document_number, it.movement_date, it.warehouse, it.transaction_type,
           it.line_count, it.total_qty, it.total_value
    FROM inventory_transactions it
    WHERE it.company_id = ${COMPANY_ID}
      AND NOT EXISTS (
        SELECT 1 FROM inventory_movements im
        WHERE im.company_id = it.company_id AND im.transaction_id = it.id
      )
    ORDER BY it.movement_date ASC, it.warehouse ASC, it.transaction_type ASC, it.id ASC
  `
  return runSql(sql)[0].results || []
}

function fetchMovements() {
  const sql = `
    SELECT im.id, im.movement_date, im.warehouse,
           CASE WHEN im.movement_type IN ('TRANSFER_IN', 'TRANSFER_OUT') THEN 'TRANSFER' ELSE im.movement_type END AS transaction_type,
           im.quantity, (COALESCE(im.value_in, 0) + COALESCE(im.value_out, 0)) AS total_value
    FROM inventory_movements im
    WHERE im.company_id = ${COMPANY_ID}
      AND im.transaction_id IS NULL
    ORDER BY im.movement_date ASC, im.warehouse ASC, transaction_type ASC, im.id ASC
  `
  return runSql(sql)[0].results || []
}

function buildAssignments(headers, movements) {
  const headersByGroup = new Map()
  const movementsByGroup = new Map()

  for (const header of headers) {
    const key = groupKey(header)
    const arr = headersByGroup.get(key) || []
    arr.push(header)
    headersByGroup.set(key, arr)
  }

  for (const movement of movements) {
    const key = groupKey(movement)
    const arr = movementsByGroup.get(key) || []
    arr.push(movement)
    movementsByGroup.set(key, arr)
  }

  const assignments = []
  const stats = {
    groups: 0,
    matchedGroups: 0,
    skippedGroups: 0,
    matchedHeaders: 0,
    matchedMovements: 0,
    reasons: {},
    samples: [],
  }

  for (const [key, hdrs] of headersByGroup.entries()) {
    stats.groups += 1
    const movs = movementsByGroup.get(key) || []
    const expectedLines = hdrs.reduce((sum, h) => sum + Number(h.line_count || 0), 0)

    let reason = null
    if (movs.length === 0) {
      reason = 'no_movements'
    } else if (expectedLines !== movs.length) {
      reason = 'line_count_mismatch'
    } else {
      let pointer = 0
      const localAssignments = []
      for (const header of hdrs) {
        const slice = movs.slice(pointer, pointer + Number(header.line_count || 0))
        const qty = round2(slice.reduce((sum, row) => sum + Number(row.quantity || 0), 0))
        const val = round2(slice.reduce((sum, row) => sum + Number(row.total_value || 0), 0))
        const expectedQty = round2(header.total_qty)
        const expectedVal = round2(header.total_value)
        if (slice.length !== Number(header.line_count || 0) || qty !== expectedQty || val !== expectedVal) {
          reason = 'aggregate_mismatch'
          break
        }
        for (const row of slice) {
          localAssignments.push({ movementId: row.id, transactionId: header.id })
        }
        pointer += Number(header.line_count || 0)
      }
      if (!reason && pointer !== movs.length) {
        reason = 'unconsumed_rows'
      }
      if (!reason) {
        assignments.push(...localAssignments)
        stats.matchedGroups += 1
        stats.matchedHeaders += hdrs.length
        stats.matchedMovements += localAssignments.length
        if (stats.samples.length < 8) {
          stats.samples.push({ key, headers: hdrs.length, movements: localAssignments.length })
        }
        continue
      }
    }

    stats.skippedGroups += 1
    stats.reasons[reason] = (stats.reasons[reason] || 0) + 1
  }

  return { assignments, stats }
}

function applyAssignments(assignments) {
  if (assignments.length === 0) return 'No assignments to apply.'

  const chunks = []
  const chunkSize = 200
  for (let i = 0; i < assignments.length; i += chunkSize) {
    chunks.push(assignments.slice(i, i + chunkSize))
  }

  let total = 0
  for (const chunk of chunks) {
    const sql = chunk.map(({ movementId, transactionId }) => (
      `UPDATE inventory_movements SET transaction_id = ${transactionId} WHERE id = ${movementId} AND transaction_id IS NULL;`
    )).join('\n')
    runSqlFile(sql)
    total += chunk.length
  }
  return `Applied ${total} movement-row links in ${chunks.length} batch(es).`
}

function main() {
  console.log('============================================================')
  console.log('INVENTORY TRANSACTION LINK BACKFILL (SEQUENTIAL SAFE MODE)')
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)
  console.log('============================================================')

  const headers = fetchHeaders()
  const movements = fetchMovements()
  const { assignments, stats } = buildAssignments(headers, movements)

  console.log(`Unlinked headers:   ${headers.length}`)
  console.log(`Unlinked movements: ${movements.length}`)
  console.log(`Groups scanned:     ${stats.groups}`)
  console.log(`Matched groups:     ${stats.matchedGroups}`)
  console.log(`Skipped groups:     ${stats.skippedGroups}`)
  console.log(`Matched headers:    ${stats.matchedHeaders}`)
  console.log(`Matched movements:  ${stats.matchedMovements}`)
  console.log('Skip reasons:', stats.reasons)
  console.log('Sample matched groups:', stats.samples)

  if (!APPLY) {
    console.log('\nDry-run complete. Re-run with --apply to write transaction_id links.')
    return
  }

  const message = applyAssignments(assignments)
  console.log(`\n${message}`)
}

main()
