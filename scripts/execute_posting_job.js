#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')

const DB_NAME = 'agri-nile-flow-data-lake'
const COMPANY_ID = 1
const APPLY = process.argv.includes('--apply')
const NO_CUTOFF = process.argv.includes('--no-cutoff')
const POSTING_CUTOFF_DATE = process.env.POSTING_CUTOFF_DATE || new Date().toISOString().slice(0, 10)
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
    const exact = supplierServiceExactMap.get(supplierServiceKey(row.supplier_code, row.service_type_code))
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
    return {
      amount,
      debitAccount: cashAccount,
      creditAccount: revenueAccount,
      eventLabel: 'قبض خزينة',
    }
  }

  if (row.supplier_code != null) {
    return {
      amount,
      debitAccount: resolveSupplierApAccount(row, controlAccounts, supplierServiceExactMap, supplierServicePrimaryMap),
      creditAccount: cashAccount,
      eventLabel: 'سداد عبر الخزينة',
    }
  }

  const expenseCode = row.expense_code == null ? '' : String(row.expense_code).trim()
  return {
    amount,
    debitAccount: expenseTypeAccounts.get(expenseCode) || expenseDefault,
    creditAccount: cashAccount,
    eventLabel: 'مصروف خزينة',
  }
}

console.log('\n╔════════════════════════════════════════════════════════════════╗')
console.log(`║   PHASE 4 Posting Job — ${APPLY ? 'APPLY MODE' : 'DRY RUN MODE'}                      ║`)
console.log('╚════════════════════════════════════════════════════════════════╝\n')

const openPeriods = query(`
  SELECT id, name, start_date, end_date
  FROM financial_periods
  WHERE company_id=${COMPANY_ID} AND is_closed=0
  ORDER BY id
`)

if (openPeriods.length !== 1) {
  console.error(`❌ Period lock failed: expected exactly 1 open period, found ${openPeriods.length}`)
  process.exit(1)
}

const controlAccounts = buildLookupMap(
  query(`SELECT mapping_key, account_code FROM posting_rules WHERE company_id=${COMPANY_ID} AND rule_type='control' AND is_active=1`),
  'mapping_key',
  'account_code',
)
const expenseTypeAccounts = buildLookupMap(
  query(`
    SELECT et.code, et.gl_account_code
    FROM expense_types et
    JOIN chart_of_accounts coa
      ON coa.company_id = et.company_id
     AND coa.code = et.gl_account_code
    WHERE et.company_id=${COMPANY_ID}
      AND et.gl_account_code IS NOT NULL
  `),
  'code',
  'gl_account_code',
)
const supplierServiceRows = query(`
  SELECT supplier_code, service_type_code, default_ap_account_code, is_primary
  FROM supplier_service_map
  WHERE company_id=${COMPANY_ID}
    AND is_active=1
`)
const supplierServiceExactMap = new Map()
const supplierServicePrimaryMap = new Map()
for (const row of supplierServiceRows) {
  if (row.supplier_code == null || row.default_ap_account_code == null) continue
  supplierServiceExactMap.set(supplierServiceKey(row.supplier_code, row.service_type_code), String(row.default_ap_account_code))
  if (Number(row.is_primary || 0) === 1 && !supplierServicePrimaryMap.has(String(row.supplier_code))) {
    supplierServicePrimaryMap.set(String(row.supplier_code), String(row.default_ap_account_code))
  }
}

const inventorySetupRows = query(`
  SELECT inv_posting_group_code, inventory_account
  FROM inventory_posting_setup
  WHERE company_id=${COMPANY_ID}
    AND is_active=1
    AND inventory_account IS NOT NULL
`)
const inventoryAccountsByIpg = new Map()
for (const row of inventorySetupRows) {
  if (!row.inv_posting_group_code || !row.inventory_account) continue
  if (!inventoryAccountsByIpg.has(String(row.inv_posting_group_code))) {
    inventoryAccountsByIpg.set(String(row.inv_posting_group_code), String(row.inventory_account))
  }
}

function loadPrelinkedRepairs(tableName, refType, sourceModule, dateColumn, extraPredicate = '1=1') {
  return query(`
    SELECT src.id AS source_id,
           je.id AS je_id,
           be.id AS event_id
    FROM ${tableName} src
    JOIN journal_entries je
      ON je.company_id = src.company_id
     AND je.ref_type = '${refType}'
     AND je.ref_id = src.id
    LEFT JOIN business_events be
      ON be.company_id = src.company_id
     AND be.source_module = '${sourceModule}'
     AND be.source_id = src.id
    WHERE src.company_id=${COMPANY_ID}
      AND src.status='posted'
      AND src.journal_entry_id IS NULL
      AND ${extraPredicate}
    ORDER BY src.${dateColumn}, src.id
  `)
}

function buildRepairStatements(repairs, tableName) {
  const statements = []
  for (const repair of repairs) {
    statements.push(`UPDATE ${tableName} SET journal_entry_id=${repair.je_id} WHERE company_id=${COMPANY_ID} AND id=${repair.source_id} AND journal_entry_id IS NULL;`)
    if (repair.event_id != null) {
      statements.push(`UPDATE business_events SET journal_entry_id=${repair.je_id}, status='posted', error_message=NULL, posted_at=COALESCE(posted_at, datetime('now')) WHERE company_id=${COMPANY_ID} AND id=${repair.event_id} AND journal_entry_id IS NULL;`)
    }
  }
  return statements
}

const period = openPeriods[0]
console.log(`Open period: ${period.id} | ${period.name} | ${period.start_date} -> ${period.end_date}`)
console.log(`Control accounts loaded: ${controlAccounts.size}, expense types loaded: ${expenseTypeAccounts.size}`)

const supplierRepairs = loadPrelinkedRepairs('supplier_transactions', 'supplier_transaction', 'suppliers', 'transaction_date')
const cashRepairs = loadPrelinkedRepairs('cash_transactions', 'cash_transaction', 'cash', 'transaction_date')
const inventoryRepairs = loadPrelinkedRepairs('inventory_movements', 'inventory_movement', 'inventory', 'movement_date', `movement_type IN ('GRN','ISSUE')`)
const repairSql = [
  ...buildRepairStatements(supplierRepairs, 'supplier_transactions'),
  ...buildRepairStatements(cashRepairs, 'cash_transactions'),
  ...buildRepairStatements(inventoryRepairs, 'inventory_movements'),
]

const maxJeId = scalar(`SELECT COALESCE(MAX(id), 0) AS v FROM journal_entries WHERE company_id=${COMPANY_ID}`, 'v')
let nextJeId = maxJeId + 1

const supplierRows = query(`
    SELECT st.id, st.transaction_date, st.entry_type, st.amount, st.debit, st.credit,
      st.center_code, st.season_id, st.document_type, st.document_number,
         st.notes, st.expense_category, st.supplier_code, st.service_type_code,
         s.name AS supplier_name, s.gl_account_code AS supplier_gl,
         be.id AS event_id, be.event_type AS event_type
  FROM supplier_transactions st
  LEFT JOIN suppliers s
    ON s.company_id = st.company_id
   AND s.code = st.supplier_code
  LEFT JOIN business_events be
    ON be.company_id = st.company_id
   AND be.source_module = 'suppliers'
   AND be.source_id = st.id
  WHERE st.company_id=${COMPANY_ID}
    AND st.status='posted'
    AND st.journal_entry_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.company_id=st.company_id
        AND je.ref_type='supplier_transaction'
        AND je.ref_id=st.id
    )
  ORDER BY st.transaction_date, st.id
`)

const cashRows = query(`
  SELECT ct.id, ct.transaction_date, ct.amount, ct.debit, ct.credit, ct.direction, ct.entry_type,
         ct.center_code, ct.season_id, ct.field_id, ct.document_type, ct.document_number,
         ct.notes, ct.narration, ct.expense_code, ct.supplier_code,
         be.id AS event_id, be.event_type AS event_type
  FROM cash_transactions ct
  LEFT JOIN business_events be
    ON be.company_id = ct.company_id
   AND be.source_module = 'cash'
   AND be.source_id = ct.id
  WHERE ct.company_id=${COMPANY_ID}
    AND ct.status='posted'
    AND ct.journal_entry_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.company_id=ct.company_id
        AND je.ref_type='cash_transaction'
        AND je.ref_id=ct.id
    )
  ORDER BY ct.transaction_date, ct.id
`)

const inventoryRows = query(`
  SELECT im.id, im.movement_date, im.movement_type, im.value_in, im.value_out,
         im.quantity, im.unit_price, im.center_code, im.season_id, im.field_id,
         im.item_code, im.warehouse, im.warehouse_id,
         w.inv_posting_group_code,
         be.id AS event_id, be.event_type AS event_type
  FROM inventory_movements im
  LEFT JOIN warehouses w
    ON w.company_id = im.company_id
   AND w.id = im.warehouse_id
   AND w.is_active = 1
  LEFT JOIN business_events be
    ON be.company_id = im.company_id
   AND be.source_module = 'inventory'
   AND be.source_id = im.id
  WHERE im.company_id=${COMPANY_ID}
    AND im.status='posted'
    AND im.journal_entry_id IS NULL
    AND im.movement_type IN ('GRN','ISSUE')
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.company_id=im.company_id
        AND je.ref_type='inventory_movement'
        AND je.ref_id=im.id
    )
  ORDER BY im.movement_date, im.id
`)

const sql = []
let totalDebit = 0
let totalCredit = 0
let skippedZero = 0
let skippedNoEvent = 0
let skippedFuture = 0
let plannedEntries = 0

function markEventExempt(eventId, reason) {
  if (!eventId) return
  sql.push(`UPDATE business_events SET error_message='${reason}' WHERE company_id=${COMPANY_ID} AND id=${eventId} AND COALESCE(journal_entry_id, 0) = 0;`)
}

function emitEntry({ refType, refId, entryDate, description, eventId, eventType, lineA, lineB, sourceUpdateSql }) {
  if (!eventId) {
    skippedNoEvent += 1
    return
  }

  const jeId = nextJeId
  nextJeId += 1
  plannedEntries += 1
  totalDebit += money(lineA.debit) + money(lineB.debit)
  totalCredit += money(lineA.credit) + money(lineB.credit)

  const trace = esc(JSON.stringify({
    rebuild_mode: 'phase4_execute_posting_job',
    source_event_id: eventId,
    event_type: eventType,
    source_ref_type: refType,
    source_ref_id: refId,
  }))

  sql.push(`INSERT OR IGNORE INTO journal_entries (id, company_id, period_id, entry_date, description, ref_type, ref_id, is_posted, created_at, local_id, posting_rule_trace) VALUES (${jeId}, ${COMPANY_ID}, ${period.id}, '${entryDate}', '${esc(description)}', '${refType}', ${refId}, 1, datetime('now'), 'phase4_${refType}_${refId}', '${trace}');`)
  sql.push(`INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, season_id, field_id, source_ledger, source_record_id) VALUES (${jeId}, ${COMPANY_ID}, '${lineA.account}', ${money(lineA.debit)}, ${money(lineA.credit)}, '${esc(description)}', ${lineA.centerCode ?? 'NULL'}, ${lineA.seasonId ?? 'NULL'}, ${lineA.fieldId ?? 'NULL'}, '${lineA.sourceLedger}', ${refId});`)
  sql.push(`INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, season_id, field_id, source_ledger, source_record_id) VALUES (${jeId}, ${COMPANY_ID}, '${lineB.account}', ${money(lineB.debit)}, ${money(lineB.credit)}, '${esc(description)}', ${lineB.centerCode ?? 'NULL'}, ${lineB.seasonId ?? 'NULL'}, ${lineB.fieldId ?? 'NULL'}, '${lineB.sourceLedger}', ${refId});`)
  sql.push(sourceUpdateSql(jeId))
  sql.push(`UPDATE business_events SET journal_entry_id=${jeId}, status='posted', error_message=NULL, posted_at=datetime('now') WHERE company_id=${COMPANY_ID} AND id=${eventId};`)
  sql.push(`INSERT INTO posting_rule_resolutions (company_id, rule_type, result, error_message, journal_entry_id, source_event_id) VALUES (${COMPANY_ID}, '${esc(eventType || refType)}', 'resolved', 'Phase4 rebuild without engine trace', ${jeId}, ${eventId});`)
}

function isFutureDated(entryDate) {
  if (NO_CUTOFF) return false
  return String(entryDate) > POSTING_CUTOFF_DATE
}

for (const row of supplierRows) {
  if (isFutureDated(row.transaction_date)) {
    skippedFuture += 1
    markEventExempt(row.event_id, `future_dated_source:${row.transaction_date}>${POSTING_CUTOFF_DATE}`)
    continue
  }

  const isPayment = String(row.entry_type || '').trim() === 'م'
  const amount = isPayment ? money(row.debit || row.amount || row.credit) : money(row.credit || row.amount || row.debit)
  if (amount <= 0) {
    skippedZero += 1
    markEventExempt(row.event_id, 'exempt_zero_value')
    continue
  }

  const apAccount = resolveSupplierApAccount(row, controlAccounts, supplierServiceExactMap, supplierServicePrimaryMap)
  const expenseAccount = resolveSupplierExpenseAccount(row, controlAccounts, expenseTypeAccounts)
  const description = [
    isPayment ? 'سداد مستحقات مورد' : 'إثبات معاملة مورد',
    row.supplier_name || `مورد ${row.supplier_code || row.id}`,
    row.expense_category || null,
    row.document_number ? `مستند ${row.document_number}` : (row.document_type || null),
  ].filter(Boolean).join(' | ')

  emitEntry({
    refType: 'supplier_transaction',
    refId: row.id,
    entryDate: row.transaction_date,
    description,
    eventId: row.event_id,
    eventType: row.event_type,
    lineA: isPayment
      ? { account: apAccount, debit: amount, credit: 0, centerCode: row.center_code, seasonId: row.season_id, fieldId: null, sourceLedger: 'supplier' }
      : { account: expenseAccount, debit: amount, credit: 0, centerCode: row.center_code, seasonId: row.season_id, fieldId: null, sourceLedger: 'supplier' },
    lineB: isPayment
      ? { account: controlAccounts.get('cash') || '14010101', debit: 0, credit: amount, centerCode: row.center_code, seasonId: row.season_id, fieldId: null, sourceLedger: 'supplier' }
      : { account: apAccount, debit: 0, credit: amount, centerCode: row.center_code, seasonId: row.season_id, fieldId: null, sourceLedger: 'supplier' },
    sourceUpdateSql: (jeId) => `UPDATE supplier_transactions SET journal_entry_id=${jeId} WHERE company_id=${COMPANY_ID} AND id=${row.id} AND journal_entry_id IS NULL;`,
  })
}

for (const row of cashRows) {
  if (isFutureDated(row.transaction_date)) {
    skippedFuture += 1
    markEventExempt(row.event_id, `future_dated_source:${row.transaction_date}>${POSTING_CUTOFF_DATE}`)
    continue
  }

  const plan = resolveCashPlan(row, controlAccounts, expenseTypeAccounts, supplierServiceExactMap, supplierServicePrimaryMap)
  if (plan.amount <= 0) {
    skippedZero += 1
    markEventExempt(row.event_id, 'exempt_zero_value')
    continue
  }

  const description = [plan.eventLabel, row.narration || row.notes || null, row.document_number ? `مستند ${row.document_number}` : (row.document_type || null)].filter(Boolean).join(' | ')
  emitEntry({
    refType: 'cash_transaction',
    refId: row.id,
    entryDate: row.transaction_date,
    description,
    eventId: row.event_id,
    eventType: row.event_type,
    lineA: { account: plan.debitAccount, debit: plan.amount, credit: 0, centerCode: row.center_code, seasonId: row.season_id, fieldId: row.field_id, sourceLedger: 'cash' },
    lineB: { account: plan.creditAccount, debit: 0, credit: plan.amount, centerCode: row.center_code, seasonId: row.season_id, fieldId: row.field_id, sourceLedger: 'cash' },
    sourceUpdateSql: (jeId) => `UPDATE cash_transactions SET journal_entry_id=${jeId} WHERE company_id=${COMPANY_ID} AND id=${row.id} AND journal_entry_id IS NULL;`,
  })
}

for (const row of inventoryRows) {
  if (isFutureDated(row.movement_date)) {
    skippedFuture += 1
    sql.push(`UPDATE inventory_movements SET gl_posting_status='future_blocked', gl_posted_at=datetime('now') WHERE company_id=${COMPANY_ID} AND id=${row.id} AND journal_entry_id IS NULL;`)
    markEventExempt(row.event_id, `future_dated_source:${row.movement_date}>${POSTING_CUTOFF_DATE}`)
    continue
  }

  const inventoryAccount =
    ipgInventoryAccount(row.inv_posting_group_code, inventoryAccountsByIpg)
    || warehouseInventoryAccount(row.warehouse, controlAccounts)
  const isGrn = String(row.movement_type) === 'GRN'
  const amount = isGrn ? money(row.value_in || (money(row.quantity) * money(row.unit_price))) : money(row.value_out || (money(row.quantity) * money(row.unit_price)))

  if (amount <= 0) {
    skippedZero += 1
    sql.push(`UPDATE inventory_movements SET gl_posting_status='exempt_zero_value', gl_posted_at=datetime('now') WHERE company_id=${COMPANY_ID} AND id=${row.id} AND journal_entry_id IS NULL AND COALESCE(gl_posting_status,'') != 'exempt_zero_value';`)
    markEventExempt(row.event_id, 'exempt_zero_value')
    continue
  }

  const description = `حركة مخزنية | ${row.movement_type} | صنف ${row.item_code || row.id} | ${row.warehouse || ''}`.trim()
  emitEntry({
    refType: 'inventory_movement',
    refId: row.id,
    entryDate: row.movement_date,
    description,
    eventId: row.event_id,
    eventType: row.event_type,
    lineA: isGrn
      ? { account: inventoryAccount, debit: amount, credit: 0, centerCode: row.center_code, seasonId: row.season_id, fieldId: row.field_id, sourceLedger: 'inventory' }
      : { account: controlAccounts.get('cogs') || '45010001', debit: amount, credit: 0, centerCode: row.center_code, seasonId: row.season_id, fieldId: row.field_id, sourceLedger: 'inventory' },
    lineB: isGrn
      ? { account: resolveSupplierApAccount({ supplier_code: null, service_type_code: null, supplier_gl: null }, controlAccounts, supplierServiceExactMap, supplierServicePrimaryMap), debit: 0, credit: amount, centerCode: row.center_code, seasonId: row.season_id, fieldId: row.field_id, sourceLedger: 'inventory' }
      : { account: inventoryAccount, debit: 0, credit: amount, centerCode: row.center_code, seasonId: row.season_id, fieldId: row.field_id, sourceLedger: 'inventory' },
    sourceUpdateSql: (jeId) => `UPDATE inventory_movements SET journal_entry_id=${jeId}, gl_posting_status='posted', gl_posted_at=datetime('now') WHERE company_id=${COMPANY_ID} AND id=${row.id} AND journal_entry_id IS NULL;`,
  })
}

console.log(`\nCandidates: supplier=${supplierRows.length}, cash=${cashRows.length}, inventory=${inventoryRows.length}`)
console.log(`Prelinked repairs: supplier=${supplierRepairs.length}, cash=${cashRepairs.length}, inventory=${inventoryRepairs.length}`)
console.log(`Posting cutoff date: ${POSTING_CUTOFF_DATE}`)
console.log(`Planned entries: ${plannedEntries}, planned statements: ${sql.length}, skipped_zero_amount=${skippedZero}, skipped_future_date=${skippedFuture}, skipped_missing_event=${skippedNoEvent}`)
console.log(`Planned totals: debit=${totalDebit.toFixed(2)}, credit=${totalCredit.toFixed(2)}, diff=${Math.abs(totalDebit - totalCredit).toFixed(2)}`)

if (Math.abs(totalDebit - totalCredit) > 0.01) {
  console.error('❌ Abort: simulated posting not balanced.')
  process.exit(1)
}

if (!APPLY) {
  console.log('\nDry run complete. Re-run with --apply to execute posting writes.')
  process.exit(0)
}

writeAndExecStatements([...repairSql, ...sql])

const remainingSupplier = scalar(`SELECT COUNT(*) AS n FROM supplier_transactions WHERE company_id=${COMPANY_ID} AND status='posted' AND journal_entry_id IS NULL AND NOT (COALESCE(amount,0)=0 AND COALESCE(debit,0)=0 AND COALESCE(credit,0)=0)`, 'n')
const remainingCash = scalar(`SELECT COUNT(*) AS n FROM cash_transactions WHERE company_id=${COMPANY_ID} AND status='posted' AND journal_entry_id IS NULL AND COALESCE(amount,0) > 0`, 'n')
const remainingInv = scalar(`SELECT COUNT(*) AS n FROM inventory_movements WHERE company_id=${COMPANY_ID} AND status='posted' AND journal_entry_id IS NULL AND movement_type IN ('GRN','ISSUE') AND COALESCE(gl_posting_status,'') NOT IN ('exempt_zero_value','skipped_zero_value')`, 'n')
const zeroSupplierExempt = scalar(`SELECT COUNT(*) AS n FROM supplier_transactions WHERE company_id=${COMPANY_ID} AND status='posted' AND journal_entry_id IS NULL AND COALESCE(amount,0)=0 AND COALESCE(debit,0)=0 AND COALESCE(credit,0)=0`, 'n')
const zeroInventoryExempt = scalar(`SELECT COUNT(*) AS n FROM inventory_movements WHERE company_id=${COMPANY_ID} AND status='posted' AND movement_type IN ('GRN','ISSUE') AND journal_entry_id IS NULL AND COALESCE(gl_posting_status,'') IN ('exempt_zero_value','skipped_zero_value')`, 'n')
const linkedEvents = scalar(`SELECT COUNT(*) AS n FROM business_events WHERE company_id=${COMPANY_ID} AND journal_entry_id IS NOT NULL`, 'n')
const postingResolutions = scalar(`SELECT COUNT(*) AS n FROM posting_rule_resolutions WHERE company_id=${COMPANY_ID}`, 'n')
const unbalanced = scalar(`
  SELECT COUNT(*) AS n FROM (
    SELECT je.id
    FROM journal_entries je
    JOIN journal_entry_lines jl ON jl.entry_id = je.id
    WHERE je.company_id=${COMPANY_ID}
      AND je.ref_type IN ('supplier_transaction','cash_transaction','inventory_movement')
    GROUP BY je.id
    HAVING ABS(ROUND(SUM(jl.debit),2) - ROUND(SUM(jl.credit),2)) > 0.01
  )
`, 'n')

console.log('\nExecution complete.')
console.log(`Remaining actionable unlinked: supplier=${remainingSupplier}, cash=${remainingCash}, inventory=${remainingInv}`)
console.log(`Zero-value exemptions: supplier=${zeroSupplierExempt}, inventory=${zeroInventoryExempt}`)
console.log(`Business events linked to JE: ${linkedEvents}`)
console.log(`Posting rule resolutions rows: ${postingResolutions}`)
console.log(`Unbalanced linked entries: ${unbalanced}`)

if (remainingSupplier !== 0 || remainingCash !== 0 || remainingInv !== 0 || unbalanced !== 0) {
  process.exit(2)
}

process.exit(0)
