#!/usr/bin/env node
/**
 * Simple backfill for cash transactions
 */

const { execSync } = require('child_process');
const DB = 'agri-nile-flow-data-lake';

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    console.error(`Error: ${err.message}`);
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
  const result = run(cmd);
  return result !== null;
}

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║  Simple Cash Transaction GL Backfill                      ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Get count
const countResult = query("SELECT COUNT(*) as n FROM cash_transactions WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL");
const count = countResult[0]?.n || 0;
console.log(`Transactions to process: ${count}\n`);

if (count === 0) {
  console.log('✅ Nothing to do!');
  process.exit(0);
}

// Get first 5 transactions
const txs = query("SELECT id, created_at, amount, debit, credit, description FROM cash_transactions WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL LIMIT 5");

console.log(`Processing ${txs.length} transactions...\n`);

let success = 0;
let failed = 0;

for (const tx of txs) {
  console.log(`Processing tx ${tx.id}: amount=${tx.amount}, debit=${tx.debit}, credit=${tx.credit}`);
  
  // Determine accounts
  const credit = parseFloat(tx.credit) || 0;
  const debit = parseFloat(tx.debit) || 0;
  const amount = parseFloat(tx.amount) || 0;
  
  let drAccount, crAccount, drAmt;
  
  if (credit > 0) {
    // Income - DR Cash, CR Revenue
    drAccount = '14010101';
    crAccount = '41010001';
    drAmt = credit;
    console.log(`  Type: Income (DR Cash ${drAmt}, CR Revenue ${drAmt})`);
  } else if (debit > 0) {
    // Expense - DR Expense, CR Cash
    drAccount = '51200034';
    crAccount = '14010101';
    drAmt = debit;
    console.log(`  Type: Expense (DR Expense ${drAmt}, CR Cash ${drAmt})`);
  } else if (amount > 0) {
    // Default to expense
    drAccount = '51200034';
    crAccount = '14010101';
    drAmt = amount;
    console.log(`  Type: Default Expense (DR Expense ${drAmt}, CR Cash ${drAmt})`);
  } else {
    console.log(`  ⚠️ Skip: zero amount`);
    continue;
  }
  
  // Create journal entry
  const desc = `Backfill tx ${tx.id}`;
  const date = tx.created_at ? tx.created_at.split(' ')[0] : '2026-04-27';
  
  const jeOk = exec(`INSERT INTO journal_entries (company_id,entry_date,description,ref_type,ref_id,is_posted,created_at) VALUES (1,'${date}','${desc}','cash',${tx.id},1,datetime('now'))`);
  
  if (!jeOk) {
    console.log(`  ❌ Failed to create JE`);
    failed++;
    continue;
  }
  
  // Get JE ID
  const jeIdResult = query('SELECT last_insert_rowid() as id');
  const jeId = jeIdResult[0]?.id;
  
  if (!jeId) {
    console.log(`  ❌ Failed to get JE ID`);
    failed++;
    continue;
  }
  
  // Create lines
  const line1Ok = exec(`INSERT INTO journal_entry_lines (entry_id,company_id,account_code,debit,credit,description,source_ledger,source_record_id,created_at) VALUES (${jeId},1,'${drAccount}',${drAmt},0,'${desc}','cash',${tx.id},datetime('now'))`);
  const line2Ok = exec(`INSERT INTO journal_entry_lines (entry_id,company_id,account_code,debit,credit,description,source_ledger,source_record_id,created_at) VALUES (${jeId},1,'${crAccount}',0,${drAmt},'${desc}','cash',${tx.id},datetime('now'))`);
  
  if (!line1Ok || !line2Ok) {
    console.log(`  ❌ Failed to create lines`);
    failed++;
    continue;
  }
  
  // Update tx
  const updateOk = exec(`UPDATE cash_transactions SET journal_entry_id=${jeId} WHERE id=${tx.id}`);
  
  if (!updateOk) {
    console.log(`  ❌ Failed to update tx`);
    failed++;
    continue;
  }
  
  console.log(`  ✅ Linked to JE ${jeId}`);
  success++;
}

console.log(`\n✅ Success: ${success}`);
console.log(`❌ Failed: ${failed}`);

// Check remaining
const remaining = query("SELECT COUNT(*) as n FROM cash_transactions WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL")[0]?.n || 0;
console.log(`\nRemaining: ${remaining}`);
console.log('Run again to process more.\n');
