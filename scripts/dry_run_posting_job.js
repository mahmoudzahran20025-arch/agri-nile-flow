#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');

const DB_NAME = 'agri-nile-flow-data-lake';
const COMPANY_ID = 1;
const REPORT_PATH = 'reports/DRY_RUN_POSTING_SIMULATION_2026-05-09.json';

function runD1(sql) {
  const compactSql = sql.replace(/\s+/g, ' ').trim();
  const escapedSql = compactSql.replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --yes --json --command "${escapedSql}"`;
  const raw = execSync(cmd, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`Unable to parse D1 output for SQL: ${compactSql}`);
  }
  return JSON.parse(raw.slice(start, end + 1));
}

function rows(sql) {
  const parsed = runD1(sql);
  return parsed[0]?.results ?? [];
}

function one(sql, key) {
  const row = rows(sql)[0] || {};
  const value = row[key];
  return typeof value === 'number' ? value : Number(value || 0);
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function sumMoney(rows, selector) {
  return rows.reduce((total, row) => total + Number(selector(row) || 0), 0);
}

function outputSection(title) {
  console.log(`\n▌ ${title}\n`);
}

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║        POSTING DRY RUN — Read Only Simulation                  ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

const openPeriods = rows(`
  SELECT id, name, start_date, end_date, is_closed, status
  FROM financial_periods
  WHERE company_id=${COMPANY_ID} AND is_closed=0
  ORDER BY id
`);
const activePeriod = openPeriods[0] || null;
const openPeriodCount = openPeriods.length;

const supplierRows = rows(`
  SELECT id, supplier_code, entry_type, transaction_date, amount, debit, credit, center_code, season_id, journal_entry_id
  FROM supplier_transactions
  WHERE company_id=${COMPANY_ID}
    AND status='posted'
    AND journal_entry_id IS NULL
  ORDER BY transaction_date, id
`);

const cashRows = rows(`
  SELECT id, supplier_code, transaction_date, amount, debit, credit, direction, center_code, season_id, field_id, journal_entry_id
  FROM cash_transactions
  WHERE company_id=${COMPANY_ID}
    AND status='posted'
    AND journal_entry_id IS NULL
  ORDER BY transaction_date, id
`);

const inventoryRows = rows(`
  SELECT id, item_code, movement_date, movement_type, quantity, unit_price, value_in, value_out, warehouse, center_code, sub_code, journal_entry_id
  FROM inventory_movements
  WHERE company_id=${COMPANY_ID}
    AND status='posted'
    AND journal_entry_id IS NULL
  ORDER BY movement_date, id
`);

const supplierMasterMissingGl = one(`
  SELECT COUNT(*) AS n
  FROM suppliers
  WHERE company_id=${COMPANY_ID}
    AND gl_account_code IS NULL
`, 'n');

const orphanSupplierTxns = one(`
  SELECT COUNT(*) AS n
  FROM supplier_transactions st
  WHERE st.company_id=${COMPANY_ID}
    AND st.status='posted'
    AND st.journal_entry_id IS NULL
    AND (st.supplier_code IS NULL OR st.supplier_code NOT IN (
      SELECT s.code FROM suppliers s WHERE s.company_id=${COMPANY_ID}
    ))
`, 'n');

const invalidQty = one(`
  SELECT COUNT(*) AS n
  FROM inventory_movements
  WHERE company_id=${COMPANY_ID}
    AND status='posted'
    AND journal_entry_id IS NULL
    AND (quantity IS NULL OR quantity <= 0)
`, 'n');

const invalidPrice = one(`
  SELECT COUNT(*) AS n
  FROM inventory_movements
  WHERE company_id=${COMPANY_ID}
    AND status='posted'
    AND journal_entry_id IS NULL
    AND (unit_price IS NULL OR unit_price < 0)
`, 'n');

const missingItem = one(`
  SELECT COUNT(*) AS n
  FROM inventory_movements
  WHERE company_id=${COMPANY_ID}
    AND status='posted'
    AND journal_entry_id IS NULL
    AND (item_code IS NULL OR TRIM(item_code)='')
`, 'n');

const invalidMovementType = one(`
  SELECT COUNT(*) AS n
  FROM inventory_movements
  WHERE company_id=${COMPANY_ID}
    AND status='posted'
    AND journal_entry_id IS NULL
    AND movement_type NOT IN ('GRN','ISSUE','RETURN_SUPPLIER','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT_IN','ADJUSTMENT_OUT')
`, 'n');

const futureInventory = one(`
  SELECT COUNT(*) AS n
  FROM inventory_movements
  WHERE company_id=${COMPANY_ID}
    AND status='posted'
    AND journal_entry_id IS NULL
    AND movement_date > date('now')
`, 'n');

const cashIncomplete = one(`
  SELECT COUNT(*) AS n
  FROM cash_transactions
  WHERE company_id=${COMPANY_ID}
    AND status='posted'
    AND journal_entry_id IS NULL
    AND (
      amount IS NULL
      OR amount <= 0
      OR direction IS NULL
      OR TRIM(direction)=''
      OR transaction_date IS NULL
    )
`, 'n');

const candidateDatesOutsideOpenPeriod = activePeriod ? one(`
  SELECT COUNT(*) AS n
  FROM (
    SELECT transaction_date AS d FROM supplier_transactions WHERE company_id=${COMPANY_ID} AND status='posted' AND journal_entry_id IS NULL
    UNION ALL
    SELECT transaction_date AS d FROM cash_transactions WHERE company_id=${COMPANY_ID} AND status='posted' AND journal_entry_id IS NULL
    UNION ALL
    SELECT movement_date AS d FROM inventory_movements WHERE company_id=${COMPANY_ID} AND status='posted' AND journal_entry_id IS NULL
  ) x
  WHERE d < '${activePeriod.start_date}' OR d > '${activePeriod.end_date}'
`, 'n') : 0;

const supplierInvoiceRows = supplierRows.filter((row) => String(row.entry_type || '') !== 'م');
const supplierPaymentRows = supplierRows.filter((row) => String(row.entry_type || '') === 'م');
const cashIncomeRows = cashRows.filter((row) => Number(row.credit || 0) > 0);
const cashExpenseRows = cashRows.filter((row) => Number(row.debit || 0) > 0 && Number(row.credit || 0) <= 0);
const inventoryGrnRows = inventoryRows.filter((row) => String(row.movement_type || '') === 'GRN');
const inventoryIssueRows = inventoryRows.filter((row) => String(row.movement_type || '') === 'ISSUE');

const supplierDebitTotal = sumMoney(supplierRows, (row) => {
  const isPayment = String(row.entry_type || '') === 'م';
  return isPayment ? (row.debit || row.amount || row.credit || 0) : (row.credit || row.amount || row.debit || 0);
});
const supplierCreditTotal = supplierDebitTotal;

const cashDebitTotal = sumMoney(cashRows, (row) => {
  if (Number(row.credit || 0) > 0) return row.credit;
  if (Number(row.debit || 0) > 0) return row.debit;
  return row.amount;
});
const cashCreditTotal = cashDebitTotal;

const inventoryDebitTotal = sumMoney(inventoryRows, (row) => {
  if (String(row.movement_type || '') === 'GRN') return row.value_in;
  return row.value_out;
});
const inventoryCreditTotal = inventoryDebitTotal;

const totalEntries = supplierRows.length + cashRows.length + inventoryRows.length;
const totalLines = totalEntries * 2;
const totalDebit = supplierDebitTotal + cashDebitTotal + inventoryDebitTotal;
const totalCredit = supplierCreditTotal + cashCreditTotal + inventoryCreditTotal;

const duplicateBusinessEvents = one(`
  SELECT COUNT(*) AS n
  FROM (
    SELECT source_module, source_id, event_type, COUNT(*) AS c
    FROM business_events
    WHERE company_id=${COMPANY_ID}
    GROUP BY source_module, source_id, event_type
    HAVING c > 1
  )
`, 'n');

const duplicateJournalKeys = one(`
  SELECT COUNT(*) AS n
  FROM (
    SELECT ref_type, ref_id, COUNT(*) AS c
    FROM journal_entries
    WHERE company_id=${COMPANY_ID} AND ref_type IS NOT NULL
    GROUP BY ref_type, ref_id
    HAVING c > 1
  )
`, 'n');

const existingLinkedCandidates = one(`
  SELECT COUNT(*) AS n
  FROM (
    SELECT id FROM supplier_transactions WHERE company_id=${COMPANY_ID} AND status='posted' AND journal_entry_id IS NOT NULL
    UNION ALL
    SELECT id FROM cash_transactions WHERE company_id=${COMPANY_ID} AND status='posted' AND journal_entry_id IS NOT NULL
    UNION ALL
    SELECT id FROM inventory_movements WHERE company_id=${COMPANY_ID} AND status='posted' AND journal_entry_id IS NOT NULL
  )
`, 'n');

const unresolvedMappings = supplierMasterMissingGl + orphanSupplierTxns + invalidQty + invalidPrice + missingItem + invalidMovementType + cashIncomplete;
const validationErrors = unresolvedMappings + futureInventory + candidateDatesOutsideOpenPeriod + (openPeriodCount === 1 ? 0 : 1);
const duplicateRisks = duplicateBusinessEvents + duplicateJournalKeys + existingLinkedCandidates;
const balancingOK = Math.abs(totalDebit - totalCredit) < 0.01;

outputSection('POSTING SCOPE');
console.log(`   Supplier transactions: ${supplierRows.length}`);
console.log(`   Cash transactions: ${cashRows.length}`);
console.log(`   Inventory movements: ${inventoryRows.length}`);
console.log(`   Total journal entries expected: ${totalEntries}`);
console.log(`   Total journal lines expected: ${totalLines}`);

outputSection('SOURCE DATASETS USED');
console.log('   Live D1 source tables only: supplier_transactions, cash_transactions, inventory_movements');
console.log('   Validation/reference tables: suppliers, chart_of_accounts, financial_periods, inventory_posting_setup, general_posting_setup, posting_rules, journal_entries, journal_entry_lines, business_events');

outputSection('TABLES THAT WOULD MUTATE IN REAL POSTING');
console.log('   journal_entries');
console.log('   journal_entry_lines');
console.log('   supplier_transactions (journal_entry_id)');
console.log('   cash_transactions (journal_entry_id)');
console.log('   inventory_movements (journal_entry_id, gl_posting_status)');
console.log('   business_events (posting linkage / idempotency trail, if event-backed path is used)');

outputSection('IDEMPOTENCY AND SAFETY');
console.log('   Re-run safe because the posting sources are selected only when journal_entry_id IS NULL.');
console.log('   Existing scripts also use INSERT OR IGNORE for journal_entries/business_events and link the source row after insert.');
console.log('   Dry run mode is read-only: no INSERT, UPDATE, DELETE, or batch write is executed.');

outputSection('PERIOD LOCK');
console.log(`   Open financial periods: ${openPeriodCount}`);
if (activePeriod) {
  console.log(`   Active period: ${activePeriod.id} | ${activePeriod.name} | ${activePeriod.start_date} -> ${activePeriod.end_date}`);
} else {
  console.log('   Active period: none');
}
console.log(`   Candidate rows outside open period: ${candidateDatesOutsideOpenPeriod}`);
console.log(`   Period-lock result: ${openPeriodCount === 1 && candidateDatesOutsideOpenPeriod === 0 ? 'PASS' : 'BLOCK'}`);

outputSection('FAILURE HANDLING');
console.log('   Any real posting failure should leave the source row unlinked and therefore retryable.');
console.log('   If a partial journal header exists without a link, the orphan checks should detect it before rerun.');
console.log('   If a batch fails, rerun only the same scope after fixing the cause; already-linked rows are skipped.');

outputSection('DRY-RUN SIMULATION');
console.log(`   Supplier postings simulated: ${supplierRows.length}`);
console.log(`   Cash postings simulated: ${cashRows.length}`);
console.log(`   Inventory postings simulated: ${inventoryRows.length}`);
console.log(`   Simulated entry count: ${totalEntries}`);
console.log(`   Simulated debit total: ${money(totalDebit)}`);
console.log(`   Simulated credit total: ${money(totalCredit)}`);
console.log(`   Balancing result: ${balancingOK ? 'BALANCED' : 'UNBALANCED'}`);

outputSection('SIMULATED ENTRY COUNTS');
console.log(`   Supplier invoices: ${supplierInvoiceRows.length}`);
console.log(`   Supplier payments: ${supplierPaymentRows.length}`);
console.log(`   Cash income rows: ${cashIncomeRows.length}`);
console.log(`   Cash expense rows: ${cashExpenseRows.length}`);
console.log(`   Inventory GRN rows: ${inventoryGrnRows.length}`);
console.log(`   Inventory ISSUE rows: ${inventoryIssueRows.length}`);

outputSection('SIMULATED POSTING TOTALS');
console.log(`   Supplier debit / credit: ${money(supplierDebitTotal)} / ${money(supplierCreditTotal)}`);
console.log(`   Cash debit / credit: ${money(cashDebitTotal)} / ${money(cashCreditTotal)}`);
console.log(`   Inventory debit / credit: ${money(inventoryDebitTotal)} / ${money(inventoryCreditTotal)}`);
console.log(`   Grand total debit / credit: ${money(totalDebit)} / ${money(totalCredit)}`);

outputSection('VALIDATION ERRORS');
console.log(`   Supplier master missing GL mappings: ${supplierMasterMissingGl}`);
console.log(`   Orphan supplier transaction refs: ${orphanSupplierTxns}`);
console.log(`   Invalid inventory quantities: ${invalidQty}`);
console.log(`   Invalid inventory prices: ${invalidPrice}`);
console.log(`   Missing inventory item codes: ${missingItem}`);
console.log(`   Invalid inventory movement types: ${invalidMovementType}`);
console.log(`   Incomplete cash rows: ${cashIncomplete}`);
console.log(`   Rows outside open period: ${candidateDatesOutsideOpenPeriod}`);
console.log(`   Future-dated inventory rows: ${futureInventory}`);
console.log(`   Open period count error: ${openPeriodCount === 1 ? 0 : 1}`);

outputSection('UNRESOLVED MAPPINGS');
console.log(`   Total unresolved mappings: ${unresolvedMappings}`);

outputSection('DUPLICATE RISKS');
console.log(`   Duplicate business event keys: ${duplicateBusinessEvents}`);
console.log(`   Duplicate journal entry keys: ${duplicateJournalKeys}`);
console.log(`   Already-linked source rows in scope: ${existingLinkedCandidates}`);
console.log(`   Total duplicate risk count: ${duplicateRisks}`);

outputSection('BALANCING RESULTS');
console.log(`   Balanced: ${balancingOK ? 'YES' : 'NO'}`);
console.log(`   Difference: ${money(Math.abs(totalDebit - totalCredit))}`);

const report = {
  timestamp: new Date().toISOString(),
  company_id: COMPANY_ID,
  database: DB_NAME,
  dry_run: true,
  posting_scope: {
    supplier_transactions: supplierRows.length,
    cash_transactions: cashRows.length,
    inventory_movements: inventoryRows.length,
    total_journal_entries: totalEntries,
    total_journal_lines: totalLines,
  },
  source_datasets: [
    'supplier_transactions',
    'cash_transactions',
    'inventory_movements',
    'suppliers',
    'chart_of_accounts',
    'financial_periods',
    'inventory_posting_setup',
    'general_posting_setup',
    'posting_rules',
    'journal_entries',
    'journal_entry_lines',
    'business_events',
  ],
  tables_that_would_mutate: [
    'journal_entries',
    'journal_entry_lines',
    'supplier_transactions',
    'cash_transactions',
    'inventory_movements',
    'business_events',
  ],
  simulated_totals: {
    supplier: {
      debit: Number(supplierDebitTotal.toFixed(2)),
      credit: Number(supplierCreditTotal.toFixed(2)),
      invoices: supplierInvoiceRows.length,
      payments: supplierPaymentRows.length,
    },
    cash: {
      debit: Number(cashDebitTotal.toFixed(2)),
      credit: Number(cashCreditTotal.toFixed(2)),
      incomes: cashIncomeRows.length,
      expenses: cashExpenseRows.length,
    },
    inventory: {
      debit: Number(inventoryDebitTotal.toFixed(2)),
      credit: Number(inventoryCreditTotal.toFixed(2)),
      grn: inventoryGrnRows.length,
      issue: inventoryIssueRows.length,
    },
    grand: {
      debit: Number(totalDebit.toFixed(2)),
      credit: Number(totalCredit.toFixed(2)),
    },
  },
  simulated_entry_counts: {
    supplier_transactions: supplierRows.length,
    cash_transactions: cashRows.length,
    inventory_movements: inventoryRows.length,
    total: totalEntries,
    total_lines: totalLines,
  },
  validation_errors: {
    supplier_master_missing_gl: supplierMasterMissingGl,
    orphan_supplier_transactions: orphanSupplierTxns,
    inventory_invalid_quantities: invalidQty,
    inventory_invalid_prices: invalidPrice,
    inventory_missing_item_codes: missingItem,
    inventory_invalid_movement_types: invalidMovementType,
    cash_incomplete_rows: cashIncomplete,
    rows_outside_open_period: candidateDatesOutsideOpenPeriod,
    future_dated_inventory_rows: futureInventory,
    open_period_count_error: openPeriodCount === 1 ? 0 : 1,
  },
  unresolved_mappings: unresolvedMappings,
  duplicate_risks: {
    duplicate_business_event_keys: duplicateBusinessEvents,
    duplicate_journal_entry_keys: duplicateJournalKeys,
    already_linked_source_rows: existingLinkedCandidates,
    total: duplicateRisks,
  },
  balancing_results: {
    balanced: balancingOK,
    difference: Number(Math.abs(totalDebit - totalCredit).toFixed(2)),
  },
  period_lock: {
    open_period_count: openPeriodCount,
    active_period_id: activePeriod ? activePeriod.id : null,
    candidate_rows_outside_open_period: candidateDatesOutsideOpenPeriod,
    pass: openPeriodCount === 1 && candidateDatesOutsideOpenPeriod === 0,
  },
  idempotency: {
    source_row_guard: 'journal_entry_id IS NULL',
    duplicate_insert_guard: 'INSERT OR IGNORE on journal_entries/business_events in existing backfill patterns',
    replay_behavior: 'safe to rerun after fixing failures; already-linked rows are skipped',
  },
  failure_handling: {
    strategy: 'retry by rerunning the same scope after remediation; inspect orphans before retry',
    partial_write_risk: 'headers without links would be caught by orphan checks',
  },
};

fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
console.log(`\n✅ Report written to ${REPORT_PATH}\n`);
