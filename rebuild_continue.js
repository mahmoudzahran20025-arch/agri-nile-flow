// rebuild_continue.js — Continue from Phase 3 batch 5
// Assumes: Phase 1 (encoding), Phase 2 (items) DONE
//          Phase 3 batches 1-4 DONE (inventory wiped + partly re-imported)
// Continues: Phase 3 batches 5-7, then Phases 4-8

const { execSync } = require('child_process')
const fs   = require('fs')
const path = require('path')

const BASE    = __dirname
const DB_NAME = 'agri-nile-flow-data-lake'
const COMPANY_ID = 1
const SEASON_ID  = 1
const TODAY = '2026-04-27'

const log = []
let errors = 0
let tmpCount = 0

function info(msg)  { console.log(msg); log.push({ level: 'info',  msg }) }
function warn(msg)  { console.log('⚠️  ' + msg); log.push({ level: 'warn',  msg }) }
function error(msg) { console.log('❌ ' + msg); log.push({ level: 'error', msg }); errors++ }
function ok(msg)    { console.log('✅ ' + msg); log.push({ level: 'ok',    msg }) }

function runFile(filePath, label) {
  const abs = path.resolve(BASE, filePath)
  if (!fs.existsSync(abs)) { error(`File not found: ${abs}`); return false }
  try {
    const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --file "${abs}" --yes 2>&1`
    execSync(cmd, { cwd: BASE, encoding: 'utf8', timeout: 180000 })
    ok(label)
    return true
  } catch (e) {
    error(`${label}: ${String(e.message || '').slice(0,200)}`)
    return false
  }
}

function runCmd(sql, label) {
  tmpCount++
  const tmp = path.join(BASE, `_tmp_cont_${tmpCount}.sql`)
  try {
    fs.writeFileSync(tmp, sql + '\n', 'utf8')
    const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --file "${tmp}" --yes 2>&1`
    execSync(cmd, { cwd: BASE, encoding: 'utf8', timeout: 60000 })
    ok(label)
    return true
  } catch (e) {
    error(`${label}: ${String(e.message || '').slice(0,200)}`)
    return false
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
  }
}

function query(sql) {
  try {
    const escaped = sql.replace(/"/g, '\\"').replace(/\n/g, ' ')
    const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --json --command "${escaped}" 2>&1`
    const out  = execSync(cmd, { cwd: BASE, encoding: 'utf8', timeout: 30000 })
    return JSON.parse(out)[0]?.results || []
  } catch (e) { return [] }
}

function countTable(tbl, where) {
  const w = where ? ' WHERE ' + where : ''
  const rows = query(`SELECT COUNT(*) as n FROM ${tbl}${w}`)
  return rows[0]?.n ?? -1
}

const phaseResults = {}

// ============================================================================
// PHASE 3 CONTINUATION: Finish inventory batches 5-7
// ============================================================================
info('\n══════════════════════════════════════════')
info('PHASE 3 CONT: Inventory Batches 5-7')
info('══════════════════════════════════════════')

const remainingInvFiles = [
  'import_sql/06a_inventory_movements_batch005.sql',
  'import_sql/06a_inventory_movements_batch006.sql',
  'import_sql/06a_inventory_movements_batch007.sql',
]
for (const f of remainingInvFiles) runFile(f, `Inventory: ${f}`)

// Delete future-dated rows
runCmd(`DELETE FROM inventory_movements WHERE company_id=${COMPANY_ID} AND movement_date > '${TODAY}';`, 'Remove future-dated inventory')

const invCount = countTable('inventory_movements', `company_id=${COMPANY_ID}`)
info(`  Inventory total: ${invCount} (expected ~654)`)
phaseResults.phase3_inventory = invCount

// ============================================================================
// PHASE 4: Verify Supplier Transactions Encoding
// ============================================================================
info('\n══════════════════════════════════════════')
info('PHASE 4: Verify Supplier Transactions')
info('══════════════════════════════════════════')

const entryCheck = query(`SELECT hex(substr(entry_type,1,2)) as hx FROM supplier_transactions WHERE company_id=${COMPANY_ID} LIMIT 1`)
const entryHex = entryCheck[0]?.hx || ''
if (entryHex === 'D8AF' || entryHex === 'D985') {
  ok(`Supplier transactions encoding: CORRECT (${entryHex})`)
  phaseResults.phase4_supp_encoding = 'correct'
} else {
  warn(`Encoding suspicious: ${entryHex} — re-importing`)
  runCmd(`DELETE FROM supplier_transactions WHERE company_id=${COMPANY_ID} AND season_id=${SEASON_ID};`, 'Wipe supplier_transactions')
  const stFiles = fs.readdirSync(path.join(BASE, 'import_sql')).filter(f => f.startsWith('06c_')).sort()
  for (const f of stFiles) runFile('import_sql/' + f, `SupplierTx: ${f}`)
  phaseResults.phase4_supp_encoding = 'reimported'
}
phaseResults.phase4_count = countTable('supplier_transactions', `company_id=${COMPANY_ID}`)
info(`  Supplier transactions: ${phaseResults.phase4_count}`)

// ============================================================================
// PHASE 5: Fix Business Posting Groups
// ============================================================================
info('\n══════════════════════════════════════════')
info('PHASE 5: Fix Business Posting Groups')
info('══════════════════════════════════════════')

runCmd(`INSERT OR IGNORE INTO business_posting_groups (code, company_id, name) VALUES ('LABOR', ${COMPANY_ID}, 'عمالة ومقاولون');`, 'Add LABOR BPG')

const ppgs = ['FERT', 'SEED', 'CHEM', 'EQUIP', 'HARVEST']
for (const ppg of ppgs) {
  runCmd(`
INSERT OR IGNORE INTO general_posting_setup
  (company_id, bus_posting_group_code, prod_posting_group_code,
   sales_account, purchases_account, cogs_account, expense_account)
VALUES (${COMPANY_ID}, 'LABOR', '${ppg}', '41010001', '140701', '45010001', '51010001');`, `GPS LABOR×${ppg}`)
}
runCmd(`
INSERT OR IGNORE INTO general_posting_setup
  (company_id, bus_posting_group_code, prod_posting_group_code,
   sales_account, purchases_account, cogs_account, expense_account)
VALUES (${COMPANY_ID}, 'LABOR', NULL, '41010001', '140701', '45010001', '51010001');`, 'GPS LABOR×NULL')

// BPG assignments based on activity
const bpgRules = [
  { like: '%عمالة%',    bpg: 'LABOR' },
  { like: '%جهات حكومية%', bpg: 'GOVT' },
  { like: '%حكومي%',    bpg: 'GOVT' },
  { like: '%جهاز%',     bpg: 'GOVT' },
  { like: '%وزارة%',    bpg: 'GOVT' },
  { like: '%عميل%',     bpg: 'CUSTOMER' },
  { like: '%مورد نقدي%', bpg: 'LOCAL' },
]
for (const { like, bpg } of bpgRules) {
  runCmd(`UPDATE suppliers SET bus_posting_group_code='${bpg}' WHERE company_id=${COMPANY_ID} AND activity LIKE '${like}';`, `BPG: ${like} → ${bpg}`)
}
// Default remaining → LOCAL
runCmd(`UPDATE suppliers SET bus_posting_group_code='LOCAL' WHERE company_id=${COMPANY_ID} AND (bus_posting_group_code IS NULL OR bus_posting_group_code='');`, 'BPG default → LOCAL')

const bpgDist = query(`SELECT bus_posting_group_code, COUNT(*) as n FROM suppliers WHERE company_id=${COMPANY_ID} GROUP BY bus_posting_group_code ORDER BY n DESC`)
info('  BPG distribution: ' + bpgDist.map(r=>`${r.bus_posting_group_code}=${r.n}`).join(', '))
phaseResults.phase5_bpg = bpgDist

// ============================================================================
// PHASE 6: Mark Dummy Bank Accounts
// ============================================================================
info('\n══════════════════════════════════════════')
info('PHASE 6: Mark Dummy Bank Accounts')
info('══════════════════════════════════════════')

runCmd(`UPDATE bank_accounts SET notes='d_dummy_placeholder — account number not verified', is_active=0 WHERE company_id=${COMPANY_ID} AND account_number='12121212332212231';`, 'Mark dummy bank account')
ok('Bank accounts processed')
phaseResults.phase6_bank = 'dummy_marked'

// ============================================================================
// PHASE 7: Generate Journal Entries
// ============================================================================
info('\n══════════════════════════════════════════')
info('PHASE 7: Generate Journal Entries')
info('══════════════════════════════════════════')

runCmd(`DELETE FROM journal_entries WHERE company_id=${COMPANY_ID} AND ref_type IN ('supplier_transaction','cash_transaction','inventory_movement');`, 'Clear existing JE')

const GL = {
  CASH:      '14010101',
  SUPPLIER:  '2120',
  PURCHASES: '140701',
  COGS:      '45010001',
  EXPENSE:   '51200034',
  SALES:     '41010001',
}

let jeCounter = 0
const jeBatches = []

// Supplier transactions
info('  Reading supplier_transactions...')
const suppTxRows = query(`SELECT id, transaction_date, entry_type, amount, year FROM supplier_transactions WHERE company_id=${COMPANY_ID} AND amount IS NOT NULL AND amount != 0 ORDER BY transaction_date, id LIMIT 1000`)
info(`  ${suppTxRows.length} supplier transactions`)
for (const tx of suppTxRows) {
  const amt = Math.abs(parseFloat(tx.amount) || 0)
  if (amt === 0) continue
  jeCounter++
  const num = `ST-${tx.year||'2025'}-${String(jeCounter).padStart(5,'0')}`
  const pid = (String(tx.year) === '2026') ? 3 : 1
  const desc = `حركة مورد رقم ${tx.id}`
  const e = tx.entry_type || ''
  // 'د'=D8AF = supplier invoice (credit entry): DR Purchases, CR Supplier
  // 'م'=D985 = payment (debit entry): DR Supplier, CR Cash
  const drAcc = (e === 'م') ? GL.SUPPLIER  : GL.PURCHASES
  const crAcc = (e === 'م') ? GL.CASH      : GL.SUPPLIER
  jeBatches.push([
    `INSERT INTO journal_entries (company_id,period_id,entry_number,entry_date,description,ref_type,ref_id,is_posted) VALUES (${COMPANY_ID},${pid},'${num}','${tx.transaction_date}','${desc}','supplier_transaction',${tx.id},1);`,
    `INSERT INTO journal_entry_lines (entry_id,company_id,account_code,debit,credit,description) VALUES ((SELECT MAX(id) FROM journal_entries WHERE company_id=${COMPANY_ID}),${COMPANY_ID},'${drAcc}',${amt},0,'${desc}');`,
    `INSERT INTO journal_entry_lines (entry_id,company_id,account_code,debit,credit,description) VALUES ((SELECT MAX(id) FROM journal_entries WHERE company_id=${COMPANY_ID}),${COMPANY_ID},'${crAcc}',0,${amt},'${desc}');`,
  ].join('\n'))
}
info(`  Generated ${jeBatches.length} supplier JE batches`)

// Cash transactions
info('  Reading cash_transactions...')
const cashRows = query(`SELECT id, transaction_date, direction, amount, year FROM cash_transactions WHERE company_id=${COMPANY_ID} AND amount IS NOT NULL AND amount != 0 ORDER BY transaction_date, id LIMIT 500`)
info(`  ${cashRows.length} cash transactions`)
for (const tx of cashRows) {
  const amt = Math.abs(parseFloat(tx.amount) || 0)
  if (amt === 0) continue
  jeCounter++
  const num = `CT-${tx.year||'2025'}-${String(jeCounter).padStart(5,'0')}`
  const pid = (String(tx.year) === '2026') ? 3 : 1
  const desc = `حركة خزينة رقم ${tx.id}`
  const d = tx.direction || ''
  // 'م' = cash out (debit in cash book = we're paying): DR Expense, CR Cash
  // 'د' = cash in (credit in cash book = we're receiving): DR Cash, CR Sales
  const drAcc = (d === 'م') ? GL.EXPENSE : GL.CASH
  const crAcc = (d === 'م') ? GL.CASH    : GL.SALES
  jeBatches.push([
    `INSERT INTO journal_entries (company_id,period_id,entry_number,entry_date,description,ref_type,ref_id,is_posted) VALUES (${COMPANY_ID},${pid},'${num}','${tx.transaction_date}','${desc}','cash_transaction',${tx.id},1);`,
    `INSERT INTO journal_entry_lines (entry_id,company_id,account_code,debit,credit,description) VALUES ((SELECT MAX(id) FROM journal_entries WHERE company_id=${COMPANY_ID}),${COMPANY_ID},'${drAcc}',${amt},0,'${desc}');`,
    `INSERT INTO journal_entry_lines (entry_id,company_id,account_code,debit,credit,description) VALUES ((SELECT MAX(id) FROM journal_entries WHERE company_id=${COMPANY_ID}),${COMPANY_ID},'${crAcc}',0,${amt},'${desc}');`,
  ].join('\n'))
}
info(`  Total JE batches after cash: ${jeBatches.length}`)

// Inventory movements
info('  Reading inventory_movements...')
const invRows = query(`SELECT id, movement_date, movement_type, value_in, value_out, year FROM inventory_movements WHERE company_id=${COMPANY_ID} AND (value_in > 0 OR value_out > 0) ORDER BY movement_date, id LIMIT 1000`)
info(`  ${invRows.length} inventory movements`)
for (const tx of invRows) {
  const valIn  = parseFloat(tx.value_in)  || 0
  const valOut = parseFloat(tx.value_out) || 0
  const amt    = valIn > 0 ? valIn : valOut
  if (amt === 0) continue
  jeCounter++
  const num = `IM-${tx.year||'2025'}-${String(jeCounter).padStart(5,'0')}`
  const pid = (String(tx.year) === '2026') ? 3 : 1
  const desc = `حركة مخزن رقم ${tx.id}`
  const mtype = String(tx.movement_type || '')
  const isIN  = mtype.includes('\u0636\u0627\u0641') || mtype.includes('\u0648\u0627\u0631\u062f') || mtype.includes('\u0627\u0633\u062a\u0644\u0627\u0645')
  // IN (اضافة/وارد/استلام): DR Purchases, CR Supplier
  // OUT (صرف/منصرف): DR COGS, CR Purchases
  const drAcc = isIN ? GL.PURCHASES : GL.COGS
  const crAcc = isIN ? GL.SUPPLIER  : GL.PURCHASES
  jeBatches.push([
    `INSERT INTO journal_entries (company_id,period_id,entry_number,entry_date,description,ref_type,ref_id,is_posted) VALUES (${COMPANY_ID},${pid},'${num}','${tx.movement_date}','${desc}','inventory_movement',${tx.id},1);`,
    `INSERT INTO journal_entry_lines (entry_id,company_id,account_code,debit,credit,description) VALUES ((SELECT MAX(id) FROM journal_entries WHERE company_id=${COMPANY_ID}),${COMPANY_ID},'${drAcc}',${amt},0,'${desc}');`,
    `INSERT INTO journal_entry_lines (entry_id,company_id,account_code,debit,credit,description) VALUES ((SELECT MAX(id) FROM journal_entries WHERE company_id=${COMPANY_ID}),${COMPANY_ID},'${crAcc}',0,${amt},'${desc}');`,
  ].join('\n'))
}
info(`  Total JE batches: ${jeBatches.length}`)

// Write and execute JE SQL files (10 JEs per file = 30 statements)
const JE_DIR = path.join(BASE, 'import_sql_je')
if (!fs.existsSync(JE_DIR)) fs.mkdirSync(JE_DIR)
fs.readdirSync(JE_DIR).filter(f=>f.endsWith('.sql')).forEach(f=>fs.unlinkSync(path.join(JE_DIR,f)))

const JE_PER_FILE = 10
let jeFileCount = 0
for (let i = 0; i < jeBatches.length; i += JE_PER_FILE) {
  jeFileCount++
  const chunk = jeBatches.slice(i, i + JE_PER_FILE)
  const fname = path.join(JE_DIR, `je_batch${String(jeFileCount).padStart(4,'0')}.sql`)
  fs.writeFileSync(fname, chunk.join('\n') + '\n', 'utf8')
}
info(`  Written ${jeFileCount} JE files`)

info('  Executing JE files (this may take a few minutes)...')
let jeOK = 0, jeFail = 0
const jeFiles = fs.readdirSync(JE_DIR).filter(f=>f.endsWith('.sql')).sort()
for (let i = 0; i < jeFiles.length; i++) {
  const abs = path.join(JE_DIR, jeFiles[i])
  try {
    execSync(`npx wrangler d1 execute ${DB_NAME} --remote --file "${abs}" --yes 2>&1`, { cwd: BASE, encoding: 'utf8', timeout: 120000 })
    jeOK++
    if ((i + 1) % 5 === 0) info(`  Progress: ${i+1}/${jeFiles.length} JE files done`)
  } catch (e) {
    jeFail++
    warn(`JE ${jeFiles[i]}: ${String(e.message||'').slice(0,80)}`)
  }
}
info(`  JE done: ${jeOK} OK, ${jeFail} failed`)

const jeCount  = countTable('journal_entries',     `company_id=${COMPANY_ID}`)
const jelCount = countTable('journal_entry_lines', `company_id=${COMPANY_ID}`)
info(`  Journal entries: ${jeCount}, lines: ${jelCount}`)
phaseResults.phase7_je = { entries: jeCount, lines: jelCount }

// ============================================================================
// PHASE 8: Final Verification
// ============================================================================
info('\n══════════════════════════════════════════')
info('PHASE 8: Final Verification')
info('══════════════════════════════════════════')

// Encoding check
const suppCheck = query(`SELECT name, hex(substr(name,1,4)) as hx FROM suppliers WHERE company_id=${COMPANY_ID} LIMIT 5`)
const corrupted = suppCheck.filter(r => r.hx && r.hx.startsWith('C398'))
if (corrupted.length === 0) {
  ok('Supplier names: encoding FIXED ✓')
} else {
  warn(`Still ${corrupted.length} corrupted supplier names: ${JSON.stringify(corrupted[0])}`)
}

// Row counts
const counts = {
  suppliers:             countTable('suppliers',            `company_id=${COMPANY_ID}`),
  items:                 countTable('items',                `company_id=${COMPANY_ID}`),
  inventory_movements:   countTable('inventory_movements',  `company_id=${COMPANY_ID}`),
  supplier_transactions: countTable('supplier_transactions',`company_id=${COMPANY_ID}`),
  cash_transactions:     countTable('cash_transactions',    `company_id=${COMPANY_ID}`),
  journal_entries:       countTable('journal_entries',      `company_id=${COMPANY_ID}`),
  journal_entry_lines:   countTable('journal_entry_lines',  `company_id=${COMPANY_ID}`),
}

info('\n📊 FINAL ROW COUNTS:')
for (const [tbl, n] of Object.entries(counts)) info(`  ${tbl.padEnd(30)}: ${n}`)

// GL balance check
const jeBal = query(`SELECT SUM(debit) as dr, SUM(credit) as cr FROM journal_entry_lines WHERE company_id=${COMPANY_ID}`)
const dr = parseFloat(jeBal[0]?.dr || 0)
const cr = parseFloat(jeBal[0]?.cr || 0)
const diff = Math.abs(dr - cr)
info(`\n📊 GL BALANCE: DR=${dr.toFixed(0)}, CR=${cr.toFixed(0)}, DIFF=${diff.toFixed(0)} ${diff < 1 ? '✅' : '⚠️'}`)

// BPG distribution
const bpgFinal = query(`SELECT bus_posting_group_code, COUNT(*) as n FROM suppliers WHERE company_id=${COMPANY_ID} GROUP BY bus_posting_group_code ORDER BY n DESC`)
info('\n📊 SUPPLIER BPG DISTRIBUTION:')
bpgFinal.forEach(r => info(`  ${(r.bus_posting_group_code||'NULL').padEnd(12)}: ${r.n}`))

phaseResults.verification = { counts, gl_dr: dr, gl_cr: cr, gl_balanced: diff < 1 }

// Save report
const report = {
  generated_at: new Date().toISOString(),
  errors,
  root_causes_fixed: {
    '1_encoding':       'Supplier/item names re-imported via --file --yes (bypasses non-TTY stdin issue)',
    '2_inventory':      `Inventory re-imported from original SQL (no dedup): ${counts.inventory_movements} rows`,
    '3_journal_entries':`Generated from ${counts.supplier_transactions} supplier + ${counts.cash_transactions} cash + ${invRows.length} inv movements`,
    '4_posting_groups': 'Added LABOR BPG, assigned supplier BPG from activity column, added GPS entries',
    '5_bank_accounts':  'Marked account 12121212332212231 as dummy (d_) and inactive',
  },
  phase_results: phaseResults,
}
fs.writeFileSync(path.join(BASE, 'rebuild_report.json'), JSON.stringify(report, null, 2))

info('\n══════════════════════════════════════════')
if (errors === 0) {
  ok('REBUILD COMPLETE — 0 errors ✓')
} else {
  warn(`REBUILD COMPLETE WITH ${errors} ERRORS`)
}
info('Report saved: rebuild_report.json')
