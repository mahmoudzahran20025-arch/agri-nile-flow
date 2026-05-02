/**
 * Phase 2 Backfill: Create GL journal entries for 320 unlinked supplier_transactions
 *
 * Posting logic:
 *   Invoice  (entry_type='د', credit=0, debit>0):  DR 45010001 (expense), CR 2110 (AP)
 *   Payment  (entry_type='م', debit>0, credit=0):  DR 2110 (AP),          CR 14010101 (cash)
 *
 * Also inserts business_events rows and updates supplier_transactions.journal_entry_id
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DB = 'agri-nile-flow-data-lake';
const COMPANY_ID = 1;

// GL accounts
const EXPENSE_ACCOUNT  = '45010001';  // تكلفة المبيعات / purchases/expense contra
const AP_ACCOUNT       = '2110';      // Accounts Payable control
const CASH_ACCOUNT     = '14010101';  // Cash

function runQuery(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute ${DB} --remote --json --command "${escaped}"`;
  try {
    const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
    return JSON.parse(out);
  } catch (e) {
    const errOut = e.stdout || e.stderr || e.message;
    console.error('Query failed:', errOut.substring(0, 500));
    throw new Error('Query failed');
  }
}

function execFile(filePath) {
  const cmd = `npx wrangler d1 execute ${DB} --remote --file "${filePath}"`;
  try {
    const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 300000 });
    return out;
  } catch (e) {
    const errOut = e.stdout || e.stderr || e.message;
    console.error('File exec failed:', errOut.substring(0, 500));
    throw new Error('File exec failed');
  }
}

async function main() {
  console.log('=== Phase 2 Supplier GL Backfill ===\n');

  // 1. Get current max IDs
  console.log('Step 1: Getting current max IDs...');
  const [maxJeRes, maxBeRes] = [
    runQuery(`SELECT MAX(id) AS max_id FROM journal_entries WHERE company_id=${COMPANY_ID}`),
    runQuery(`SELECT MAX(id) AS max_id FROM business_events WHERE company_id=${COMPANY_ID}`),
  ];
  const maxJeId = maxJeRes[0].results[0].max_id || 3541;
  const maxBeId = maxBeRes[0].results[0].max_id || 261;
  console.log(`  Max journal_entry id : ${maxJeId}`);
  console.log(`  Max business_event id: ${maxBeId}`);

  // 2. Fetch all 320 unlinked supplier_transactions
  console.log('\nStep 2: Fetching unlinked supplier_transactions...');
  const stRes = runQuery(
    `SELECT id, company_id, supplier_code, account_code, center_code, season_id, transaction_date, entry_type, document_type, document_number, amount, credit, debit, notes FROM supplier_transactions WHERE company_id=${COMPANY_ID} AND status='posted' AND journal_entry_id IS NULL ORDER BY transaction_date ASC, id ASC`
  );
  const rows = stRes[0].results;
  console.log(`  Found ${rows.length} unlinked supplier_transactions`);

  if (rows.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // 3. Generate SQL file
  console.log('\nStep 3: Generating SQL...');
  const sqlLines = [];
  let jeId = maxJeId + 1;
  let beId = maxBeId + 1;
  let invoiceCount = 0;
  let paymentCount = 0;

  for (const st of rows) {
    const isPayment = st.entry_type === 'م';
    const amount    = st.amount || (isPayment ? st.debit : st.credit) || 0;
    const eventType = isPayment ? 'supplier_payment' : 'supplier_invoice';
    const descParts = [st.document_type, st.document_number, st.notes].filter(Boolean);
    const desc      = descParts.join(' - ') || eventType;
    const safeDesc  = desc.replace(/'/g, "''");
    const entryDate = st.transaction_date;

    // 3a. journal_entries
    sqlLines.push(
      `INSERT OR IGNORE INTO journal_entries (id, company_id, entry_date, description, ref_type, ref_id, is_posted, created_at)` +
      ` VALUES (${jeId}, ${COMPANY_ID}, '${entryDate}', '${safeDesc}', 'supplier_transaction', ${st.id}, 1, datetime('now'));`
    );

    // 3b. journal_entry_lines
    if (isPayment) {
      // Payment: DR 2110 (AP), CR 14010101 (Cash)
      sqlLines.push(
        `INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, season_id, source_ledger, source_record_id)` +
        ` VALUES (${jeId}, ${COMPANY_ID}, '${AP_ACCOUNT}', ${amount}, 0, '${safeDesc}', ${st.center_code ?? 'NULL'}, ${st.season_id ?? 'NULL'}, 'supplier', ${st.id});`
      );
      sqlLines.push(
        `INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, season_id, source_ledger, source_record_id)` +
        ` VALUES (${jeId}, ${COMPANY_ID}, '${CASH_ACCOUNT}', 0, ${amount}, '${safeDesc}', ${st.center_code ?? 'NULL'}, ${st.season_id ?? 'NULL'}, 'supplier', ${st.id});`
      );
      paymentCount++;
    } else {
      // Invoice: DR 45010001 (Expense), CR 2110 (AP)
      sqlLines.push(
        `INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, season_id, source_ledger, source_record_id)` +
        ` VALUES (${jeId}, ${COMPANY_ID}, '${EXPENSE_ACCOUNT}', ${amount}, 0, '${safeDesc}', ${st.center_code ?? 'NULL'}, ${st.season_id ?? 'NULL'}, 'supplier', ${st.id});`
      );
      sqlLines.push(
        `INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, season_id, source_ledger, source_record_id)` +
        ` VALUES (${jeId}, ${COMPANY_ID}, '${AP_ACCOUNT}', 0, ${amount}, '${safeDesc}', ${st.center_code ?? 'NULL'}, ${st.season_id ?? 'NULL'}, 'supplier', ${st.id});`
      );
      invoiceCount++;
    }

    // 3c. Update supplier_transactions.journal_entry_id
    sqlLines.push(
      `UPDATE supplier_transactions SET journal_entry_id=${jeId} WHERE id=${st.id};`
    );

    // 3d. business_events
    const payload = JSON.stringify({
      supplier_code: st.supplier_code,
      document_type: st.document_type || '',
      amount:        amount,
      entry_type:    st.entry_type,
    }).replace(/'/g, "''");

    sqlLines.push(
      `INSERT OR IGNORE INTO business_events (id, company_id, event_type, event_date, source_module, source_id, payload, status, journal_entry_id, posted_at)` +
      ` VALUES (${beId}, ${COMPANY_ID}, '${eventType}', '${entryDate}', 'suppliers', ${st.id}, '${payload}', 'posted', ${jeId}, datetime('now'));`
    );

    jeId++;
    beId++;
  }

  const sqlFile = path.join(__dirname, 'backfill_supplier_gl_phase2_generated.sql');
  fs.writeFileSync(sqlFile, sqlLines.join('\n'), 'utf8');
  console.log(`  Generated ${sqlLines.length} SQL statements → ${sqlFile}`);
  console.log(`  Invoices: ${invoiceCount}, Payments: ${paymentCount}`);
  console.log(`  New JE IDs: ${maxJeId + 1} → ${jeId - 1}`);

  // 4. Execute SQL file
  console.log('\nStep 4: Executing SQL against D1 (remote)...');
  const result = execFile(sqlFile);
  console.log('  Done. Output:', result.substring(0, 300));

  // 5. Verify
  console.log('\nStep 5: Verification...');
  const [unlinkedCount, beCount, jeCount] = [
    runQuery(`SELECT COUNT(*) AS cnt FROM supplier_transactions WHERE company_id=${COMPANY_ID} AND status='posted' AND journal_entry_id IS NULL`),
    runQuery(`SELECT COUNT(*) AS cnt FROM business_events WHERE company_id=${COMPANY_ID} AND source_module='suppliers'`),
    runQuery(`SELECT COUNT(*) AS cnt FROM journal_entries WHERE company_id=${COMPANY_ID} AND ref_type='supplier_transaction'`),
  ];

  console.log(`  Remaining unlinked supplier_transactions: ${unlinkedCount[0].results[0].cnt} (should be 0)`);
  console.log(`  Total business_events for suppliers      : ${beCount[0].results[0].cnt} (should be 579)`);
  console.log(`  Total JEs for supplier_transaction       : ${jeCount[0].results[0].cnt}`);

  console.log('\n=== Phase 2 Complete ===');
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
