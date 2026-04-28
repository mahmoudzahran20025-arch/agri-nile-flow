#!/usr/bin/env node
/*
 * Generate canonical deduplicated import SQL files.
 * - Reads all files in import_sql/
 * - Keeps first occurrence per idempotency key for transaction tables
 * - Preserves non-transaction statements unchanged
 * - Writes output to import_sql_clean/
 */

const fs = require('fs')
const path = require('path')

const BASE_DIR = __dirname
const SRC_DIR = path.join(BASE_DIR, 'import_sql')
const OUT_DIR = path.join(BASE_DIR, 'import_sql_clean')
const REPORT_PATH = path.join(BASE_DIR, 'import_sql_clean_report.json')

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

  if (current.trim()) parts.push(current.trim())
  return parts
}

function parseSqlLiteral(value) {
  const v = String(value || '').trim()
  if (!v) return null
  if (v.toUpperCase() === 'NULL') return null
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'").trim()
  const n = Number(v)
  if (!Number.isNaN(n)) return n
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

function parseInsertStatement(stmt) {
  const re = /^\s*INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)\s*;\s*$/i
  const m = stmt.match(re)
  if (!m) return null

  const table = m[1].trim()
  const cols = splitCsvTopLevel(m[2]).map(s => s.trim())
  const vals = splitCsvTopLevel(m[3]).map(parseSqlLiteral)
  if (cols.length !== vals.length) return null

  const row = {}
  for (let i = 0; i < cols.length; i++) row[cols[i]] = vals[i]
  return { table, row }
}

function splitStatements(content) {
  const lines = content.split(/\r?\n/)
  const statements = []
  let buffer = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('--') || trimmed === '') {
      if (buffer.length > 0) buffer.push(line)
      continue
    }

    buffer.push(line)
    if (trimmed.endsWith(';')) {
      statements.push(buffer.join('\n'))
      buffer = []
    }
  }

  if (buffer.length > 0) statements.push(buffer.join('\n'))
  return statements
}

function ensureOutDir() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR)
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    throw new Error('import_sql directory not found.')
  }

  ensureOutDir()

  const files = fs.readdirSync(SRC_DIR).filter(f => f.toLowerCase().endsWith('.sql')).sort()
  const transactionTables = new Set(['supplier_transactions', 'cash_transactions', 'inventory_movements'])
  const seen = {
    supplier_transactions: new Set(),
    cash_transactions: new Set(),
    inventory_movements: new Set(),
  }

  const report = {
    generated_at: new Date().toISOString(),
    files: [],
    totals: {
      input_statements: 0,
      output_statements: 0,
      dropped_duplicates: 0,
    },
    dropped_by_table: {
      supplier_transactions: 0,
      cash_transactions: 0,
      inventory_movements: 0,
    },
  }

  for (const file of files) {
    const srcPath = path.join(SRC_DIR, file)
    const outPath = path.join(OUT_DIR, file)
    const content = fs.readFileSync(srcPath, 'utf8')
    const statements = splitStatements(content)
    const outputStatements = []

    let kept = 0
    let dropped = 0

    for (const stmt of statements) {
      const parsed = parseInsertStatement(stmt)
      report.totals.input_statements += 1

      if (!parsed || !transactionTables.has(parsed.table)) {
        outputStatements.push(stmt)
        kept += 1
        report.totals.output_statements += 1
        continue
      }

      const key = makeKey(parsed.table, parsed.row)
      if (!key) {
        outputStatements.push(stmt)
        kept += 1
        report.totals.output_statements += 1
        continue
      }

      if (seen[parsed.table].has(key)) {
        dropped += 1
        report.totals.dropped_duplicates += 1
        report.dropped_by_table[parsed.table] += 1
        continue
      }

      seen[parsed.table].add(key)
      outputStatements.push(stmt)
      kept += 1
      report.totals.output_statements += 1
    }

    fs.writeFileSync(outPath, outputStatements.join('\n\n') + '\n', 'utf8')
    report.files.push({ file, kept, dropped, input: statements.length, output: outputStatements.length })
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')

  console.log('Canonical SQL generated in import_sql_clean/')
  console.log(`Dropped duplicates: ${report.totals.dropped_duplicates}`)
  console.log(`Report: ${REPORT_PATH}`)
}

main()
