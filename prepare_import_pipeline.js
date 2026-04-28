#!/usr/bin/env node
/*
 * Phase 4 Import Pipeline Preparation (prepare-only)
 * - No write operations are executed.
 * - Validates posting-groups architecture alignment.
 * - Analyzes import SQL for idempotency collisions.
 * - Emits actionable report for execution readiness.
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const BASE_DIR = __dirname
const CONFIG_PATH = path.join(BASE_DIR, 'import_pipeline_config.json')
const REPORT_PATH = path.join(BASE_DIR, 'import_pipeline_report.json')
const STRICT_MODE = process.argv.includes('--strict')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function d1Query(dbName, sql) {
  const escaped = sql.replace(/\n/g, " ").replace(/"/g, '\\"')
  const command = `npx wrangler d1 execute ${dbName} --remote --json --command "${escaped}"`
  const out = execSync(command, {
    cwd: BASE_DIR,
    encoding: 'utf8',
    timeout: 120000,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const parsed = JSON.parse(out.trim())
  return parsed[0] && Array.isArray(parsed[0].results) ? parsed[0].results : []
}

function splitCsvTopLevel(input) {
  const parts = []
  let current = ''
  let inSingleQuote = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    const next = input[i + 1]

    if (ch === "'" && inSingleQuote && next === "'") {
      current += "''"
      i += 1
      continue
    }

    if (ch === "'") {
      inSingleQuote = !inSingleQuote
      current += ch
      continue
    }

    if (ch === ',' && !inSingleQuote) {
      parts.push(current.trim())
      current = ''
      continue
    }

    current += ch
  }

  if (current.trim().length > 0) {
    parts.push(current.trim())
  }

  return parts
}

function parseSqlLiteral(value) {
  if (!value) return null
  const v = value.trim()

  if (v.toUpperCase() === 'NULL') return null

  if (v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1).replace(/''/g, "'").trim()
  }

  const num = Number(v)
  if (!Number.isNaN(num)) return num

  return v
}

function normalizeText(v) {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function normalizeNum(v) {
  if (v === null || v === undefined || v === '') return '0.0000'
  const n = Number(v)
  if (Number.isNaN(n)) return '0.0000'
  return n.toFixed(4)
}

function makeKey(table, row) {
  if (table === 'supplier_transactions') {
    return [
      normalizeText(row.company_id),
      normalizeText(row.supplier_code),
      normalizeText(row.transaction_date),
      normalizeText(row.document_number),
      normalizeText(row.entry_type),
      normalizeNum(row.amount),
      normalizeNum(row.debit),
      normalizeNum(row.credit),
    ].join('|')
  }

  if (table === 'cash_transactions') {
    return [
      normalizeText(row.company_id),
      normalizeText(row.transaction_date),
      normalizeText(row.document_number),
      normalizeText(row.direction),
      normalizeNum(row.amount),
      normalizeNum(row.debit),
      normalizeNum(row.credit),
    ].join('|')
  }

  if (table === 'inventory_movements') {
    return [
      normalizeText(row.company_id),
      normalizeText(row.item_code),
      normalizeText(row.warehouse),
      normalizeText(row.movement_date),
      normalizeText(row.document_number),
      normalizeText(row.movement_type),
      normalizeNum(row.quantity),
      normalizeNum(row.value_in),
      normalizeNum(row.value_out),
    ].join('|')
  }

  return null
}

function parseInsertStatements(sqlContent) {
  const statements = []
  const re = /INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)\s*;/gi
  let match

  while ((match = re.exec(sqlContent)) !== null) {
    const table = match[1].trim()
    const columns = splitCsvTopLevel(match[2]).map(c => c.trim())
    const values = splitCsvTopLevel(match[3]).map(parseSqlLiteral)

    if (columns.length !== values.length) {
      continue
    }

    const row = {}
    for (let i = 0; i < columns.length; i++) {
      row[columns[i]] = values[i]
    }

    statements.push({ table, row })
  }

  return statements
}

function listSqlFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(name => name.toLowerCase().endsWith('.sql'))
    .sort()
    .map(name => path.join(dir, name))
}

function getExistingKeys(dbName, table) {
  if (table === 'supplier_transactions') {
    return new Set(d1Query(dbName, `
      SELECT
        CAST(company_id AS TEXT) || '|' ||
        COALESCE(CAST(supplier_code AS TEXT), '') || '|' ||
        COALESCE(transaction_date, '') || '|' ||
        COALESCE(CAST(document_number AS TEXT), '') || '|' ||
        COALESCE(entry_type, '') || '|' ||
        printf('%.4f', COALESCE(amount, 0)) || '|' ||
        printf('%.4f', COALESCE(debit, 0)) || '|' ||
        printf('%.4f', COALESCE(credit, 0)) AS k
      FROM supplier_transactions
      WHERE company_id = 1
    `).map(r => r.k))
  }

  if (table === 'cash_transactions') {
    return new Set(d1Query(dbName, `
      SELECT
        CAST(company_id AS TEXT) || '|' ||
        COALESCE(transaction_date, '') || '|' ||
        COALESCE(CAST(document_number AS TEXT), '') || '|' ||
        COALESCE(direction, '') || '|' ||
        printf('%.4f', COALESCE(amount, 0)) || '|' ||
        printf('%.4f', COALESCE(debit, 0)) || '|' ||
        printf('%.4f', COALESCE(credit, 0)) AS k
      FROM cash_transactions
      WHERE company_id = 1
    `).map(r => r.k))
  }

  if (table === 'inventory_movements') {
    return new Set(d1Query(dbName, `
      SELECT
        CAST(company_id AS TEXT) || '|' ||
        COALESCE(CAST(item_code AS TEXT), '') || '|' ||
        COALESCE(TRIM(warehouse), '') || '|' ||
        COALESCE(movement_date, '') || '|' ||
        COALESCE(CAST(document_number AS TEXT), '') || '|' ||
        COALESCE(movement_type, '') || '|' ||
        printf('%.4f', COALESCE(quantity, 0)) || '|' ||
        printf('%.4f', COALESCE(value_in, 0)) || '|' ||
        printf('%.4f', COALESCE(value_out, 0)) AS k
      FROM inventory_movements
      WHERE company_id = 1
    `).map(r => r.k))
  }

  return new Set()
}

function evaluatePostingGroupAlignment(dbName) {
  const checks = []

  function addCheck(code, ok, message, fix) {
    checks.push({ code, ok, message, fix })
  }

  const engine = d1Query(dbName, `
    SELECT is_enabled
    FROM gl_integration_settings
    WHERE module_key = 'posting_engine'
    LIMIT 1
  `)
  addCheck(
    'PG-PIPE-001',
    engine.length > 0 && Number(engine[0].is_enabled) === 1,
    'posting_engine integration setting must be enabled.',
    'Enable posting_engine in /gl/integrations before import execution.'
  )

  const gpsCatchAll = d1Query(dbName, `
    SELECT COUNT(*) AS c
    FROM general_posting_setup
    WHERE company_id = 1
      AND is_active = 1
      AND bus_posting_group_code IS NULL
      AND prod_posting_group_code IS NULL
  `)
  addCheck(
    'PG-PIPE-002',
    Number(gpsCatchAll[0] && gpsCatchAll[0].c) > 0,
    'general_posting_setup NULL/NULL catch-all row must exist and be active.',
    'Create NULL/NULL row in /gl/posting-setup (General tab).'
  )

  const ipsCatchAll = d1Query(dbName, `
    SELECT COUNT(*) AS c
    FROM inventory_posting_setup
    WHERE company_id = 1
      AND is_active = 1
      AND inv_posting_group_code IS NULL
      AND prod_posting_group_code IS NULL
  `)
  addCheck(
    'PG-PIPE-003',
    Number(ipsCatchAll[0] && ipsCatchAll[0].c) > 0,
    'inventory_posting_setup NULL/NULL catch-all row must exist and be active.',
    'Create NULL/NULL row in /gl/posting-setup (Inventory tab).'
  )

  const missingAssignments = d1Query(dbName, `
    SELECT
      (SELECT COUNT(*) FROM suppliers WHERE company_id = 1 AND (bus_posting_group_code IS NULL OR TRIM(bus_posting_group_code) = '')) AS suppliers_missing_bpg,
      (SELECT COUNT(*) FROM items WHERE company_id = 1 AND (prod_posting_group_code IS NULL OR TRIM(prod_posting_group_code) = '')) AS items_missing_ppg,
      (SELECT COUNT(*) FROM warehouses WHERE company_id = 1 AND (inv_posting_group_code IS NULL OR TRIM(inv_posting_group_code) = '')) AS warehouses_missing_ipg
  `)[0] || {}

  addCheck(
    'PG-PIPE-004',
    Number(missingAssignments.suppliers_missing_bpg) === 0,
    `All suppliers must have bus_posting_group_code (missing=${missingAssignments.suppliers_missing_bpg || 0}).`,
    'Assign missing supplier BPGs in /suppliers.'
  )
  addCheck(
    'PG-PIPE-005',
    Number(missingAssignments.items_missing_ppg) === 0,
    `All items must have prod_posting_group_code (missing=${missingAssignments.items_missing_ppg || 0}).`,
    'Assign missing item PPGs in /inventory.'
  )
  addCheck(
    'PG-PIPE-006',
    Number(missingAssignments.warehouses_missing_ipg) === 0,
    `All warehouses must have inv_posting_group_code (missing=${missingAssignments.warehouses_missing_ipg || 0}).`,
    'Assign missing warehouse IPGs in /inventory/warehouses.'
  )

  const orphanGroups = d1Query(dbName, `
    SELECT
      (SELECT COUNT(*)
       FROM suppliers s
       LEFT JOIN business_posting_groups b
         ON b.company_id = s.company_id AND b.code = s.bus_posting_group_code AND b.is_active = 1
       WHERE s.company_id = 1 AND s.bus_posting_group_code IS NOT NULL AND TRIM(s.bus_posting_group_code) <> '' AND b.code IS NULL
      ) AS supplier_invalid_bpg,
      (SELECT COUNT(*)
       FROM items i
       LEFT JOIN product_posting_groups p
         ON p.company_id = i.company_id AND p.code = i.prod_posting_group_code AND p.is_active = 1
       WHERE i.company_id = 1 AND i.prod_posting_group_code IS NOT NULL AND TRIM(i.prod_posting_group_code) <> '' AND p.code IS NULL
      ) AS item_invalid_ppg,
      (SELECT COUNT(*)
       FROM warehouses w
       LEFT JOIN inventory_posting_groups g
         ON g.company_id = w.company_id AND g.code = w.inv_posting_group_code AND g.is_active = 1
       WHERE w.company_id = 1 AND w.inv_posting_group_code IS NOT NULL AND TRIM(w.inv_posting_group_code) <> '' AND g.code IS NULL
      ) AS warehouse_invalid_ipg
  `)[0] || {}

  addCheck(
    'PG-PIPE-007',
    Number(orphanGroups.supplier_invalid_bpg) === 0,
    `All supplier BPG references must exist and be active (invalid=${orphanGroups.supplier_invalid_bpg || 0}).`,
    'Fix supplier BPG codes or activate referenced BPG rows.'
  )
  addCheck(
    'PG-PIPE-008',
    Number(orphanGroups.item_invalid_ppg) === 0,
    `All item PPG references must exist and be active (invalid=${orphanGroups.item_invalid_ppg || 0}).`,
    'Fix item PPG codes or activate referenced PPG rows.'
  )
  addCheck(
    'PG-PIPE-009',
    Number(orphanGroups.warehouse_invalid_ipg) === 0,
    `All warehouse IPG references must exist and be active (invalid=${orphanGroups.warehouse_invalid_ipg || 0}).`,
    'Fix warehouse IPG codes or activate referenced IPG rows.'
  )

  const catchAllAccounts = d1Query(dbName, `
    SELECT
      (SELECT COUNT(*) FROM general_posting_setup
       WHERE company_id = 1 AND is_active = 1
         AND bus_posting_group_code IS NULL AND prod_posting_group_code IS NULL
         AND purchases_account IS NOT NULL AND cogs_account IS NOT NULL AND sales_account IS NOT NULL AND expense_account IS NOT NULL
      ) AS gps_accounts_ok,
      (SELECT COUNT(*) FROM inventory_posting_setup
       WHERE company_id = 1 AND is_active = 1
         AND inv_posting_group_code IS NULL AND prod_posting_group_code IS NULL
         AND inventory_account IS NOT NULL
      ) AS ips_accounts_ok
  `)[0] || {}

  addCheck(
    'PG-PIPE-010',
    Number(catchAllAccounts.gps_accounts_ok) > 0,
    'General catch-all must include purchases_account, cogs_account, sales_account, expense_account.',
    'Edit NULL/NULL row in /gl/posting-setup to fill all required accounts.'
  )
  addCheck(
    'PG-PIPE-011',
    Number(catchAllAccounts.ips_accounts_ok) > 0,
    'Inventory catch-all must include inventory_account.',
    'Edit NULL/NULL inventory row in /gl/posting-setup to fill inventory_account.'
  )

  return checks
}

function evaluateReferenceHealth(dbName) {
  const stats = d1Query(dbName, `
    SELECT
      (SELECT COUNT(*) FROM supplier_transactions WHERE company_id = 1 AND supplier_code IS NOT NULL
         AND supplier_code NOT IN (SELECT code FROM suppliers WHERE company_id = 1)
      ) AS supplier_tx_orphans,
      (SELECT COUNT(*) FROM inventory_movements WHERE company_id = 1 AND item_code IS NOT NULL
         AND item_code NOT IN (SELECT code FROM items WHERE company_id = 1)
      ) AS inventory_item_orphans,
      (SELECT COUNT(*) FROM supplier_transactions WHERE company_id = 1 AND account_code IS NOT NULL
         AND CAST(account_code AS TEXT) NOT IN (SELECT code FROM chart_of_accounts WHERE company_id = 1)
      ) AS supplier_account_orphans
  `)[0] || {}

  return {
    supplier_tx_orphans: Number(stats.supplier_tx_orphans || 0),
    inventory_item_orphans: Number(stats.inventory_item_orphans || 0),
    supplier_account_orphans: Number(stats.supplier_account_orphans || 0),
  }
}

function analyzeImportSql(config) {
  const sqlDir = path.join(BASE_DIR, config.source.sql_dir)
  const files = listSqlFiles(sqlDir)

  const allRows = {
    supplier_transactions: [],
    cash_transactions: [],
    inventory_movements: [],
  }

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8')
    const parsed = parseInsertStatements(content)
    for (const stmt of parsed) {
      if (allRows[stmt.table]) {
        allRows[stmt.table].push({ file: path.basename(filePath), row: stmt.row })
      }
    }
  }

  return {
    files_scanned: files.map(f => path.basename(f)),
    rows_by_table: allRows,
  }
}

function evaluateIdempotency(dbName, importRows) {
  const tables = ['supplier_transactions', 'cash_transactions', 'inventory_movements']
  const result = {}

  for (const table of tables) {
    const rows = importRows.rows_by_table[table]
    const seen = new Map()
    const duplicateInBatch = []

    for (const entry of rows) {
      const key = makeKey(table, entry.row)
      if (!key) continue
      if (seen.has(key)) {
        duplicateInBatch.push({
          key,
          first_file: seen.get(key),
          duplicate_file: entry.file,
        })
      } else {
        seen.set(key, entry.file)
      }
    }

    const existing = getExistingKeys(dbName, table)
    const collisions = []
    for (const [key, file] of seen.entries()) {
      if (existing.has(key)) {
        collisions.push({ key, file })
      }
    }

    const uniqueKeys = seen.size
    const collisionsCount = collisions.length
    const newRows = Math.max(uniqueKeys - collisionsCount, 0)

    let status = 'ready_to_import'
    if (duplicateInBatch.length > 0) {
      status = 'blocked_batch_duplicates'
    } else if (collisionsCount === 0) {
      status = 'ready_to_import'
    } else if (newRows === 0) {
      status = 'already_applied'
    } else {
      status = 'blocked_mixed_overlap'
    }

    result[table] = {
      total_rows: rows.length,
      unique_keys: uniqueKeys,
      new_rows: newRows,
      duplicate_keys_in_batch: duplicateInBatch.length,
      existing_db_collisions: collisionsCount,
      status,
      duplicate_examples: duplicateInBatch.slice(0, 15),
      collision_examples: collisions.slice(0, 15),
    }
  }

  return result
}

function summarize(config, checks, idempotency, refHealth) {
  const failedChecks = checks.filter(c => !c.ok)
  const tables = Object.values(idempotency)

  const idempotencyIssues = tables.reduce((acc, t) => {
    // Collisions are not a blocker when the entire staged set is already applied cleanly.
    const collisionPenalty = t.status === 'already_applied' ? 0 : t.existing_db_collisions
    return acc + t.duplicate_keys_in_batch + collisionPenalty
  }, 0)

  const hasMixedOverlap = tables.some(t => t.status === 'blocked_mixed_overlap')
  const hasBatchDupes = tables.some(t => t.duplicate_keys_in_batch > 0)
  const fullyAlreadyApplied = tables.every(t => t.status === 'already_applied')

  const referenceIssues =
    refHealth.supplier_tx_orphans +
    refHealth.inventory_item_orphans +
    refHealth.supplier_account_orphans

  const isReady = failedChecks.length === 0 && !hasMixedOverlap && !hasBatchDupes && referenceIssues === 0

  const pipelineState = fullyAlreadyApplied
    ? 'already_imported_clean'
    : isReady
    ? 'ready_to_import'
    : 'blocked'

  return {
    mode: STRICT_MODE || config.strict_default ? 'strict' : 'advisory',
    import_ready: isReady,
    pipeline_state: pipelineState,
    failed_checks: failedChecks.length,
    idempotency_issues: idempotencyIssues,
    reference_issues: referenceIssues,
  }
}

function printConsole(summary, checks, idempotency, reportPath) {
  console.log('')
  console.log('=== Phase 4 Import Pipeline Preparation ===')
  console.log(`Mode: ${summary.mode}`)
  console.log(`Import ready: ${summary.import_ready ? 'YES' : 'NO'}`)
  console.log(`Pipeline state: ${summary.pipeline_state}`)
  console.log(`Failed architecture checks: ${summary.failed_checks}`)
  console.log(`Idempotency issues: ${summary.idempotency_issues}`)
  console.log(`Reference issues: ${summary.reference_issues}`)

  const failed = checks.filter(c => !c.ok)
  if (failed.length > 0) {
    console.log('')
    console.log('MISALIGNMENTS (action required):')
    failed.forEach(c => {
      console.log(`- [${c.code}] ${c.message}`)
      console.log(`  Fix: ${c.fix}`)
    })
  }

  console.log('')
  console.log('Idempotency summary:')
  Object.entries(idempotency).forEach(([table, t]) => {
    console.log(`- ${table}: rows=${t.total_rows}, new_rows=${t.new_rows}, batch_duplicates=${t.duplicate_keys_in_batch}, db_collisions=${t.existing_db_collisions}, status=${t.status}`)
  })

  console.log('')
  console.log(`Report written: ${reportPath}`)
}

function main() {
  const config = readJson(CONFIG_PATH)
  const dbName = config.database.binding

  const checks = evaluatePostingGroupAlignment(dbName)
  const refHealth = evaluateReferenceHealth(dbName)
  const importRows = analyzeImportSql(config)
  const idempotency = evaluateIdempotency(dbName, importRows)
  const summary = summarize(config, checks, idempotency, refHealth)

  const report = {
    generated_at: new Date().toISOString(),
    strict_mode: STRICT_MODE || config.strict_default,
    summary,
    posting_group_alignment: checks,
    reference_health: refHealth,
    import_sql: {
      files_scanned: importRows.files_scanned,
      counts: {
        supplier_transactions: importRows.rows_by_table.supplier_transactions.length,
        cash_transactions: importRows.rows_by_table.cash_transactions.length,
        inventory_movements: importRows.rows_by_table.inventory_movements.length,
      },
    },
    idempotency,
    next_actions: [
      'Resolve all failed PG-PIPE checks before any import execution.',
      'Resolve idempotency collisions by deduplicating import_sql or adding source-level merge rules.',
      'Re-run: npm run import:pipeline:strict',
      'Execute imports only after summary.import_ready=true.'
    ],
  }

  if (summary.pipeline_state === 'already_imported_clean') {
    report.next_actions = [
      'Dataset is already imported cleanly based on configured idempotency keys.',
      'No import execution is required unless source data changed.',
      'If source changed, regenerate canonical SQL and re-run strict pipeline.'
    ]
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')
  printConsole(summary, checks, idempotency, REPORT_PATH)

  if ((STRICT_MODE || config.strict_default) && !summary.import_ready) {
    process.exit(1)
  }
}

main()
