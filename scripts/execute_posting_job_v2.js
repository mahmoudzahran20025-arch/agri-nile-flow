#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')

const DB_NAME = 'agri-nile-flow-data-lake'
const COMPANY_ID = 1
const APPLY = process.argv.includes('--apply')
const NO_CUTOFF = true
const POSTING_CUTOFF_DATE = '2026-12-31'
const ROOT = process.cwd()
const TMP_DIR = path.join(ROOT, 'sql', 'generated_phase4')

const GENERIC_AP_ACCOUNT = '212000010'

function runD1Json(sql) {
  const compact = sql.replace(/\s+/g, ' ').trim()
  const escaped = compact.replace(/"/g, '\\"')
  const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --yes --json --command "${escaped}"`
  const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  const start = out.indexOf('[')
  const end = out.lastIndexOf(']')
  if (start < 0 || end < 0 || end < start) throw new Error('Failed to parse D1 output')
  return JSON.parse(out.slice(start, end + 1))
}

function query(sql) {
  return runD1Json(sql)[0]?.results ?? []
}

function scalar(sql, key) {
  const row = query(sql)[0] || {}
  return Number(row[key] || 0)
}

function esc(str) {
  if (str == null) return ''
  return String(str).replace(/'/g, "''")
}

function money(value) {
  const num = Number(value || 0)
  return Number.isFinite(num) ? num : 0
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function writeAndExecStatements(statements) {
  if (!statements.length) return
  fs.mkdirSync(TMP_DIR, { recursive: true })
  const groups = chunk(statements, 100)
  for (let i = 0; i < groups.length; i += 1) {
    const filePath = path.join(TMP_DIR, `_posting_batch_${i + 1}.sql`)
    fs.writeFileSync(filePath, groups[i].join('\n') + '\n', 'utf8')
    try {
      execSync(`npx wrangler d1 execute ${DB_NAME} --remote --yes --file "${filePath}"`, { cwd: ROOT, stdio: 'inherit' })
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }
  }
}

function buildLookupMap(rows, keyField, valueField) {
  const map = new Map()
  for (const row of rows) {
    if (row[keyField] == null || row[valueField] == null) continue
    map.set(String(row[keyField]), String(row[valueField]))
  }
  return map
}

function warehouseInventoryAccount(warehouse, controlAccounts) {
  const fallback = controlAccounts.get('inventory') || '14070106'
  const key = String(warehouse || '').trim()
  const mapping = new Map([
    ['اسمدة', '14070101'],
    ['مبيدات', '14070102'],
    ['تقاوي وبذور', '14070103'],
    ['شبكات ري', '14070104'],
    ['قطع غيار', '14070105'],
  ])
  return mapping.get(key) || fallback
}

function ipgInventoryAccount(ipg, inventoryAccountsByIpg) {
  if (!ipg) return null
  return inventoryAccountsByIpg.get(String(ipg).trim()) || null
}

function supplierServiceKey(supplierCode, serviceTypeCode) {
  return `${String(supplierCode)}:${serviceTypeCode == null || serviceTypeCode === '' ? '*' : String(serviceTypeCode)}`
}

function resolveSupplierApAccount(row, controlAccounts, supplierServiceExactMap, supplierServicePrimaryMap) {
  if (row.supplier_code != null) {
    const key = supplierServiceKey(row.supplier_code, row.service_type_code)
    const exact = supplierServiceExactMap.get(key)
    if (exact) return exact
    const primary = supplierServicePrimaryMap.get(String(row.supplier_code))
    if (primary) return primary
  }
  if (row.supplier_gl && String(row.supplier_gl) !== GENERIC_AP_ACCOUNT) return String(row.supplier_gl)
  return controlAccounts.get('accounts_payable') || GENERIC_AP_ACCOUNT
}

function resolveSupplierExpenseAccount(row, controlAccounts, expenseTypeAccounts) {
  const category = row.expense_category == null ? '' : String(row.expense_category).trim()
  if (category && expenseTypeAccounts.has(category)) return expenseTypeAccounts.get(category)
  if (category === '31001') return controlAccounts.get('purchases') || controlAccounts.get('cogs') || '45010001'
  if (category === 'عمالة') return controlAccounts.get('wages') || '51010001'
  if (category === 'ميكنة') return controlAccounts.get('expense_default') || controlAccounts.get('purchases') || '51200034'
  return controlAccounts.get('expense_default') || controlAccounts.get('purchases') || '51200034'
}

function resolveCashPlan(row, controlAccounts, expenseTypeAccounts, supplierServiceExactMap, supplierServicePrimaryMap) {
  const cashAccount = controlAccounts.get('cash') || '14010101'
  const revenueAccount = controlAccounts.get('revenue_default') || '41010001'
  const expenseDefault = controlAccounts.get('expense_default') || '51200034'
  const amount = money(row.amount || row.debit || row.credit)
  const direction = String(row.entry_type || row.direction || '').trim()

  if (direction === 'د') {
    return { amount, debitAccount: cashAccount, creditAccount: revenueAccount, eventLabel: 'قبض خزينة' }
  }

  if (row.supplier_code != null) {
    return { amount, debitAccount: resolveSupplierApAccount(row, controlAccounts, supplierServiceExactMap, supplierServicePrimaryMap), creditAccount: cashAccount, eventLabel: 'سداد عبر الخزينة' }
  }

  const expenseCode = row.expense_code == null ? '' : String(row.expense_code).trim()
  return { amount, debitAccount: expenseTypeAccounts.get(expenseCode) || expenseDefault, creditAccount: cashAccount, eventLabel: 'مصروف خزينة' }
}

const openPeriods = query(`SELECT id, name, start_date, end_date FROM financial_periods WHERE company_id=${COMPANY_ID} AND is_closed=0 ORDER BY id`)
if (openPeriods.length === 0) { console.error('No open periods found'); process.exit(1); }

function findPeriodId(date) {
  const d = String(date).slice(0, 10);
  const p = openPeriods.find(p => d >= p.start_date && d <= p.end_date);
  return p ? p.id : openPeriods[0].id;
}

const controlAccounts = buildLookupMap(query(`SELECT mapping_key, account_code FROM posting_rules WHERE company_id=${COMPANY_ID} AND rule_type='control' AND is_active=1`), 'mapping_key', 'account_code')
const expenseTypeAccounts = buildLookupMap(query(`SELECT et.code, et.gl_account_code FROM expense_types et JOIN chart_of_accounts coa ON coa.company_id = et.company_id AND coa.code = et.gl_account_code WHERE et.company_id=${COMPANY_ID} AND et.gl_account_code IS NOT NULL`), 'code', 'gl_account_code')
const supplierServiceRows = query(`SELECT supplier_code, service_type_code, default_ap_account_code, is_primary FROM supplier_service_map WHERE company_id=${COMPANY_ID} AND is_active=1`)
const supplierServiceExactMap = new Map()
const supplierServicePrimaryMap = new Map()
for (const row of supplierServiceRows) {
  if (row.supplier_code == null || row.default_ap_account_code == null) continue
  supplierServiceExactMap.set(supplierServiceKey(row.supplier_code, row.service_type_code), String(row.default_ap_account_code))
  if (Number(row.is_primary || 0) === 1 && !supplierServicePrimaryMap.has(String(row.supplier_code))) supplierServicePrimaryMap.set(String(row.supplier_code), String(row.default_ap_account_code))
}

const inventorySetupRows = query(`SELECT inv_posting_group_code, inventory_account FROM inventory_posting_setup WHERE company_id=${COMPANY_ID} AND is_active=1 AND inventory_account IS NOT NULL`)
const inventoryAccountsByIpg = new Map()
for (const row of inventorySetupRows) {
  if (!row.inv_posting_group_code || !row.inventory_account) continue
  inventoryAccountsByIpg.set(String(row.inv_posting_group_code), String(row.inventory_account))
}

const maxJeId = scalar(`SELECT COALESCE(MAX(id), 0) AS v FROM journal_entries WHERE company_id=${COMPANY_ID}`, 'v')
let nextJeId = maxJeId + 1

const supplierRows = query(`SELECT st.*, s.name AS supplier_name, s.gl_account_code AS supplier_gl, be.id AS event_id, be.event_type AS event_type FROM supplier_transactions st LEFT JOIN suppliers s ON s.company_id = st.company_id AND s.code = st.supplier_code LEFT JOIN business_events be ON be.company_id = st.company_id AND be.source_module = 'suppliers' AND be.source_id = st.id WHERE st.company_id=${COMPANY_ID} AND st.status='posted' AND st.journal_entry_id IS NULL`)
const cashRows = query(`SELECT ct.*, be.id AS event_id, be.event_type AS event_type FROM cash_transactions ct LEFT JOIN business_events be ON be.company_id = ct.company_id AND be.source_module = 'cash' AND be.source_id = ct.id WHERE ct.company_id=${COMPANY_ID} AND ct.status='posted' AND ct.journal_entry_id IS NULL`)
const inventoryRows = query(`SELECT im.*, w.inv_posting_group_code, be.id AS event_id, be.event_type AS event_type FROM inventory_movements im LEFT JOIN warehouses w ON w.company_id = im.company_id AND w.id = im.warehouse_id LEFT JOIN business_events be ON be.company_id = im.company_id AND be.source_module = 'inventory' AND be.source_id = im.id WHERE im.company_id=${COMPANY_ID} AND im.status='posted' AND im.journal_entry_id IS NULL AND im.movement_type IN ('GRN','ISSUE')`)

const sql = []
let totalDebit = 0, totalCredit = 0, plannedEntries = 0

function emitEntry({ refType, refId, entryDate, description, eventId, eventType, lineA, lineB, sourceUpdateSql }) {
  if (!eventId) return
  const jeId = nextJeId++; plannedEntries++;
  const pid = findPeriodId(entryDate);
  totalDebit += money(lineA.debit) + money(lineB.debit)
  totalCredit += money(lineA.credit) + money(lineB.credit)
  const trace = esc(JSON.stringify({ rebuild: 'v2', eventId, eventType }))
  sql.push(`INSERT OR IGNORE INTO journal_entries (id, company_id, period_id, entry_date, description, ref_type, ref_id, is_posted, created_at, local_id, posting_rule_trace) VALUES (${jeId}, ${COMPANY_ID}, ${pid}, '${entryDate}', '${esc(description)}', '${refType}', ${refId}, 1, datetime('now'), 'v2_${refType}_${refId}', '${trace}');`)
  sql.push(`INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, season_id, field_id, source_ledger, source_record_id) VALUES (${jeId}, ${COMPANY_ID}, '${lineA.account}', ${money(lineA.debit)}, ${money(lineA.credit)}, '${esc(description)}', ${lineA.centerCode ?? 'NULL'}, ${lineA.seasonId ?? 'NULL'}, ${lineA.fieldId ?? 'NULL'}, '${lineA.sourceLedger}', ${refId});`)
  sql.push(`INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, season_id, field_id, source_ledger, source_record_id) VALUES (${jeId}, ${COMPANY_ID}, '${lineB.account}', ${money(lineB.debit)}, ${money(lineB.credit)}, '${esc(description)}', ${lineB.centerCode ?? 'NULL'}, ${lineB.seasonId ?? 'NULL'}, ${lineB.fieldId ?? 'NULL'}, '${lineB.sourceLedger}', ${refId});`)
  sql.push(sourceUpdateSql(jeId))
  sql.push(`UPDATE business_events SET journal_entry_id=${jeId}, status='posted', posted_at=datetime('now') WHERE company_id=${COMPANY_ID} AND id=${eventId};`)
}

for (const row of supplierRows) {
  const isPayment = String(row.entry_type || '').trim() === 'م'
  const amount = isPayment ? money(row.debit || row.amount) : money(row.credit || row.amount)
  if (amount <= 0) continue
  const apAccount = resolveSupplierApAccount(row, controlAccounts, supplierServiceExactMap, supplierServicePrimaryMap)
  const expenseAccount = resolveSupplierExpenseAccount(row, controlAccounts, expenseTypeAccounts)
  emitEntry({
    refType: 'supplier_transaction', refId: row.id, entryDate: row.transaction_date,
    description: `${isPayment ? 'سداد' : 'إثبات'} مورد | ${row.supplier_name || row.supplier_code}`,
    eventId: row.event_id, eventType: row.event_type,
    lineA: isPayment ? { account: apAccount, debit: amount, credit: 0, centerCode: row.center_code, seasonId: row.season_id, sourceLedger: 'supplier' } : { account: expenseAccount, debit: amount, credit: 0, centerCode: row.center_code, seasonId: row.season_id, sourceLedger: 'supplier' },
    lineB: isPayment ? { account: controlAccounts.get('cash') || '14010101', debit: 0, credit: amount, centerCode: row.center_code, seasonId: row.season_id, sourceLedger: 'supplier' } : { account: apAccount, debit: 0, credit: amount, centerCode: row.center_code, seasonId: row.season_id, sourceLedger: 'supplier' },
    sourceUpdateSql: (jeId) => `UPDATE supplier_transactions SET journal_entry_id=${jeId} WHERE id=${row.id};`
  })
}

for (const row of cashRows) {
  const plan = resolveCashPlan(row, controlAccounts, expenseTypeAccounts, supplierServiceExactMap, supplierServicePrimaryMap)
  if (plan.amount <= 0) continue
  emitEntry({
    refType: 'cash_transaction', refId: row.id, entryDate: row.transaction_date,
    description: `${plan.eventLabel} | ${row.narration || ''}`,
    eventId: row.event_id, eventType: row.event_type,
    lineA: { account: plan.debitAccount, debit: plan.amount, credit: 0, centerCode: row.center_code, seasonId: row.season_id, fieldId: row.field_id, sourceLedger: 'cash' },
    lineB: { account: plan.creditAccount, debit: 0, credit: plan.amount, centerCode: row.center_code, seasonId: row.season_id, fieldId: row.field_id, sourceLedger: 'cash' },
    sourceUpdateSql: (jeId) => `UPDATE cash_transactions SET journal_entry_id=${jeId} WHERE id=${row.id};`
  })
}

for (const row of inventoryRows) {
  const isGrn = row.movement_type === 'GRN';
  const isIssue = row.movement_type === 'ISSUE';
  if (!isGrn && !isIssue) continue;

  const inventoryAccount = ipgInventoryAccount(row.inv_posting_group_code, inventoryAccountsByIpg) || warehouseInventoryAccount(row.warehouse, controlAccounts)
  const amount = isGrn ? money(row.value_in || (money(row.quantity) * money(row.unit_price))) : money(row.value_out || (money(row.quantity) * money(row.unit_price)))
  if (amount <= 0) continue

  const expenseAccount = resolveSupplierExpenseAccount({ expense_category: '31001' }, controlAccounts, expenseTypeAccounts) // Default to COGS for inventory issue

  emitEntry({
    refType: 'inventory_movement', refId: row.id, entryDate: row.movement_date,
    description: `حركة مخزنية | ${row.movement_type} | ${row.warehouse}`,
    eventId: row.event_id, eventType: row.event_type,
    lineA: isGrn ? { account: inventoryAccount, debit: amount, credit: 0, centerCode: row.center_code, seasonId: row.season_id, fieldId: row.field_id, sourceLedger: 'inventory' } : { account: expenseAccount, debit: amount, credit: 0, centerCode: row.center_code, seasonId: row.season_id, fieldId: row.field_id, sourceLedger: 'inventory' },
    lineB: isGrn ? { account: resolveSupplierApAccount(row, controlAccounts, supplierServiceExactMap, supplierServicePrimaryMap), debit: 0, credit: amount, centerCode: row.center_code, seasonId: row.season_id, fieldId: row.field_id, sourceLedger: 'inventory' } : { account: inventoryAccount, debit: 0, credit: amount, centerCode: row.center_code, seasonId: row.season_id, fieldId: row.field_id, sourceLedger: 'inventory' },
    sourceUpdateSql: (jeId) => `UPDATE inventory_movements SET journal_entry_id=${jeId}, gl_posting_status='posted', gl_posted_at=datetime('now') WHERE id=${row.id};`
  })
}

console.log(`Planned entries: ${plannedEntries}, totals: debit=${totalDebit.toFixed(2)}, credit=${totalCredit.toFixed(2)}`)
if (APPLY) { writeAndExecStatements(sql); console.log('Posting complete.'); } else { console.log('Dry run complete. Use --apply to execute.'); }
