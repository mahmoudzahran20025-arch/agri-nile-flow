#!/usr/bin/env node
/**
 * FINAL SUPPLIER BACKFILL — Simple & Robust
 * Completes remaining ~152 transactions
 */

const { execSync } = require('child_process');
const DB = 'agri-nile-flow-data-lake';

function exec(sql) {
  try {
    const cmd = `npx wrangler d1 execute ${DB} --remote --command "${sql.replace(/"/g, '\\"')}"`;
    execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
    return true;
  } catch (err) {
    return false;
  }
}

function query(sql) {
  try {
    const cmd = `npx wrangler d1 execute ${DB} --remote --json --command "${sql.replace(/"/g, '\\"')}"`;
    const result = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
    const parsed = JSON.parse(result);
    return parsed[0]?.results ?? [];
  } catch (err) {
    return [];
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║  FINAL SUPPLIER BACKFILL — Completing remaining ~152            ║');
console.log('╚════════════════════════════════════════════════════════════════╝');

// Get remaining count
const remaining = query(`SELECT COUNT(*) as n FROM supplier_transactions WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL AND amount > 0`)[0]?.n || 0;
console.log(`\nRemaining to process: ${remaining}\n`);

if (remaining === 0) {
  console.log('✅ All done!');
  process.exit(0);
}

// Process one by one with delay
let success = 0, failed = 0;
const txs = query(`SELECT id,created_at,amount,document_type FROM supplier_transactions WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL AND amount > 0 LIMIT 50`);

console.log(`Processing ${txs.length} transactions...\n`);

for (const tx of txs) {
  const amount = parseFloat(tx.amount);
  const date = (tx.created_at || '2026-04-27').split(' ')[0];
  const desc = `Supplier Tx ${tx.id}`;
  
  // 1. Create JE
  if (!exec(`INSERT INTO journal_entries (company_id,entry_date,description,ref_type,ref_id,is_posted) VALUES (1,'${date}','${desc}','supplier',${tx.id},1)`)) {
    console.log(`❌ Tx ${tx.id}: JE failed`);
    failed++;
    continue;
  }
  
  // 2. Get JE ID
  const jeRows = query(`SELECT id FROM journal_entries WHERE ref_type='supplier' AND ref_id=${tx.id} ORDER BY id DESC LIMIT 1`);
  if (!jeRows.length) {
    console.log(`❌ Tx ${tx.id}: No JE ID`);
    failed++;
    continue;
  }
  const jeId = jeRows[0].id;
  
  // 3. Create lines (DR: 4501 Purchases, CR: 2110 AP)
  const line1 = exec(`INSERT INTO journal_entry_lines (entry_id,company_id,account_code,debit,credit,description,source_ledger,source_record_id) VALUES (${jeId},1,'45010001',${amount},0,'${desc}','supplier',${tx.id})`);
  const line2 = exec(`INSERT INTO journal_entry_lines (entry_id,company_id,account_code,debit,credit,description,source_ledger,source_record_id) VALUES (${jeId},1,'2110',0,${amount},'${desc}','supplier',${tx.id})`);
  
  if (!line1 || !line2) {
    console.log(`❌ Tx ${tx.id}: Lines failed`);
    failed++;
    continue;
  }
  
  // 4. Link
  if (!exec(`UPDATE supplier_transactions SET journal_entry_id=${jeId} WHERE id=${tx.id}`)) {
    console.log(`❌ Tx ${tx.id}: Link failed`);
    failed++;
    continue;
  }
  
  console.log(`✅ Tx ${tx.id}: JE ${jeId} (${amount})`);
  success++;
  
  await sleep(300); // Delay to avoid rate limiting
}

console.log(`\n════════════════════════════════════════════════════════════════`);
console.log(`Batch done: ✅ ${success} | ❌ ${failed}`);
console.log(`Run again to continue: node final_backfill_simple.js`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
