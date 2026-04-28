// import_execute_clean.js
// Execute SQL files from import_sql_clean (or custom folder) against remote D1.
// Usage:
//   node import_execute_clean.js
//   node import_execute_clean.js 06   (prefix filter)
//   node import_execute_clean.js "" import_sql_clean

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const BASE = __dirname
const PREFIX = process.argv[2] || ''
const DIR_NAME = process.argv[3] || 'import_sql_clean'
const SQL_DIR = path.join(BASE, DIR_NAME)
const DB_NAME = 'agri-nile-flow-data-lake'

if (!fs.existsSync(SQL_DIR)) {
  console.error(`SQL directory does not exist: ${SQL_DIR}`)
  process.exit(1)
}

const files = fs.readdirSync(SQL_DIR)
  .filter(f => f.endsWith('.sql') && f.includes(PREFIX))
  .sort()

if (files.length === 0) {
  console.log(`No SQL files matching prefix "${PREFIX}" in ${SQL_DIR}`)
  process.exit(1)
}

console.log(`Executing ${files.length} SQL files from ${DIR_NAME} against ${DB_NAME}...`)

const results = []
let okCount = 0
let errCount = 0

for (const file of files) {
  const filePath = path.join(SQL_DIR, file)
  process.stdout.write(`  [${file}] ... `)

  try {
    const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --file "${filePath}" 2>&1`
    execSync(cmd, { cwd: BASE, encoding: 'utf8', timeout: 180000 })
    console.log('OK')
    results.push({ file, status: 'ok' })
    okCount += 1
  } catch (e) {
    const msg = String(e.stdout || e.message || '').slice(0, 300)
    console.log(`ERROR: ${msg}`)
    results.push({ file, status: 'error', error: msg })
    errCount += 1
  }
}

const reportPath = path.join(BASE, 'import_execution_clean_log.json')
fs.writeFileSync(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), dir: DIR_NAME, prefix: PREFIX, results }, null, 2))

console.log('\n=== CLEAN EXECUTION SUMMARY ===')
console.log(`Success: ${okCount}`)
console.log(`Errors: ${errCount}`)
console.log(`Report: ${reportPath}`)

process.exit(errCount > 0 ? 1 : 0)
