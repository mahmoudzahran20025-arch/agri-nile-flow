#!/usr/bin/env node
const { execSync } = require('node:child_process')

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

function runSqlJson(sql) {
  const compactSql = sql.replace(/\s+/g, ' ').trim()
  const escapedSql = compactSql.replace(/"/g, '\\"')
  const command = `npx wrangler d1 execute ${DB_NAME} --remote --json --command "${escapedSql}"`
  const raw = execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 })
  return parseJsonBlock(raw)
}

function runSql(sql) {
  const compactSql = sql.replace(/\s+/g, ' ').trim()
  const escapedSql = compactSql.replace(/"/g, '\\"')
  const command = `npx wrangler d1 execute ${DB_NAME} --remote --yes --command "${escapedSql}"`
  return execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 })
}

function getCashColumns() {
  const rows = runSqlJson('PRAGMA table_info(cash_transactions);')
  return rows[0]?.results?.map((row) => row.name) ?? []
}

function getAuditSummary() {
  const rows = runSqlJson(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN direction = 'م' THEN 1 ELSE 0 END) AS outflow_count,
      SUM(CASE WHEN direction = 'د' THEN 1 ELSE 0 END) AS inflow_count,
      SUM(CASE WHEN direction = 'م' AND debit > 0 AND credit = 0 THEN 1 ELSE 0 END) AS outflow_debit_only,
      SUM(CASE WHEN direction = 'د' AND credit > 0 AND debit = 0 THEN 1 ELSE 0 END) AS inflow_credit_only,
      SUM(CASE WHEN direction = 'م' AND expense_code IS NOT NULL THEN 1 ELSE 0 END) AS outflow_with_expense,
      SUM(CASE WHEN direction = 'د' AND expense_code IS NOT NULL THEN 1 ELSE 0 END) AS inflow_with_expense
    FROM cash_transactions
    WHERE company_id = ${COMPANY_ID} AND status = 'posted';
  `)
  return rows[0]?.results?.[0] ?? null
}

function getEntryTypeCoverage() {
  const rows = runSqlJson(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN entry_type IS NOT NULL THEN 1 ELSE 0 END) AS with_entry_type,
      SUM(CASE WHEN entry_type IS NULL THEN 1 ELSE 0 END) AS missing_entry_type,
      SUM(CASE WHEN entry_type = direction THEN 1 ELSE 0 END) AS direction_match,
      SUM(CASE WHEN entry_type IS NOT NULL AND entry_type <> direction THEN 1 ELSE 0 END) AS direction_mismatch
    FROM cash_transactions
    WHERE company_id = ${COMPANY_ID} AND status = 'posted';
  `)
  return rows[0]?.results?.[0] ?? null
}

function main() {
  console.log('============================================================')
  console.log('PHASE 4 PREP: CASH ENTRY_TYPE NORMALIZATION')
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)
  console.log('============================================================')

  const beforeSummary = getAuditSummary()
  console.log('Live audit snapshot:', beforeSummary)

  const columns = getCashColumns()
  const hasEntryType = columns.includes('entry_type')
  console.log(`cash_transactions.entry_type exists: ${hasEntryType ? 'yes' : 'no'}`)

  if (!APPLY) {
    console.log('\nDry-run outcome:')
    console.log(`- Column action: ${hasEntryType ? 'skip add-column' : 'would add entry_type column'}`)
    console.log('- Backfill rule: entry_type := direction when direction/debit/credit pattern is deterministic')
    console.log('- Audit table: phase4_cash_entry_type_audit')
    return
  }

  if (!hasEntryType) {
    runSql('ALTER TABLE cash_transactions ADD COLUMN entry_type TEXT;')
    console.log('Added cash_transactions.entry_type')
  }

  runSql(`
    CREATE TABLE IF NOT EXISTS phase4_cash_entry_type_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      cash_transaction_id INTEGER NOT NULL,
      old_entry_type TEXT,
      new_entry_type TEXT NOT NULL,
      direction TEXT,
      debit REAL,
      credit REAL,
      audit_reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  runSql(`
    INSERT INTO phase4_cash_entry_type_audit (
      company_id, cash_transaction_id, old_entry_type, new_entry_type,
      direction, debit, credit, audit_reason
    )
    SELECT
      company_id,
      id,
      entry_type,
      CASE
        WHEN direction = 'م' AND COALESCE(debit, 0) > 0 AND COALESCE(credit, 0) = 0 THEN 'م'
        WHEN direction = 'د' AND COALESCE(credit, 0) > 0 AND COALESCE(debit, 0) = 0 THEN 'د'
        WHEN direction IN ('د', 'م') AND COALESCE(debit, 0) = 0 AND COALESCE(credit, 0) = 0 THEN direction
      END,
      direction,
      debit,
      credit,
      'Phase 4 canonical entry_type inferred from direction and single-sided amount columns'
    FROM cash_transactions
    WHERE company_id = ${COMPANY_ID}
      AND status = 'posted'
      AND COALESCE(entry_type, '') = ''
      AND CASE
        WHEN direction = 'م' AND COALESCE(debit, 0) > 0 AND COALESCE(credit, 0) = 0 THEN 'م'
        WHEN direction = 'د' AND COALESCE(credit, 0) > 0 AND COALESCE(debit, 0) = 0 THEN 'د'
        WHEN direction IN ('د', 'م') AND COALESCE(debit, 0) = 0 AND COALESCE(credit, 0) = 0 THEN direction
      END IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM phase4_cash_entry_type_audit a
        WHERE a.company_id = cash_transactions.company_id
          AND a.cash_transaction_id = cash_transactions.id
      );
  `)

  runSql(`
    UPDATE cash_transactions
    SET entry_type = CASE
      WHEN direction = 'م' AND COALESCE(debit, 0) > 0 AND COALESCE(credit, 0) = 0 THEN 'م'
      WHEN direction = 'د' AND COALESCE(credit, 0) > 0 AND COALESCE(debit, 0) = 0 THEN 'د'
      WHEN direction IN ('د', 'م') AND COALESCE(debit, 0) = 0 AND COALESCE(credit, 0) = 0 THEN direction
      ELSE entry_type
    END
    WHERE company_id = ${COMPANY_ID}
      AND status = 'posted'
      AND COALESCE(entry_type, '') = '';
  `)

  const afterCoverage = getEntryTypeCoverage()
  const auditRows = runSqlJson(`
    SELECT COUNT(*) AS audit_rows
    FROM phase4_cash_entry_type_audit
    WHERE company_id = ${COMPANY_ID};
  `)[0]?.results?.[0] ?? null

  console.log('Post-apply coverage:', afterCoverage)
  console.log('Audit rows:', auditRows)
}

main()