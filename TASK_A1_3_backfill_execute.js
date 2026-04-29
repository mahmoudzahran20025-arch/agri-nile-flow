#!/usr/bin/env node
/**
 * TASK A1.3: Backfill GL Links for Cash & Supplier Transactions
 * Execute on: Production D1 (agri-nile-flow-data-lake)
 * Date: 2026-04-29
 */

const { execSync } = require('child_process');

const DB = 'agri-nile-flow-data-lake';
const BATCH_SIZE = 5; // Process in small batches to avoid overload

function exec(sql) {
  try {
    const cmd = `npx wrangler d1 execute ${DB} --remote --command "${sql.replace(/"/g, '\\"')}"`;
    const result = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message.substring(0, 200) };
  }
}

function query(sql) {
  try {
    const cmd = `npx wrangler d1 execute ${DB} --remote --json --command "${sql.replace(/"/g, '\\"')}"`;
    const result = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
    const parsed = JSON.parse(result);
    return parsed[0]?.results ?? [];
  } catch (err) {
    console.error(`Query failed: ${err.message.substring(0, 100)}`);
    return [];
  }
}

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║  TASK A1.3: BACKFILL GL LINKS EXECUTION                        ║');
console.log('╚════════════════════════════════════════════════════════════════╝');
console.log(`Database: ${DB}`);
console.log(`Date: ${new Date().toISOString()}`);
console.log('');

// ============================================
// STEP 1: Check current status
// ============================================
console.log('📊 STEP 1: Current Status Check');
console.log('═══════════════════════════════════════════════════════════════');

const cashStatus = query(`
  SELECT 
    COUNT(*) as total,
    COUNT(CASE WHEN journal_entry_id IS NULL THEN 1 END) as missing_gl
  FROM cash_transactions 
  WHERE company_id = 1 AND status = 'posted'
`)[0] || {};

const supplierStatus = query(`
  SELECT 
    COUNT(*) as total,
    COUNT(CASE WHEN journal_entry_id IS NULL THEN 1 END) as missing_gl
  FROM supplier_transactions 
  WHERE company_id = 1 AND status = 'posted'
`)[0] || {};

console.log(`Cash Transactions: ${cashStatus.total || 0} total, ${cashStatus.missing_gl || 0} missing GL`);
console.log(`Supplier Transactions: ${supplierStatus.total || 0} total, ${supplierStatus.missing_gl || 0} missing GL`);
console.log('');

const totalMissing = (parseInt(cashStatus.missing_gl) || 0) + (parseInt(supplierStatus.missing_gl) || 0);

if (totalMissing === 0) {
  console.log('✅ All transactions already have GL links! Nothing to do.');
  process.exit(0);
}

// ============================================
// STEP 2: Get Control Accounts
// ============================================
console.log('\n📋 STEP 2: Loading Control Accounts');
console.log('═══════════════════════════════════════════════════════════════');

const controlAccounts = query(`
  SELECT mapping_key, account_code 
  FROM posting_rules 
  WHERE company_id = 1 AND rule_type = 'control' AND is_active = 1
`);

const accounts = {};
controlAccounts.forEach(acc => {
  accounts[acc.mapping_key] = acc.account_code;
});

console.log('Control Accounts:');
console.log(`  Cash: ${accounts.cash || '14010101'}`);
console.log(`  Expense: ${accounts.expense_default || '51200034'}`);
console.log(`  Revenue: ${accounts.revenue_default || '41010001'}`);
console.log(`  AP: ${accounts.accounts_payable || '2110'}`);
console.log('');

// ============================================
// STEP 3: Backfill Cash Transactions
// ============================================
if (cashStatus.missing_gl > 0) {
  console.log('\n🔧 STEP 3: Backfilling Cash Transactions');
  console.log('═══════════════════════════════════════════════════════════════');
  
  const cashTxs = query(`
    SELECT id, created_at, amount, debit, credit, document_type, journal_entry_id
    FROM cash_transactions 
    WHERE company_id = 1 AND status = 'posted' AND journal_entry_id IS NULL
    LIMIT ${BATCH_SIZE}
  `);
  
  console.log(`Processing ${cashTxs.length} cash transactions (batch of ${BATCH_SIZE})...`);
  
  let successCount = 0;
  let failCount = 0;
  
  for (const tx of cashTxs) {
    const credit = parseFloat(tx.credit) || 0;
    const debit = parseFloat(tx.debit) || 0;
    
    // Skip if already has JE
    if (tx.journal_entry_id) {
      console.log(`  ⚠️ Tx ${tx.id}: Already has JE ${tx.journal_entry_id}, skipping`);
      continue;
    }
    
    let drAccount, crAccount, drAmt, txType;
    
    if (credit > 0) {
      // Receipt - DR Cash, CR Revenue
      drAccount = accounts.cash || '14010101';
      crAccount = accounts.revenue_default || '41010001';
      drAmt = credit;
      txType = 'Receipt';
    } else if (debit > 0) {
      // Payment - DR Expense, CR Cash
      drAccount = accounts.expense_default || '51200034';
      crAccount = accounts.cash || '14010101';
      drAmt = debit;
      txType = 'Payment';
    } else {
      console.log(`  ⚠️ Tx ${tx.id}: Zero amount, skipping`);
      continue;
    }
    
    // Create Journal Entry
    const date = (tx.created_at || '2026-04-27').split(' ')[0];
    const ref = tx.document_type || 'cash';
    const desc = `Cash ${txType} ${tx.id}`;
    
    const jeResult = exec(`
      INSERT INTO journal_entries (company_id, entry_date, description, ref_type, ref_id, is_posted, created_at)
      VALUES (1, '${date}', '${desc}', '${ref}', ${tx.id}, 1, datetime('now'))
    `);
    
    if (!jeResult.success) {
      console.log(`  ❌ Tx ${tx.id}: Failed to create JE - ${jeResult.error}`);
      failCount++;
      continue;
    }
    
    // Get the new JE ID
    const jeIdResult = query('SELECT last_insert_rowid() as id');
    const jeId = jeIdResult[0]?.id;
    
    if (!jeId) {
      console.log(`  ❌ Tx ${tx.id}: Could not get JE ID`);
      failCount++;
      continue;
    }
    
    // Create JE Lines
    const line1 = exec(`
      INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, source_ledger, source_record_id, created_at)
      VALUES (${jeId}, 1, '${drAccount}', ${drAmt}, 0, '${desc}', 'cash', ${tx.id}, datetime('now'))
    `);
    
    const line2 = exec(`
      INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, source_ledger, source_record_id, created_at)
      VALUES (${jeId}, 1, '${crAccount}', 0, ${drAmt}, '${desc}', 'cash', ${tx.id}, datetime('now'))
    `);
    
    if (!line1.success || !line2.success) {
      console.log(`  ❌ Tx ${tx.id}: Failed to create lines`);
      failCount++;
      continue;
    }
    
    // Update cash transaction
    const update = exec(`UPDATE cash_transactions SET journal_entry_id = ${jeId} WHERE id = ${tx.id}`);
    
    if (!update.success) {
      console.log(`  ❌ Tx ${tx.id}: Failed to update transaction`);
      failCount++;
      continue;
    }
    
    console.log(`  ✅ Tx ${tx.id}: Created JE ${jeId} (${txType} ${drAmt})`);
    successCount++;
  }
  
  console.log(`\nCash Batch Results: ✅ ${successCount} success, ❌ ${failCount} failed`);
}

// ============================================
// STEP 4: Backfill Supplier Transactions
// ============================================
if (supplierStatus.missing_gl > 0) {
  console.log('\n🔧 STEP 4: Backfilling Supplier Transactions');
  console.log('═══════════════════════════════════════════════════════════════');
  
  const suppTxs = query(`
    SELECT id, created_at, amount, transaction_type, document_type, supplier_id, journal_entry_id
    FROM supplier_transactions 
    WHERE company_id = 1 AND status = 'posted' AND journal_entry_id IS NULL
    LIMIT ${BATCH_SIZE}
  `);
  
  console.log(`Processing ${suppTxs.length} supplier transactions (batch of ${BATCH_SIZE})...`);
  
  let successCount = 0;
  let failCount = 0;
  
  for (const tx of suppTxs) {
    const amount = parseFloat(tx.amount) || 0;
    
    // Skip if already has JE
    if (tx.journal_entry_id) {
      console.log(`  ⚠️ Tx ${tx.id}: Already has JE, skipping`);
      continue;
    }
    
    if (amount === 0) {
      console.log(`  ⚠️ Tx ${tx.id}: Zero amount, skipping`);
      continue;
    }
    
    let drAccount, crAccount, txType;
    
    // Determine accounts based on transaction type
    const txTypeLower = (tx.transaction_type || '').toLowerCase();
    
    if (txTypeLower.includes('invoice') || txTypeLower.includes('فاتورة')) {
      // Invoice - DR Purchases, CR AP
      drAccount = accounts.purchases || '45010001';
      crAccount = accounts.accounts_payable || '2110';
      txType = 'Invoice';
    } else if (txTypeLower.includes('payment') || txTypeLower.includes('دفع')) {
      // Payment - DR AP, CR Cash
      drAccount = accounts.accounts_payable || '2110';
      crAccount = accounts.cash || '14010101';
      txType = 'Payment';
    } else {
      // Default: DR Expense, CR AP
      drAccount = accounts.expense_default || '51200034';
      crAccount = accounts.accounts_payable || '2110';
      txType = 'Transaction';
    }
    
    // Create Journal Entry
    const date = (tx.created_at || '2026-04-27').split(' ')[0];
    const ref = tx.document_type || 'supplier';
    const desc = `Supplier ${txType} ${tx.id}`;
    
    const jeResult = exec(`
      INSERT INTO journal_entries (company_id, entry_date, description, ref_type, ref_id, is_posted, created_at)
      VALUES (1, '${date}', '${desc}', '${ref}', ${tx.id}, 1, datetime('now'))
    `);
    
    if (!jeResult.success) {
      console.log(`  ❌ Tx ${tx.id}: Failed to create JE - ${jeResult.error}`);
      failCount++;
      continue;
    }
    
    // Get JE ID
    const jeIdResult = query('SELECT last_insert_rowid() as id');
    const jeId = jeIdResult[0]?.id;
    
    if (!jeId) {
      console.log(`  ❌ Tx ${tx.id}: Could not get JE ID`);
      failCount++;
      continue;
    }
    
    // Create JE Lines
    const line1 = exec(`
      INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, source_ledger, source_record_id, created_at)
      VALUES (${jeId}, 1, '${drAccount}', ${amount}, 0, '${desc}', 'supplier', ${tx.id}, datetime('now'))
    `);
    
    const line2 = exec(`
      INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, source_ledger, source_record_id, created_at)
      VALUES (${jeId}, 1, '${crAccount}', 0, ${amount}, '${desc}', 'supplier', ${tx.id}, datetime('now'))
    `);
    
    if (!line1.success || !line2.success) {
      console.log(`  ❌ Tx ${tx.id}: Failed to create lines`);
      failCount++;
      continue;
    }
    
    // Update supplier transaction
    const update = exec(`UPDATE supplier_transactions SET journal_entry_id = ${jeId} WHERE id = ${tx.id}`);
    
    if (!update.success) {
      console.log(`  ❌ Tx ${tx.id}: Failed to update transaction`);
      failCount++;
      continue;
    }
    
    console.log(`  ✅ Tx ${tx.id}: Created JE ${jeId} (${txType} ${amount})`);
    successCount++;
  }
  
  console.log(`\nSupplier Batch Results: ✅ ${successCount} success, ❌ ${failCount} failed`);
}

// ============================================
// STEP 5: Final Status
// ============================================
console.log('\n📊 STEP 5: Final Status Check');
console.log('═══════════════════════════════════════════════════════════════');

const finalCash = query(`
  SELECT 
    COUNT(*) as total,
    COUNT(CASE WHEN journal_entry_id IS NULL THEN 1 END) as missing_gl
  FROM cash_transactions 
  WHERE company_id = 1 AND status = 'posted'
`)[0] || {};

const finalSupplier = query(`
  SELECT 
    COUNT(*) as total,
    COUNT(CASE WHEN journal_entry_id IS NULL THEN 1 END) as missing_gl
  FROM supplier_transactions 
  WHERE company_id = 1 AND status = 'posted'
`)[0] || {};

console.log(`Cash Transactions: ${finalCash.total || 0} total, ${finalCash.missing_gl || 0} missing GL`);
console.log(`Supplier Transactions: ${finalSupplier.total || 0} total, ${finalSupplier.missing_gl || 0} missing GL`);

const finalMissing = (parseInt(finalCash.missing_gl) || 0) + (parseInt(finalSupplier.missing_gl) || 0);

console.log('');
console.log('╔════════════════════════════════════════════════════════════════╗');
if (finalMissing === 0) {
  console.log('║  ✅ TASK A1.3 COMPLETE — All GL links created!               ║');
} else {
  console.log(`║  ⚠️  PARTIAL — ${finalMissing} transactions still need backfill        ║`);
  console.log('║  Run this script again to process remaining transactions       ║');
}
console.log('╚════════════════════════════════════════════════════════════════╝');
console.log('');
