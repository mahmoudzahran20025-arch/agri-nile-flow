#!/usr/bin/env node
/**
 * backfill_gl_links.js
 * Backfills GL links for cash and supplier transactions that were posted before GL integration
 * 
 * Usage: node backfill_gl_links.js
 */

const { execSync } = require('child_process');

const DB = 'agri-nile-flow-data-lake';

function query(sql) {
  try {
    const result = execSync(
      `npx wrangler d1 execute ${DB} --remote --json --command "${sql.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const parsed = JSON.parse(result);
    return parsed[0]?.results ?? [];
  } catch (err) {
    console.error(`Query failed: ${err.message}`);
    return [];
  }
}

function execute(sql) {
  try {
    const result = execSync(
      `npx wrangler d1 execute ${DB} --remote --command "${sql.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return { success: true, result };
  } catch (err) {
    console.error(`Execute failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║     Backfill GL Links — Cash & Supplier Transactions         ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

// ============================================
// STEP 1: Get count of transactions needing backfill
// ============================================
console.log('📊 Analyzing transactions...\n');

const cashStats = query(`
  SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN journal_entry_id IS NULL THEN 1 ELSE 0 END) as missing_gl,
    SUM(CASE WHEN journal_entry_id IS NULL THEN amount ELSE 0 END) as total_amount
  FROM cash_transactions 
  WHERE company_id = 1 AND status = 'posted'
`)[0] || {};

const supplierStats = query(`
  SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN journal_entry_id IS NULL THEN 1 ELSE 0 END) as missing_gl,
    SUM(CASE WHEN journal_entry_id IS NULL THEN amount ELSE 0 END) as total_amount
  FROM supplier_transactions 
  WHERE company_id = 1 AND status = 'posted'
`)[0] || {};

console.log('Cash Transactions:');
console.log(`  Total posted: ${cashStats.total || 0}`);
console.log(`  Missing GL: ${cashStats.missing_gl || 0}`);
console.log(`  Total amount: ${cashStats.total_amount || 0}`);

console.log('\nSupplier Transactions:');
console.log(`  Total posted: ${supplierStats.total || 0}`);
console.log(`  Missing GL: ${supplierStats.missing_gl || 0}`);
console.log(`  Total amount: ${supplierStats.total_amount || 0}`);

// ============================================
// STEP 2: Get posting rule accounts
// ============================================
console.log('\n📋 Loading posting rules...\n');

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
console.log(`  Cash: ${accounts.cash || 'NOT SET'}`);
console.log(`  Expense Default: ${accounts.expense_default || 'NOT SET'}`);
console.log(`  Revenue Default: ${accounts.revenue_default || 'NOT SET'}`);
console.log(`  Accounts Payable: ${accounts.accounts_payable || 'NOT SET'}`);

// ============================================
// STEP 3: Create GL entries for missing transactions
// ============================================
console.log('\n🔧 Creating GL entries...\n');

// Get list of cash transactions needing backfill
const cashTxs = query(`
  SELECT id, created_at, amount, debit, credit, description, center_code, field_id
  FROM cash_transactions 
  WHERE company_id = 1 AND status = 'posted' AND journal_entry_id IS NULL
  LIMIT 10
`);

console.log(`Found ${cashTxs.length} cash transactions to process (showing first 10)`);

let successCount = 0;
let failCount = 0;

for (const tx of cashTxs) {
  // Determine transaction type
  const isExpense = (tx.debit || 0) > 0;
  const isIncome = (tx.credit || 0) > 0;
  
  // Get appropriate accounts
  const cashAccount = accounts.cash || '14010101';
  const expenseAccount = accounts.expense_default || '51200034';
  const revenueAccount = accounts.revenue_default || '41010001';
  
  // Determine DR/CR accounts based on transaction type
  let drAccount, crAccount, drAmount, crAmount;
  
  if (isExpense) {
    // Expense: DR Expense, CR Cash
    drAccount = expenseAccount;
    crAccount = cashAccount;
    drAmount = tx.debit;
    crAmount = tx.debit;
  } else if (isIncome) {
    // Income: DR Cash, CR Revenue
    drAccount = cashAccount;
    crAccount = revenueAccount;
    drAmount = tx.credit;
    crAmount = tx.credit;
  } else {
    // Default to expense if unclear
    drAccount = expenseAccount;
    crAccount = cashAccount;
    drAmount = tx.amount || 0;
    crAmount = tx.amount || 0;
  }
  
  // Skip zero-amount transactions
  if (drAmount === 0 && crAmount === 0) {
    console.log(`  ⚠️  Skipping tx ${tx.id}: zero amount`);
    continue;
  }
  
  // Create journal entry header
  const jeResult = execute(`
    INSERT INTO journal_entries (company_id, entry_date, description, ref_type, ref_id, is_posted, created_at)
    VALUES (1, '${tx.created_at}', 'Backfill: ${(tx.description || 'Cash transaction').replace(/'/g, "''")}', 'cash_transaction', ${tx.id}, 1, datetime('now'))
  `);
  
  if (!jeResult.success) {
    console.log(`  ❌ Failed to create JE for tx ${tx.id}`);
    failCount++;
    continue;
  }
  
  // Get the new journal entry ID
  const jeId = query(`SELECT last_insert_rowid() as id`)[0]?.id;
  
  if (!jeId) {
    console.log(`  ❌ Could not get JE ID for tx ${tx.id}`);
    failCount++;
    continue;
  }
  
  // Create journal entry lines
  const line1Result = execute(`
    INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, source_ledger, source_record_id, created_at)
    VALUES (${jeId}, 1, '${drAccount}', ${drAmount}, 0, '${(tx.description || 'Cash transaction').replace(/'/g, "''")}', 'cash', ${tx.id}, datetime('now'))
  `);
  
  const line2Result = execute(`
    INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, source_ledger, source_record_id, created_at)
    VALUES (${jeId}, 1, '${crAccount}', 0, ${crAmount}, '${(tx.description || 'Cash transaction').replace(/'/g, "''")}', 'cash', ${tx.id}, datetime('now'))
  `);
  
  if (!line1Result.success || !line2Result.success) {
    console.log(`  ❌ Failed to create JE lines for tx ${tx.id}`);
    failCount++;
    continue;
  }
  
  // Update the cash transaction with the journal entry ID
  const updateResult = execute(`
    UPDATE cash_transactions SET journal_entry_id = ${jeId} WHERE id = ${tx.id}
  `);
  
  if (!updateResult.success) {
    console.log(`  ❌ Failed to update tx ${tx.id}`);
    failCount++;
    continue;
  }
  
  console.log(`  ✅ Created JE ${jeId} for tx ${tx.id}: DR ${drAccount} ${drAmount}, CR ${crAccount} ${crAmount}`);
  successCount++;
}

console.log(`\n✅ Successfully processed: ${successCount}`);
console.log(`❌ Failed: ${failCount}`);

// ============================================
// Summary
// ============================================
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('BACKFILL SUMMARY');
console.log('═══════════════════════════════════════════════════════════════');

const newCashStats = query(`
  SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN journal_entry_id IS NULL THEN 1 ELSE 0 END) as missing_gl
  FROM cash_transactions 
  WHERE company_id = 1 AND status = 'posted'
`)[0] || {};

console.log(`\nCash Transactions GL Links:`);
console.log(`  Before: ${cashStats.missing_gl || 0} missing`);
console.log(`  After: ${newCashStats.missing_gl || 0} missing`);
console.log(`  Progress: ${(cashStats.missing_gl || 0) - (newCashStats.missing_gl || 0)} linked`);

console.log('\n⚠️  Note: Run this script multiple times to process all transactions');
console.log('   Each run processes up to 10 transactions');
console.log('');
