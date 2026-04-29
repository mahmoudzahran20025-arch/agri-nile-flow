#!/usr/bin/env node
/**
 * SUPPLIER BACKFILL ONLY
 * Process remaining 274 supplier transactions
 */

const { execSync } = require('child_process');
const DB = 'agri-nile-flow-data-lake';
const BATCH_SIZE = 10;
const DELAY_MS = 500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function execSQL(sql) {
  try {
    const cmd = `npx wrangler d1 execute ${DB} --remote --command "${sql.replace(/"/g, '\\"')}"`;
    execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message.substring(0, 150) };
  }
}

function queryJSON(sql) {
  try {
    const cmd = `npx wrangler d1 execute ${DB} --remote --json --command "${sql.replace(/"/g, '\\"')}"`;
    const result = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
    const parsed = JSON.parse(result);
    return { success: true, data: parsed[0]?.results ?? [] };
  } catch (err) {
    return { success: false, data: [] };
  }
}

async function processSupplierTx(tx, accounts) {
  const amount = parseFloat(tx.amount) || 0;
  if (amount === 0) return { success: false, error: 'Zero amount' };
  
  const txTypeLower = (tx.transaction_type || '').toLowerCase();
  let drAccount, crAccount, txType;
  
  if (txTypeLower.includes('invoice') || txTypeLower.includes('فاتورة')) {
    drAccount = accounts.purchases || '45010001';
    crAccount = accounts.accounts_payable || '2110';
    txType = 'Invoice';
  } else if (txTypeLower.includes('payment') || txTypeLower.includes('دفع')) {
    drAccount = accounts.accounts_payable || '2110';
    crAccount = accounts.cash || '14010101';
    txType = 'Payment';
  } else {
    drAccount = accounts.expense_default || '51200034';
    crAccount = accounts.accounts_payable || '2110';
    txType = 'Transaction';
  }
  
  const date = (tx.created_at || '2026-04-27').split(' ')[0];
  const ref = tx.document_type || 'supplier';
  const desc = `Supplier ${txType} Tx ${tx.id}`;
  
  // Create JE
  const jeResult = execSQL(`INSERT INTO journal_entries (company_id,entry_date,description,ref_type,ref_id,is_posted) VALUES (1,'${date}','${desc}','${ref}',${tx.id},1)`);
  if (!jeResult.success) return { success: false, error: 'JE create failed' };
  
  // Get JE ID
  const jeQuery = queryJSON(`SELECT id FROM journal_entries WHERE ref_type='${ref}' AND ref_id=${tx.id} ORDER BY id DESC LIMIT 1`);
  if (!jeQuery.success || jeQuery.data.length === 0) return { success: false, error: 'No JE ID' };
  const jeId = jeQuery.data[0].id;
  
  // Create lines
  const line1 = execSQL(`INSERT INTO journal_entry_lines (entry_id,company_id,account_code,debit,credit,description,source_ledger,source_record_id) VALUES (${jeId},1,'${drAccount}',${amount},0,'${desc}','supplier',${tx.id})`);
  const line2 = execSQL(`INSERT INTO journal_entry_lines (entry_id,company_id,account_code,debit,credit,description,source_ledger,source_record_id) VALUES (${jeId},1,'${crAccount}',0,${amount},'${desc}','supplier',${tx.id})`);
  if (!line1.success || !line2.success) return { success: false, error: 'Lines failed' };
  
  // Link
  const update = execSQL(`UPDATE supplier_transactions SET journal_entry_id=${jeId} WHERE id=${tx.id}`);
  if (!update.success) return { success: false, error: 'Update failed' };
  
  return { success: true, jeId };
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  SUPPLIER BACKFILL — 274 TRANSACTIONS                           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  
  // Load accounts
  const controlAccounts = queryJSON(`SELECT mapping_key,account_code FROM posting_rules WHERE company_id=1 AND rule_type='control' AND is_active=1`);
  const accounts = {};
  if (controlAccounts.success) {
    controlAccounts.data.forEach(acc => accounts[acc.mapping_key] = acc.account_code);
  }
  console.log(`Accounts: Cash=${accounts.cash||'14010101'}, AP=${accounts.accounts_payable||'2110'}`);
  
  // Get total
  const count = queryJSON(`SELECT COUNT(*) as n FROM supplier_transactions WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL`);
  const total = count.success ? (count.data[0]?.n || 0) : 0;
  console.log(`\nSupplier transactions to process: ${total}\n`);
  
  if (total === 0) {
    console.log('✅ No supplier transactions need backfill!');
    return;
  }
  
  let processed = 0, success = 0, failed = 0;
  
  while (processed < total) {
    const batch = queryJSON(`SELECT id,created_at,amount,transaction_type,document_type,supplier_id FROM supplier_transactions WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL LIMIT ${BATCH_SIZE}`);
    
    if (!batch.success || batch.data.length === 0) break;
    
    for (const tx of batch.data) {
      const result = await processSupplierTx(tx, accounts);
      if (result.success) {
        success++;
        process.stdout.write(`✅`);
      } else {
        failed++;
        process.stdout.write(`❌`);
      }
      processed++;
    }
    
    console.log(` ${processed}/${total}`);
    await sleep(DELAY_MS);
  }
  
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  SUPPLIER BACKFILL COMPLETE                                     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`Processed: ${processed}/${total}`);
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed}`);
  
  if (failed > 0) {
    console.log('\n⚠️ Some failed. Re-run to retry.');
    process.exit(1);
  } else {
    console.log('\n✅ All supplier transactions backfilled!');
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
