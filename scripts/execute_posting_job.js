#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DB_NAME = 'agri-nile-flow-data-lake';
const COMPANY_ID = 1;
const APPLY = process.argv.includes('--apply');
const ROOT = process.cwd();
const TMP_DIR = path.join(ROOT, 'sql', 'generated_phase4');

const ACCOUNTS = {
  AP: '212000010',
  CASH: '14010101',
  EXPENSE: '45010001',
  REVENUE: '41010001',
  INVENTORY: '14070101',
  COGS: '45010001',
};

function inventoryAccountForWarehouse(warehouse) {
  const w = String(warehouse || '').trim();
  if (w === 'اسمدة') return '14070101';
  if (w === 'مبيدات') return '14070102';
  if (w === 'تقاوي') return '14070103';
  if (w === 'شبكات ري') return '14070104';
  if (w === 'قطع غيار') return '14070105';
  return ACCOUNTS.INVENTORY;
}

function runD1Json(sql) {
  const compact = sql.replace(/\s+/g, ' ').trim();
  const escaped = compact.replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --yes --json --command "${escaped}"`;
  const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const start = out.indexOf('[');
  const end = out.lastIndexOf(']');
  if (start < 0 || end < 0 || end < start) {
    throw new Error('Failed to parse D1 output');
  }
  return JSON.parse(out.slice(start, end + 1));
}

function query(sql) {
  return runD1Json(sql)[0]?.results ?? [];
}

function scalar(sql, key) {
  const row = query(sql)[0] || {};
  return Number(row[key] || 0);
}

function esc(str) {
  if (str == null) return '';
  return String(str).replace(/'/g, "''");
}

function money(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function writeAndExecStatements(statements) {
  if (!statements.length) return;
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const groups = chunk(statements, 100);
  for (let i = 0; i < groups.length; i += 1) {
    const p = path.join(TMP_DIR, `_posting_batch_${i + 1}.sql`);
    fs.writeFileSync(p, groups[i].join('\n') + '\n', 'utf8');
    try {
      execSync(`npx wrangler d1 execute ${DB_NAME} --remote --yes --file "${p}"`, { cwd: ROOT, stdio: 'inherit' });
    } finally {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
}

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log(`║   PHASE 4 Posting Job — ${APPLY ? 'APPLY MODE' : 'DRY RUN MODE'}                      ║`);
console.log('╚════════════════════════════════════════════════════════════════╝\n');

const openPeriods = query(`
  SELECT id, name, start_date, end_date
  FROM financial_periods
  WHERE company_id=${COMPANY_ID} AND is_closed=0
  ORDER BY id
`);

if (openPeriods.length !== 1) {
  console.error(`❌ Period lock failed: expected exactly 1 open period, found ${openPeriods.length}`);
  process.exit(1);
}

const period = openPeriods[0];
console.log(`Open period: ${period.id} | ${period.name} | ${period.start_date} -> ${period.end_date}`);

const maxJeId = scalar(`SELECT COALESCE(MAX(id), 0) AS v FROM journal_entries WHERE company_id=${COMPANY_ID}`, 'v');
let nextJeId = maxJeId + 1;

const supplierRows = query(`
  SELECT st.id, st.transaction_date, st.entry_type, st.amount, st.debit, st.credit, st.center_code, st.season_id, st.document_type, st.document_number, st.notes, s.gl_account_code AS supplier_gl
  FROM supplier_transactions st
  LEFT JOIN suppliers s
    ON s.company_id = st.company_id
   AND s.code = st.supplier_code
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
`);

const cashRows = query(`
  SELECT ct.id, ct.transaction_date, ct.amount, ct.debit, ct.credit, ct.center_code, ct.season_id, ct.field_id, ct.document_type, ct.document_number, ct.notes
  FROM cash_transactions ct
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
`);

const inventoryRows = query(`
  SELECT im.id, im.movement_date, im.movement_type, im.value_in, im.value_out, im.quantity, im.unit_price, im.center_code, im.season_id, im.field_id, im.item_code
      , im.warehouse
  FROM inventory_movements im
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
`);

const sql = [];
let totalDebit = 0;
let totalCredit = 0;
let skipped = 0;
let plannedEntries = 0;

function emitEntry(refType, refId, entryDate, desc, lineA, lineB, sourceUpdateSql) {
  const jeId = nextJeId;
  nextJeId += 1;
  plannedEntries += 1;

  totalDebit += money(lineA.debit) + money(lineB.debit);
  totalCredit += money(lineA.credit) + money(lineB.credit);

  sql.push(
    `INSERT OR IGNORE INTO journal_entries (id, company_id, period_id, entry_date, description, ref_type, ref_id, is_posted, created_at, local_id) VALUES (${jeId}, ${COMPANY_ID}, ${period.id}, '${entryDate}', '${esc(desc)}', '${refType}', ${refId}, 1, datetime('now'), 'phase4_${refType}_${refId}');`
  );
  sql.push(
    `INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, season_id, field_id, source_ledger, source_record_id) VALUES (${jeId}, ${COMPANY_ID}, '${lineA.account}', ${money(lineA.debit)}, ${money(lineA.credit)}, '${esc(desc)}', ${lineA.centerCode ?? 'NULL'}, ${lineA.seasonId ?? 'NULL'}, ${lineA.fieldId ?? 'NULL'}, '${lineA.sourceLedger}', ${refId});`
  );
  sql.push(
    `INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, season_id, field_id, source_ledger, source_record_id) VALUES (${jeId}, ${COMPANY_ID}, '${lineB.account}', ${money(lineB.debit)}, ${money(lineB.credit)}, '${esc(desc)}', ${lineB.centerCode ?? 'NULL'}, ${lineB.seasonId ?? 'NULL'}, ${lineB.fieldId ?? 'NULL'}, '${lineB.sourceLedger}', ${refId});`
  );
  sql.push(sourceUpdateSql(jeId));
}

for (const row of supplierRows) {
  const apAccount = row.supplier_gl ? String(row.supplier_gl) : ACCOUNTS.AP;
  const isPayment = String(row.entry_type || '') === 'م';
  const amount = isPayment ? money(row.debit || row.amount || row.credit) : money(row.credit || row.amount || row.debit);
  const safeAmount = amount > 0 ? amount : 0;
  if (safeAmount === 0) skipped += 1;
  const desc = `Phase4 supplier ${row.id} ${row.document_type || ''} ${row.document_number || ''}`.trim();
  emitEntry(
    'supplier_transaction',
    row.id,
    row.transaction_date,
    desc,
    isPayment
      ? { account: apAccount, debit: safeAmount, credit: 0, centerCode: row.center_code, seasonId: row.season_id, fieldId: null, sourceLedger: 'supplier' }
      : { account: ACCOUNTS.EXPENSE, debit: safeAmount, credit: 0, centerCode: row.center_code, seasonId: row.season_id, fieldId: null, sourceLedger: 'supplier' },
    isPayment
      ? { account: ACCOUNTS.CASH, debit: 0, credit: safeAmount, centerCode: row.center_code, seasonId: row.season_id, fieldId: null, sourceLedger: 'supplier' }
      : { account: apAccount, debit: 0, credit: safeAmount, centerCode: row.center_code, seasonId: row.season_id, fieldId: null, sourceLedger: 'supplier' },
    (jeId) => `UPDATE supplier_transactions SET journal_entry_id=${jeId} WHERE company_id=${COMPANY_ID} AND id=${row.id} AND journal_entry_id IS NULL;`
  );
}

for (const row of cashRows) {
  const credit = money(row.credit);
  const debit = money(row.debit);
  const amount = credit > 0 ? credit : debit > 0 ? debit : money(row.amount);
  if (amount <= 0) {
    skipped += 1;
    continue;
  }

  const isIncome = credit > 0;
  const desc = `Phase4 cash ${row.id} ${row.document_type || ''} ${row.document_number || ''}`.trim();
  emitEntry(
    'cash_transaction',
    row.id,
    row.transaction_date,
    desc,
    isIncome
      ? { account: ACCOUNTS.CASH, debit: amount, credit: 0, centerCode: row.center_code, seasonId: row.season_id, fieldId: row.field_id, sourceLedger: 'cash' }
      : { account: ACCOUNTS.EXPENSE, debit: amount, credit: 0, centerCode: row.center_code, seasonId: row.season_id, fieldId: row.field_id, sourceLedger: 'cash' },
    isIncome
      ? { account: ACCOUNTS.REVENUE, debit: 0, credit: amount, centerCode: row.center_code, seasonId: row.season_id, fieldId: row.field_id, sourceLedger: 'cash' }
      : { account: ACCOUNTS.CASH, debit: 0, credit: amount, centerCode: row.center_code, seasonId: row.season_id, fieldId: row.field_id, sourceLedger: 'cash' },
    (jeId) => `UPDATE cash_transactions SET journal_entry_id=${jeId} WHERE company_id=${COMPANY_ID} AND id=${row.id} AND journal_entry_id IS NULL;`
  );
}

for (const row of inventoryRows) {
  const inventoryAccount = inventoryAccountForWarehouse(row.warehouse);
  const isGrn = String(row.movement_type) === 'GRN';
  const amount = isGrn
    ? money(row.value_in || (money(row.quantity) * money(row.unit_price)))
    : money(row.value_out || (money(row.quantity) * money(row.unit_price)));

  if (amount <= 0) {
    skipped += 1;
    sql.push(`UPDATE inventory_movements SET gl_posting_status='exempt_zero_value', gl_posted_at=datetime('now') WHERE company_id=${COMPANY_ID} AND id=${row.id} AND journal_entry_id IS NULL AND COALESCE(gl_posting_status,'') != 'exempt_zero_value';`);
    continue;
  }

  const desc = `Phase4 inventory ${row.id} ${row.movement_type} item ${row.item_code || ''}`.trim();
  emitEntry(
    'inventory_movement',
    row.id,
    row.movement_date,
    desc,
    isGrn
      ? { account: inventoryAccount, debit: amount, credit: 0, centerCode: row.center_code, seasonId: row.season_id, fieldId: row.field_id, sourceLedger: 'inventory' }
      : { account: ACCOUNTS.COGS, debit: amount, credit: 0, centerCode: row.center_code, seasonId: row.season_id, fieldId: row.field_id, sourceLedger: 'inventory' },
    isGrn
      ? { account: ACCOUNTS.AP, debit: 0, credit: amount, centerCode: row.center_code, seasonId: row.season_id, fieldId: row.field_id, sourceLedger: 'inventory' }
      : { account: inventoryAccount, debit: 0, credit: amount, centerCode: row.center_code, seasonId: row.season_id, fieldId: row.field_id, sourceLedger: 'inventory' },
    (jeId) => `UPDATE inventory_movements SET journal_entry_id=${jeId}, gl_posting_status='posted', gl_posted_at=datetime('now') WHERE company_id=${COMPANY_ID} AND id=${row.id} AND journal_entry_id IS NULL;`
  );
}

console.log(`\nCandidates: supplier=${supplierRows.length}, cash=${cashRows.length}, inventory=${inventoryRows.length}`);
console.log(`Planned entries: ${plannedEntries}, planned statements: ${sql.length}, skipped_zero_amount=${skipped}`);
console.log(`Planned totals: debit=${totalDebit.toFixed(2)}, credit=${totalCredit.toFixed(2)}, diff=${Math.abs(totalDebit - totalCredit).toFixed(2)}`);

if (Math.abs(totalDebit - totalCredit) > 0.01) {
  console.error('❌ Abort: simulated posting not balanced.');
  process.exit(1);
}

if (!APPLY) {
  console.log('\nDry run complete. Re-run with --apply to execute posting writes.');
  process.exit(0);
}

writeAndExecStatements(sql);

const remainingSupplier = scalar(`SELECT COUNT(*) AS n FROM supplier_transactions WHERE company_id=${COMPANY_ID} AND status='posted' AND journal_entry_id IS NULL`, 'n');
const remainingCash = scalar(`SELECT COUNT(*) AS n FROM cash_transactions WHERE company_id=${COMPANY_ID} AND status='posted' AND journal_entry_id IS NULL`, 'n');
const remainingInv = scalar(`SELECT COUNT(*) AS n FROM inventory_movements WHERE company_id=${COMPANY_ID} AND status='posted' AND journal_entry_id IS NULL AND movement_type IN ('GRN','ISSUE') AND COALESCE(gl_posting_status,'') NOT IN ('exempt_zero_value','skipped_zero_value')`, 'n');
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
`, 'n');

console.log('\nExecution complete.');
console.log(`Remaining unlinked: supplier=${remainingSupplier}, cash=${remainingCash}, inventory=${remainingInv}`);
console.log(`Unbalanced linked entries: ${unbalanced}`);

if (remainingSupplier !== 0 || remainingCash !== 0 || remainingInv !== 0 || unbalanced !== 0) {
  process.exit(2);
}

process.exit(0);
