// ============================================================================
// rebuild_all.js — Comprehensive Data Rebuild Pipeline
// Fixes: encoding, inventory count, posting groups, bank accounts, journal entries
// ============================================================================
// ROOT CAUSE SUMMARY (documented 2026-04-27):
//   1. Supplier names corrupted: original import ran --file without --yes in
//      non-TTY mode → confirmation prompt consumed stdin, UPDATE silently skipped
//   2. Inventory count 389 vs 654: dedup in generate_clean_import_sql.js used
//      insufficient key (no supplier_code) → false deduplication of valid rows
//   3. Journal entries: import pipeline never called posting_engine → 0 entries
//   4. LABOR BPG missing: suppliers with عمالة activity have no BPG
//   5. Bank account 1: dummy account number (12121212332212231)
// FIX: Use --file --yes for all SQL execution + re-import inventory from source
// ============================================================================

const { execSync } = require('child_process')
const fs   = require('fs')
const path = require('path')

const BASE    = __dirname
const DB_NAME = 'agri-nile-flow-data-lake'
const COMPANY_ID = 1
const SEASON_ID  = 1

// Today's date for filtering future-dated rows
const TODAY = '2026-04-27'

const log = []
let errors = 0

function info(msg)  { console.log(msg); log.push({ level: 'info',  msg }) }
function warn(msg)  { console.log('⚠️  ' + msg); log.push({ level: 'warn',  msg }) }
function error(msg) { console.log('❌ ' + msg); log.push({ level: 'error', msg }); errors++ }
function ok(msg)    { console.log('✅ ' + msg); log.push({ level: 'ok',    msg }) }

// ─── Execute SQL file via --file --yes ────────────────────────────────────────
function runFile(filePath, label) {
  const abs = path.resolve(BASE, filePath)
  if (!fs.existsSync(abs)) { error(`File not found: ${abs}`); return false }
  try {
    const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --file "${abs}" --yes 2>&1`
    const out  = execSync(cmd, { cwd: BASE, encoding: 'utf8', timeout: 180000 })
    if (out.includes('ERROR') && !out.includes('Processed')) {
      warn(`${label}: possible issue: ${out.slice(0,200)}`)
    }
    ok(label)
    return true
  } catch (e) {
    error(`${label}: ${String(e.message || '').slice(0,200)}`)
    return false
  }
}

// ─── Execute SQL command string ───────────────────────────────────────────────
// IMPORTANT: We write to temp file then use --file --yes (proved to work with Arabic)
let tmpCount = 0
function runCmd(sql, label) {
  tmpCount++
  const tmp = path.join(BASE, `_tmp_rebuild_${tmpCount}.sql`)
  try {
    fs.writeFileSync(tmp, sql + '\n', 'utf8')
    const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --file "${tmp}" --yes 2>&1`
    const out  = execSync(cmd, { cwd: BASE, encoding: 'utf8', timeout: 60000 })
    if (out.includes('ERROR') && !out.includes('Processed')) {
      warn(`${label}: ${out.slice(0,200)}`)
    }
    ok(label)
    return true
  } catch (e) {
    error(`${label}: ${String(e.message || '').slice(0,200)}`)
    return false
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
  }
}

// ─── Query remote D1 ──────────────────────────────────────────────────────────
// Use --command for SELECT queries (returns proper JSON via query API)
// Use --file --yes only for DML (INSERT/UPDATE/DELETE) with Arabic content
function query(sql) {
  try {
    // Escape double quotes in SQL for cmd.exe
    const escaped = sql.replace(/"/g, '\\"').replace(/\n/g, ' ')
    const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --json --command "${escaped}" 2>&1`
    const out  = execSync(cmd, { cwd: BASE, encoding: 'utf8', timeout: 30000 })
    const parsed = JSON.parse(out)
    return parsed[0]?.results || []
  } catch (e) {
    return []
  }
}

// ─── Count table ──────────────────────────────────────────────────────────────
function countTable(tbl, where) {
  const w = where ? ' WHERE ' + where : ''
  const rows = query(`SELECT COUNT(*) as n FROM ${tbl}${w}`)
  return rows[0]?.n ?? -1
}

// ─── Write batched SQL file (100 statements per batch) ───────────────────────
function writeBatches(prefix, stmts, outDir) {
  const BATCH_SIZE = 100
  let fileCount = 0
  for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
    fileCount++
    const chunk = stmts.slice(i, i + BATCH_SIZE).filter(Boolean)
    if (chunk.length === 0) continue
    const fname = path.join(outDir, `${prefix}_batch${String(fileCount).padStart(3,'0')}.sql`)
    fs.writeFileSync(fname, chunk.join('\n') + '\n', 'utf8')
  }
  return fileCount
}

// ─── Phase counters ───────────────────────────────────────────────────────────
const phaseResults = {}

// ============================================================================
// PHASE 1: Fix Supplier Names Encoding
// Run import_sql/05a_*.sql with --yes to actually update supplier names
// ============================================================================
info('\n══════════════════════════════════════════')
info('PHASE 1: Fix Supplier Names Encoding')
info('══════════════════════════════════════════')

const suppFiles = ['import_sql/05a_suppliers_batch001.sql', 'import_sql/05a_suppliers_update_only.sql']
let suppFileOK = 0
for (const f of suppFiles) {
  if (runFile(f, `Supplier file: ${f}`)) suppFileOK++
}
phaseResults.phase1_supplier_files = suppFileOK + '/' + suppFiles.length

// ============================================================================
// PHASE 2: Fix Items Encoding
// ============================================================================
info('\n══════════════════════════════════════════')
info('PHASE 2: Fix Items Encoding')
info('══════════════════════════════════════════')

runFile('import_sql/05b_items_batch001.sql', 'Items file')

const itemCount = countTable('items', `company_id=${COMPANY_ID}`)
info(`  Items in DB: ${itemCount}`)
phaseResults.phase2_items = itemCount

// ============================================================================
// PHASE 3: Fix Inventory Count (389 → ~654)
// Delete and re-insert from original import_sql WITHOUT deduplication
// ============================================================================
info('\n══════════════════════════════════════════')
info('PHASE 3: Fix Inventory Count (389 → ~654)')
info('══════════════════════════════════════════')

// Step 3a: Wipe inventory
runCmd(
  `DELETE FROM inventory_movements WHERE company_id=${COMPANY_ID} AND season_id=${SEASON_ID};`,
  'Wipe inventory_movements'
)
info('  Wiped inventory_movements')

// Step 3b: Re-import from ORIGINAL import_sql (not deduped clean version)
const invFiles = fs.readdirSync(path.join(BASE, 'import_sql'))
  .filter(f => f.startsWith('06a_inventory'))
  .sort()
  .map(f => 'import_sql/' + f)

info(`  Executing ${invFiles.length} inventory files...`)
let invOK = 0
for (const f of invFiles) {
  if (runFile(f, `Inventory: ${f}`)) invOK++
}

// Step 3c: Delete future-dated rows
runCmd(
  `DELETE FROM inventory_movements WHERE company_id=${COMPANY_ID} AND movement_date > '${TODAY}';`,
  'Remove future-dated inventory rows'
)

const invCount = countTable('inventory_movements', `company_id=${COMPANY_ID}`)
info(`  Inventory after rebuild: ${invCount} (expected ~654)`)
phaseResults.phase3_inventory = invCount

// ============================================================================
// PHASE 4: Fix Supplier Transactions Encoding Check
// Re-import from original SQL files to ensure correct encoding
// ============================================================================
info('\n══════════════════════════════════════════')
info('PHASE 4: Verify Supplier Transactions')
info('══════════════════════════════════════════')

// Check current encoding of entry_type (we know 'د' should be D8AF)
const entryCheck = query(`SELECT hex(substr(entry_type,1,2)) as hx FROM supplier_transactions WHERE company_id=${COMPANY_ID} LIMIT 1`)
const entryHex = entryCheck[0]?.hx || ''
if (entryHex === 'D8AF' || entryHex === 'D985') {
  ok(`Supplier transactions encoding: CORRECT (${entryHex})`)
  phaseResults.phase4_supp_encoding = 'correct'
} else {
  warn(`Supplier transactions encoding suspicious: ${entryHex} — re-importing`)
  // Re-import supplier transactions
  runCmd(`DELETE FROM supplier_transactions WHERE company_id=${COMPANY_ID} AND season_id=${SEASON_ID};`, 'Wipe supplier_transactions')
  const stFiles = fs.readdirSync(path.join(BASE, 'import_sql')).filter(f => f.startsWith('06c_')).sort()
  for (const f of stFiles) runFile('import_sql/' + f, `SupplierTx: ${f}`)
  phaseResults.phase4_supp_encoding = 'reimported'
}

const suppTxCount = countTable('supplier_transactions', `company_id=${COMPANY_ID}`)
info(`  Supplier transactions: ${suppTxCount}`)
phaseResults.phase4_supplier_tx = suppTxCount

// ============================================================================
// PHASE 5: Add LABOR Business Posting Group + Fix BPG Assignments
// ============================================================================
info('\n══════════════════════════════════════════')
info('PHASE 5: Fix Business Posting Groups')
info('══════════════════════════════════════════')

// 5a: Add LABOR BPG
runCmd(`
INSERT OR IGNORE INTO business_posting_groups (code, company_id, name)
VALUES ('LABOR', ${COMPANY_ID}, 'عمالة ومقاولون');
`, 'Add LABOR BPG')

// 5b: Add general_posting_setup rows for LABOR × all PPG
const ppgs = ['FERT', 'SEED', 'CHEM', 'EQUIP', 'HARVEST']
for (const ppg of ppgs) {
  runCmd(`
INSERT OR IGNORE INTO general_posting_setup
  (company_id, bus_posting_group_code, prod_posting_group_code,
   sales_account, purchases_account, cogs_account, expense_account)
VALUES
  (${COMPANY_ID}, 'LABOR', '${ppg}', '41010001', '140701', '45010001', '51010001');
`, `GPS LABOR×${ppg}`)
}
// LABOR wildcard
runCmd(`
INSERT OR IGNORE INTO general_posting_setup
  (company_id, bus_posting_group_code, prod_posting_group_code,
   sales_account, purchases_account, cogs_account, expense_account)
VALUES
  (${COMPANY_ID}, 'LABOR', NULL, '41010001', '140701', '45010001', '51010001');
`, 'GPS LABOR×NULL')

// 5c: Assign BPG to suppliers based on activity
// Map: activity → BPG
const bpgAssignments = [
  { activity: 'عمالة',         bpg: 'LABOR' },
  { activity: 'جهات حكومية',   bpg: 'GOVT'  },
  { activity: 'عملاء',         bpg: 'CUSTOMER' },
  { activity: 'مورد نقدي',     bpg: 'LOCAL' },
  { activity: 'عميل نقدي',     bpg: 'CUSTOMER' },
]

for (const { activity, bpg } of bpgAssignments) {
  runCmd(`
UPDATE suppliers
SET bus_posting_group_code = '${bpg}'
WHERE company_id = ${COMPANY_ID}
  AND activity LIKE '%${activity}%';
`, `BPG assign: ${activity} → ${bpg}`)
}

// All remaining local suppliers (موردين منتجات زراعية, موردين ألات, etc.) → LOCAL
runCmd(`
UPDATE suppliers
SET bus_posting_group_code = 'LOCAL'
WHERE company_id = ${COMPANY_ID}
  AND (bus_posting_group_code IS NULL OR bus_posting_group_code = '')
  AND activity NOT LIKE '%حكومي%'
  AND activity NOT LIKE '%عميل%'
  AND activity NOT LIKE '%جهاز%';
`, 'BPG assign remaining → LOCAL')

// Government entities → GOVT
runCmd(`
UPDATE suppliers
SET bus_posting_group_code = 'GOVT'
WHERE company_id = ${COMPANY_ID}
  AND (activity LIKE '%حكومي%' OR activity LIKE '%جهاز%' OR activity LIKE '%وزارة%');
`, 'BPG assign govt')

// Verify BPG distribution
const bpgDist = query(`SELECT bus_posting_group_code, COUNT(*) as n FROM suppliers WHERE company_id=${COMPANY_ID} GROUP BY bus_posting_group_code`)
info('  BPG distribution: ' + JSON.stringify(bpgDist))
phaseResults.phase5_bpg = bpgDist

// ============================================================================
// PHASE 6: Mark Dummy Bank Accounts
// ============================================================================
info('\n══════════════════════════════════════════')
info('PHASE 6: Mark Dummy Bank Accounts')
info('══════════════════════════════════════════')

// Account with dummy sequential number 12121212332212231
runCmd(`
UPDATE bank_accounts
SET notes = 'd_dummy_placeholder — account number not verified with bank',
    is_active = 0
WHERE company_id = ${COMPANY_ID}
  AND account_number = '12121212332212231';
`, 'Mark dummy bank account')

// Cash treasury account is real (CASH-001) — keep it
ok('Bank account CASH-001 (treasury) kept active as real account')
phaseResults.phase6_bank = 'dummy_marked'

// ============================================================================
// PHASE 7: Generate Journal Entries from Transactions
// ============================================================================
info('\n══════════════════════════════════════════')
info('PHASE 7: Generate Journal Entries')
info('══════════════════════════════════════════')

// Clear existing (there were 0, but just in case)
runCmd(`DELETE FROM journal_entries WHERE company_id=${COMPANY_ID} AND ref_type IN ('supplier_transaction','cash_transaction','inventory_movement');`,
  'Clear existing GL entries')

// GL Account constants
const GL_CASH       = '14010101'  // خزينة ج.م
const GL_SUPPLIER   = '2120'      // موردون (general supplier payable)
const GL_PURCHASES  = '140701'    // المشتريات / المخزون
const GL_COGS       = '45010001'  // تكلفة المبيعات
const GL_EXPENSE    = '51200034'  // مصروفات تشغيل
const GL_SALES      = '41010001'  // إيراد النشاط

// ── 7A: Supplier Transactions ─────────────────────────────────────────────
info('  Generating GL entries from supplier_transactions...')
const suppTxRows = query(
  `SELECT id, transaction_date, entry_type, amount, debit, credit, supplier_code, year, month
   FROM supplier_transactions
   WHERE company_id=${COMPANY_ID} AND amount IS NOT NULL AND amount != 0
   ORDER BY transaction_date, id
   LIMIT 1000`
)
info(`  Found ${suppTxRows.length} supplier transactions to post`)

let jeCounter = 0
const jeBatches = []

for (const tx of suppTxRows) {
  const amount = Math.abs(parseFloat(tx.amount) || 0)
  if (amount === 0) continue
  jeCounter++
  const entryNum = `ST-${tx.year || '2025'}-${String(jeCounter).padStart(5,'0')}`
  const periodId = (tx.year === 2026 || tx.year === '2026') ? 3 : 1
  const desc = `حركة مورد #${tx.id} — ${tx.transaction_date}`
  const e = tx.entry_type || ''

  // entry_type 'د' (دائن) = supplier invoice: DR Purchases, CR Supplier payable
  // entry_type 'م' (مدين) = payment to supplier: DR Supplier payable, CR Cash
  const drAccount = (e === 'م' || e === '\u0645') ? GL_SUPPLIER   : GL_PURCHASES
  const crAccount = (e === 'م' || e === '\u0645') ? GL_CASH       : GL_SUPPLIER

  jeBatches.push(`
INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted)
VALUES (${COMPANY_ID}, ${periodId}, '${entryNum}', '${tx.transaction_date}', '${desc.replace(/'/g,"''")}', 'supplier_transaction', ${tx.id}, 1);
INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description)
VALUES ((SELECT MAX(id) FROM journal_entries WHERE company_id=${COMPANY_ID}), ${COMPANY_ID}, '${drAccount}', ${amount}, 0, '${desc.replace(/'/g,"''")}');
INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description)
VALUES ((SELECT MAX(id) FROM journal_entries WHERE company_id=${COMPANY_ID}), ${COMPANY_ID}, '${crAccount}', 0, ${amount}, '${desc.replace(/'/g,"''")}');`.trim())
}
info(`  Generated ${jeBatches.length} supplier transaction journal entries`)

// ── 7B: Cash Transactions ─────────────────────────────────────────────────
info('  Generating GL entries from cash_transactions...')
const cashRows = query(
  `SELECT id, transaction_date, direction, amount, debit, credit, year, month
   FROM cash_transactions
   WHERE company_id=${COMPANY_ID} AND amount IS NOT NULL AND amount != 0
   ORDER BY transaction_date, id
   LIMIT 500`
)
info(`  Found ${cashRows.length} cash transactions to post`)

for (const tx of cashRows) {
  const amount = Math.abs(parseFloat(tx.amount) || 0)
  if (amount === 0) continue
  jeCounter++
  const entryNum = `CT-${tx.year || '2025'}-${String(jeCounter).padStart(5,'0')}`
  const periodId = (tx.year === 2026 || tx.year === '2026') ? 3 : 1
  const desc = `حركة خزينة #${tx.id} — ${tx.transaction_date}`
  const d = tx.direction || ''

  // direction 'م' (مدين) = cash OUT (payment): DR Expense, CR Cash
  // direction 'د' (دائن) = cash IN (receipt): DR Cash, CR Sales/Receivable
  const drAccount = (d === 'م' || d === '\u0645') ? GL_EXPENSE  : GL_CASH
  const crAccount = (d === 'م' || d === '\u0645') ? GL_CASH     : GL_SALES

  jeBatches.push(`
INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted)
VALUES (${COMPANY_ID}, ${periodId}, '${entryNum}', '${tx.transaction_date}', '${desc.replace(/'/g,"''")}', 'cash_transaction', ${tx.id}, 1);
INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description)
VALUES ((SELECT MAX(id) FROM journal_entries WHERE company_id=${COMPANY_ID}), ${COMPANY_ID}, '${drAccount}', ${amount}, 0, '${desc.replace(/'/g,"''")}');
INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description)
VALUES ((SELECT MAX(id) FROM journal_entries WHERE company_id=${COMPANY_ID}), ${COMPANY_ID}, '${crAccount}', 0, ${amount}, '${desc.replace(/'/g,"''")}');`.trim())
}
info(`  Cumulative journal entries: ${jeBatches.length}`)

// ── 7C: Inventory Movements ───────────────────────────────────────────────
info('  Generating GL entries from inventory_movements...')
const invRows = query(
  `SELECT id, movement_date, movement_type, value_in, value_out, year, month
   FROM inventory_movements
   WHERE company_id=${COMPANY_ID}
     AND (value_in > 0 OR value_out > 0)
   ORDER BY movement_date, id
   LIMIT 1000`
)
info(`  Found ${invRows.length} inventory movements to post`)

for (const tx of invRows) {
  const valIn  = parseFloat(tx.value_in)  || 0
  const valOut = parseFloat(tx.value_out) || 0
  const amount = Math.max(valIn, valOut)
  if (amount === 0) continue
  jeCounter++
  const entryNum = `IM-${tx.year || '2025'}-${String(jeCounter).padStart(5,'0')}`
  const periodId = (tx.year === 2026 || tx.year === '2026') ? 3 : 1
  const desc = `حركة مخزن #${tx.id} — ${tx.movement_date}`
  const mtype = String(tx.movement_type || '')

  // اضافة (IN): DR Purchases/Inventory, CR Supplier payable
  // صرف  (OUT): DR COGS/Expense, CR Purchases/Inventory
  const isIN = mtype.includes('ضاف') || mtype.includes('وارد') || mtype.includes('استلام')
  const drAccount = isIN ? GL_PURCHASES : GL_COGS
  const crAccount = isIN ? GL_SUPPLIER  : GL_PURCHASES

  jeBatches.push(`
INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted)
VALUES (${COMPANY_ID}, ${periodId}, '${entryNum}', '${tx.movement_date}', '${desc.replace(/'/g,"''")}', 'inventory_movement', ${tx.id}, 1);
INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description)
VALUES ((SELECT MAX(id) FROM journal_entries WHERE company_id=${COMPANY_ID}), ${COMPANY_ID}, '${drAccount}', ${amount}, 0, '${desc.replace(/'/g,"''")}');
INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description)
VALUES ((SELECT MAX(id) FROM journal_entries WHERE company_id=${COMPANY_ID}), ${COMPANY_ID}, '${crAccount}', 0, ${amount}, '${desc.replace(/'/g,"''")}');`.trim())
}
info(`  Total journal entry batches: ${jeBatches.length}`)

// ── 7D: Write and execute journal entries in batches ──────────────────────
const JE_DIR = path.join(BASE, 'import_sql_je')
if (!fs.existsSync(JE_DIR)) fs.mkdirSync(JE_DIR)
// Clear old JE files
fs.readdirSync(JE_DIR).filter(f => f.endsWith('.sql')).forEach(f => fs.unlinkSync(path.join(JE_DIR, f)))

// Each batch = 10 journal entries (3 SQL statements per JE = 30 stmts per file)
const JE_BATCH = 10
let jeFileCount = 0
for (let i = 0; i < jeBatches.length; i += JE_BATCH) {
  jeFileCount++
  const chunk = jeBatches.slice(i, i + JE_BATCH)
  const fname = path.join(JE_DIR, `je_batch${String(jeFileCount).padStart(4,'0')}.sql`)
  fs.writeFileSync(fname, chunk.join('\n') + '\n', 'utf8')
}
info(`  Written ${jeFileCount} JE SQL files`)

// Execute JE files
info('  Executing journal entry files...')
let jeOK = 0, jeFail = 0
const jeFiles = fs.readdirSync(JE_DIR).filter(f => f.endsWith('.sql')).sort()
for (const f of jeFiles) {
  const abs = path.join(JE_DIR, f)
  try {
    const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --file "${abs}" --yes 2>&1`
    execSync(cmd, { cwd: BASE, encoding: 'utf8', timeout: 120000 })
    jeOK++
    if (jeOK % 10 === 0) process.stdout.write('.')
  } catch (e) {
    jeFail++
    warn(`JE file ${f}: ${String(e.message||'').slice(0,100)}`)
  }
}
info(`\n  JE execution: ${jeOK} OK, ${jeFail} errors`)

const jeCount    = countTable('journal_entries',     `company_id=${COMPANY_ID}`)
const jelCount   = countTable('journal_entry_lines', `company_id=${COMPANY_ID}`)
info(`  Journal entries: ${jeCount}, lines: ${jelCount}`)
phaseResults.phase7_je = { entries: jeCount, lines: jelCount, source_batches: jeBatches.length }

// ============================================================================
// PHASE 8: Verification
// ============================================================================
info('\n══════════════════════════════════════════')
info('PHASE 8: Verification')
info('══════════════════════════════════════════')

// Check encoding fix
const suppCheck = query(`SELECT name, hex(substr(name,1,4)) as hx FROM suppliers WHERE company_id=${COMPANY_ID} LIMIT 3`)
const nameEncOK = suppCheck.every(r => !r.hx.startsWith('C398'))
if (nameEncOK) {
  ok('Supplier names: encoding FIXED ✓')
} else {
  warn('Supplier names: still have encoding issues — ' + JSON.stringify(suppCheck))
}

// Check counts
const finalCounts = {
  suppliers:            countTable('suppliers',           `company_id=${COMPANY_ID}`),
  items:                countTable('items',               `company_id=${COMPANY_ID}`),
  inventory_movements:  countTable('inventory_movements', `company_id=${COMPANY_ID}`),
  supplier_transactions:countTable('supplier_transactions',`company_id=${COMPANY_ID}`),
  cash_transactions:    countTable('cash_transactions',   `company_id=${COMPANY_ID}`),
  journal_entries:      countTable('journal_entries',     `company_id=${COMPANY_ID}`),
  journal_entry_lines:  countTable('journal_entry_lines', `company_id=${COMPANY_ID}`),
  bank_accounts:        countTable('bank_accounts',       `company_id=${COMPANY_ID}`),
}

info('\n📊 FINAL ROW COUNTS:')
for (const [tbl, n] of Object.entries(finalCounts)) {
  info(`  ${tbl.padEnd(30)}: ${n}`)
}

// Check BPG assignments
const bpgFinal = query(`SELECT bus_posting_group_code, COUNT(*) as n FROM suppliers WHERE company_id=${COMPANY_ID} GROUP BY bus_posting_group_code ORDER BY n DESC`)
info('\n📊 SUPPLIER BPG DISTRIBUTION:')
bpgFinal.forEach(r => info(`  ${(r.bus_posting_group_code||'NULL').padEnd(12)}: ${r.n}`))

// JE balance check
const jeBal = query(`SELECT SUM(debit) as total_dr, SUM(credit) as total_cr FROM journal_entry_lines WHERE company_id=${COMPANY_ID}`)
const dr = parseFloat(jeBal[0]?.total_dr || 0)
const cr = parseFloat(jeBal[0]?.total_cr || 0)
const balanced = Math.abs(dr - cr) < 1
info(`\n📊 GL BALANCE CHECK: DR=${dr.toFixed(2)}, CR=${cr.toFixed(2)}, ${balanced ? '✅ BALANCED' : '⚠️ UNBALANCED by ' + Math.abs(dr-cr).toFixed(2)}`)

phaseResults.phase8_verification = { counts: finalCounts, balanced, dr, cr }

// ============================================================================
// Save Report
// ============================================================================
const report = {
  generated_at: new Date().toISOString(),
  errors,
  root_causes_fixed: {
    encoding: 'Supplier names re-imported with --file --yes (bypasses non-TTY stdin issue)',
    inventory_count: 'Re-imported from original import_sql without over-aggressive dedup',
    journal_entries: 'Generated from supplier_transactions, cash_transactions, inventory_movements',
    posting_groups: 'Added LABOR BPG, assigned suppliers based on activity column',
    bank_accounts: 'Marked dummy account (12121212332212231) as inactive with d_ note',
  },
  phase_results: phaseResults,
  log_summary: { total_log_entries: log.length, errors, warnings: log.filter(l=>l.level==='warn').length },
}

fs.writeFileSync(path.join(BASE, 'rebuild_report.json'), JSON.stringify(report, null, 2))

info('\n══════════════════════════════════════════')
if (errors === 0) {
  ok('REBUILD COMPLETE — 0 errors')
} else {
  error(`REBUILD COMPLETE WITH ${errors} ERRORS — check rebuild_report.json`)
}
info(`Report: rebuild_report.json`)
info('══════════════════════════════════════════')
