#!/usr/bin/env node
/**
 * Final working backfill for cash transactions
 * Uses only existing columns: id, created_at, amount, debit, credit, document_type
 */

const { execSync } = require('child_process');
const DB = 'agri-nile-flow-data-lake';

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    console.error(`Cmd failed: ${err.message.substring(0, 100)}`);
    return null;
  }
}

function query(sql) {
  const cmd = `npx wrangler d1 execute ${DB} --remote --json --command "${sql}"`;
  const result = run(cmd);
  if (!result) return [];
  try {
    const parsed = JSON.parse(result);
    return parsed[0]?.results ?? [];
  } catch (e) {
    return [];
  }
}

function exec(sql) {
  const cmd = `npx wrangler d1 execute ${DB} --remote --command "${sql}"`;
  return run(cmd) !== null;
}

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  Cash GL Backfill - Final Version                         ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Get count
const countRes = query("SELECT COUNT(*) as n FROM cash_transactions WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL");
const toProcess = countRes[0]?.n || 0;
console.log(`Target: ${toProcess} cash transactions without GL entries\n`);

if (toProcess === 0) {
  console.log('✅ All transactions already have GL links!');
  process.exit(0);
}

// Process in batches
const batchSize = 5;
const txs = query(`SELECT id,created_at,amount,debit,credit,document_type FROM cash_transactions WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL LIMIT ${batchSize}`);

console.log(`Processing batch of ${txs.length} transactions...\n`);

let success = 0;
let failed = 0;

for (const tx of txs) {
  const credit = parseFloat(tx.credit) || 0;
  const debit = parseFloat(tx.debit) || 0;
  
  let drAccount, crAccount, amount;
  let txType;
  
  if (credit > 0) {
    // Income/Receipt
    drAccount = '14010101'; // Cash
    crAccount = '41010001'; // Revenue
    amount = credit;
    txType = 'Receipt';
  } else if (debit > 0) {
    // Expense/Payment
    drAccount = '51200034'; // Expense
    crAccount = '14010101'; // Cash
    amount = debit;
    txType = 'Payment';
  } else {
    console.log(`Tx ${tx.id}: Skip (zero amount)`);
    continue;
  }
  
  console.log(`Tx ${tx.id}: ${txType} ${amount.toLocaleString()} (DR ${drAccount}, CR ${crAccount})`);
  
  // Create journal entry
  const date = (tx.created_at || '2026-04-27').split(' ')[0];
  const ref = tx.document_type || 'cash';
  
  const jeOk = exec(`INSERT INTO journal_entries (company_id,entry_date,description,ref_type,ref_id,is_posted,created_at) VALUES (1,'${date}','Backfill ${txType} ${tx.id}','${ref}',${tx.id},1,datetime('now'))`);
  
  if (!jeOk) {
    console.log(`  ❌ JE creation failed`);
    failed++;
    continue;
  }
  
  // Get JE ID
  const jeIdRes = query('SELECT last_insert_rowid() as id');
  const jeId = jeIdRes[0]?.id;
  
  if (!jeId) {
    console.log(`  ❌ Get JE ID failed`);
    failed++;
    continue;
  }
  
  // Create lines
  const l1 = exec(`INSERT INTO journal_entry_lines (entry_id,company_id,account_code,debit,credit,description,source_ledger,source_record_id,created_at) VALUES (${jeId},1,'${drAccount}',${amount},0,'${txType} ${tx.id}','cash',${tx.id},datetime('now'))`);
  const l2 = exec(`INSERT INTO journal_entry_lines (entry_id,company_id,account_code,debit,credit,description,source_ledger,source_record_id,created_at) VALUES (${jeId},1,'${crAccount}',0,${amount},'${txType} ${tx.id}','cash',${tx.id},datetime('now'))`);
  
  if (!l1 || !l2) {
    console.log(`  ❌ Lines creation failed`);
    failed++;
    continue;
  }
  
  // Update tx
  const upd = exec(`UPDATE cash_transactions SET journal_entry_id=${jeId} WHERE id=${tx.id}`);
  
  if (!upd) {
    console.log(`  ❌ Update failed`);
    failed++;
    continue;
  }
  
  console.log(`  ✅ Linked to JE ${jeId}`);
  success++;
}

console.log(`\n═══════════════════════════════════════════════════════════════`);
console.log(`Results: ✅ ${success} success | ❌ ${failed} failed`);

// Check remaining
const remaining = query("SELECT COUNT(*) as n FROM cash_transactions WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL")[0]?.n || 0;
console.log(`Remaining to process: ${remaining}`);

if (remaining > 0) {
  console.log(`\n⚠️  Run again: node backfill_cash_final.js`);
}
console.log('');
