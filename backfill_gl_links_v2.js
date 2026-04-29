#!/usr/bin/env node
/**
 * backfill_gl_links_v2.js
 * Improved version with better error handling and debug output
 */

const { execSync } = require('child_process');

const DB = 'agri-nile-flow-data-lake';

function query(sql, description) {
  console.log(`\n🔍 ${description || 'Executing query'}...`);
  console.log(`   SQL: ${sql.substring(0, 80)}...`);
  
  try {
    const cmd = `npx wrangler d1 execute ${DB} --remote --json --command "${sql.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
    const result = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    
    console.log(`   Raw result: ${result.substring(0, 200)}...`);
    
    const parsed = JSON.parse(result);
    const rows = parsed[0]?.results ?? [];
    
    console.log(`   ✅ Retrieved ${rows.length} rows`);
    return rows;
  } catch (err) {
    console.error(`   ❌ Query failed: ${err.message}`);
    if (err.stderr) console.error(`   stderr: ${err.stderr}`);
    return [];
  }
}

function execute(sql, description) {
  console.log(`\n⚡ ${description || 'Executing'}...`);
  
  try {
    const cmd = `npx wrangler d1 execute ${DB} --remote --command "${sql.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
    const result = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    
    console.log(`   ✅ Success`);
    return { success: true, result };
  } catch (err) {
    console.error(`   ❌ Failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║     Backfill GL Links v2 — Debug & Fix                       ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

// ============================================
// STEP 1: Verify data exists
// ============================================
console.log('📊 STEP 1: Verifying data...\n');

// Check all cash transactions
const allCash = query(
  'SELECT COUNT(*) as n FROM cash_transactions WHERE company_id = 1',
  'Count all cash transactions'
);
console.log(`   Total cash transactions: ${allCash[0]?.n || 0}`);

// Check posted cash transactions
const postedCash = query(
  "SELECT COUNT(*) as n FROM cash_transactions WHERE company_id = 1 AND status = 'posted'",
  'Count posted cash transactions'
);
console.log(`   Posted cash transactions: ${postedCash[0]?.n || 0}`);

// Check cash transactions without JE
const missingJe = query(
  'SELECT COUNT(*) as n FROM cash_transactions WHERE company_id = 1 AND journal_entry_id IS NULL',
  'Count cash transactions without JE'
);
console.log(`   Cash without JE: ${missingJe[0]?.n || 0}`);

// Check posted cash without JE (this is what we need)
const targetCount = query(
  "SELECT COUNT(*) as n FROM cash_transactions WHERE company_id = 1 AND status = 'posted' AND journal_entry_id IS NULL",
  'Count target transactions (posted, no JE)'
);
const targetNum = targetCount[0]?.n || 0;
console.log(`\n🎯 Target transactions to process: ${targetNum}`);

if (targetNum === 0) {
  console.log('\n✅ No transactions need backfill!');
  process.exit(0);
}

// ============================================
// STEP 2: Get sample transactions
// ============================================
console.log('\n📋 STEP 2: Getting sample transactions...\n');

const sampleTxs = query(
  'SELECT id, created_at, amount, debit, credit, status, journal_entry_id FROM cash_transactions WHERE company_id = 1 AND status = \'posted\' AND journal_entry_id IS NULL LIMIT 3',
  'Get sample transactions'
);

console.log('   Sample data:');
sampleTxs.forEach(tx => {
  console.log(`     ID: ${tx.id}, Amount: ${tx.amount}, Debit: ${tx.debit}, Credit: ${tx.credit}, Status: ${tx.status}, JE: ${tx.journal_entry_id}`);
});

// ============================================
// STEP 3: Get control accounts
// ============================================
console.log('\n📋 STEP 3: Loading control accounts...\n');

const controlAccounts = query(
  'SELECT mapping_key, account_code FROM posting_rules WHERE company_id = 1 AND rule_type = \'control\' AND is_active = 1',
  'Get control accounts'
);

const accounts = {};
controlAccounts.forEach(acc => {
  accounts[acc.mapping_key] = acc.account_code;
});

console.log('   Control Accounts:');
console.log(`     Cash: ${accounts.cash || 'NOT SET'}`);
console.log(`     Expense: ${accounts.expense_default || 'NOT SET'}`);
console.log(`     Revenue: ${accounts.revenue_default || 'NOT SET'}`);

// ============================================
// STEP 4: Process transactions
// ============================================
console.log('\n🔧 STEP 4: Processing transactions...\n');

// Get all transactions to process
const cashTxs = query(
  'SELECT id, created_at, amount, debit, credit, description, center_code, field_id FROM cash_transactions WHERE company_id = 1 AND status = \'posted\' AND journal_entry_id IS NULL LIMIT 10',
  'Get transactions to process'
);

console.log(`Found ${cashTxs.length} transactions to process`);

let successCount = 0;
let failCount = 0;
let skipCount = 0;

for (const tx of cashTxs) {
  console.log(`\n--- Processing tx ${tx.id} ---`);
  console.log(`   Amount: ${tx.amount}, Debit: ${tx.debit}, Credit: ${tx.credit}`);
  
  // Determine transaction type
  const debitVal = parseFloat(tx.debit) || 0;
  const creditVal = parseFloat(tx.credit) || 0;
  const amountVal = parseFloat(tx.amount) || 0;
  
  const isExpense = debitVal > 0;
  const isIncome = creditVal > 0;
  
  // Get accounts
  const cashAccount = accounts.cash || '14010101';
  const expenseAccount = accounts.expense_default || '51200034';
  const revenueAccount = accounts.revenue_default || '41010001';
  
  let drAccount, crAccount, drAmount, crAmount;
  
  if (isExpense) {
    drAccount = expenseAccount;
    crAccount = cashAccount;
    drAmount = debitVal;
    crAmount = debitVal;
    console.log(`   Type: Expense (DR ${drAccount}, CR ${crAccount})`);
  } else if (isIncome) {
    drAccount = cashAccount;
    crAccount = revenueAccount;
    drAmount = creditVal;
    crAmount = creditVal;
    console.log(`   Type: Income (DR ${drAccount}, CR ${crAccount})`);
  } else {
    // Use amount field
    if (amountVal > 0) {
      drAccount = expenseAccount;
      crAccount = cashAccount;
      drAmount = amountVal;
      crAmount = amountVal;
      console.log(`   Type: Default Expense (DR ${drAccount}, CR ${crAccount})`);
    } else {
      console.log(`   ⚠️ Skipping: zero amount`);
      skipCount++;
      continue;
    }
  }
  
  // Create journal entry
  const desc = (tx.description || 'Cash transaction').replace(/'/g, "''");
  const date = tx.created_at || new Date().toISOString().split('T')[0];
  
  const jeResult = execute(
    `INSERT INTO journal_entries (company_id, entry_date, description, ref_type, ref_id, is_posted, created_at) VALUES (1, '${date}', 'Backfill: ${desc}', 'cash_transaction', ${tx.id}, 1, datetime('now'))`,
    `Create JE for tx ${tx.id}`
  );
  
  if (!jeResult.success) {
    console.log(`   ❌ Failed to create JE`);
    failCount++;
    continue;
  }
  
  // Get JE ID
  const jeIdResult = query('SELECT last_insert_rowid() as id', 'Get last insert ID');
  const jeId = jeIdResult[0]?.id;
  
  if (!jeId) {
    console.log(`   ❌ Could not get JE ID`);
    failCount++;
    continue;
  }
  
  console.log(`   Created JE ${jeId}`);
  
  // Create JE lines
  const line1Result = execute(
    `INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, source_ledger, source_record_id, created_at) VALUES (${jeId}, 1, '${drAccount}', ${drAmount}, 0, '${desc}', 'cash', ${tx.id}, datetime('now'))`,
    `Create DR line for tx ${tx.id}`
  );
  
  const line2Result = execute(
    `INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, source_ledger, source_record_id, created_at) VALUES (${jeId}, 1, '${crAccount}', 0, ${crAmount}, '${desc}', 'cash', ${tx.id}, datetime('now'))`,
    `Create CR line for tx ${tx.id}`
  );
  
  if (!line1Result.success || !line2Result.success) {
    console.log(`   ❌ Failed to create JE lines`);
    failCount++;
    continue;
  }
  
  // Update cash transaction
  const updateResult = execute(
    `UPDATE cash_transactions SET journal_entry_id = ${jeId} WHERE id = ${tx.id}`,
    `Link tx ${tx.id} to JE ${jeId}`
  );
  
  if (!updateResult.success) {
    console.log(`   ❌ Failed to update transaction`);
    failCount++;
    continue;
  }
  
  console.log(`   ✅ Successfully linked tx ${tx.id} to JE ${jeId}`);
  successCount++;
}

// ============================================
// Summary
// ============================================
console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║                        SUMMARY                                 ║');
console.log('╚════════════════════════════════════════════════════════════════╝');
console.log(`\nProcessed: ${cashTxs.length} transactions`);
console.log(`✅ Success: ${successCount}`);
console.log(`⚠️  Skipped: ${skipCount}`);
console.log(`❌ Failed: ${failCount}`);

// Check new status
const newCount = query(
  "SELECT COUNT(*) as n FROM cash_transactions WHERE company_id = 1 AND status = 'posted' AND journal_entry_id IS NULL",
  'Check remaining transactions'
);

console.log(`\n🎯 Remaining transactions to process: ${newCount[0]?.n || 0}`);
console.log('\n⚠️  Run this script again to process more transactions');
console.log('');
