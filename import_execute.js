// import_execute.js — Execute all generated SQL files against D1 remote
// Usage: node import_execute.js [prefix_filter]
// Example: node import_execute.js 05  → run only phase 5 files

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const BASE    = 'C:\\Users\\mahmo\\Contacts\\CLAUDE_CO WORK MY WORK\\agri-nile-flow';
const SQL_DIR = path.join(BASE, 'import_sql');
const DB_NAME = 'agri-nile-flow-data-lake';
const PREFIX  = process.argv[2] || '';

const files = fs.readdirSync(SQL_DIR)
  .filter(f => f.endsWith('.sql') && f.includes(PREFIX))
  .sort();

if (files.length === 0) {
  console.log(`No SQL files matching prefix "${PREFIX}" in ${SQL_DIR}`);
  process.exit(1);
}

console.log(`\nExecuting ${files.length} SQL files against ${DB_NAME}...`);

const results = [];
let totalInserts = 0;
let errorCount   = 0;

for (const file of files) {
  const filePath = path.join(SQL_DIR, file);
  const content  = fs.readFileSync(filePath, 'utf8');
  const stmts    = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('--')).length;

  process.stdout.write(`  [${file}] (${stmts} stmts)... `);

  try {
    const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --file "${filePath}" 2>&1`;
    const out  = execSync(cmd, { cwd: BASE, encoding: 'utf8', timeout: 120000 });
    const ok   = out.includes('Executed') || out.includes('command');
    console.log(ok ? '✓ OK' : `? ${out.substring(0, 100)}`);
    results.push({ file, status: 'ok', stmts });
    totalInserts += stmts;
  } catch (e) {
    const msg = e.message || e.stdout || '';
    console.log(`✗ ERROR: ${msg.substring(0, 150)}`);
    results.push({ file, status: 'error', error: msg.substring(0, 200) });
    errorCount++;
  }
}

console.log(`\n=== EXECUTION SUMMARY ===`);
console.log(`  Total files:  ${files.length}`);
console.log(`  Success:      ${files.length - errorCount}`);
console.log(`  Errors:       ${errorCount}`);
console.log(`  Total stmts:  ${totalInserts}`);

const reportPath = path.join(BASE, 'import_execution_log.json');
fs.writeFileSync(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
console.log(`\nReport saved: ${reportPath}`);
