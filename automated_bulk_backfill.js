#!/usr/bin/env node
/**
 * AUTOMATED BULK BACKFILL SCRIPT
 * Task A1.3: Backfill GL links for all remaining transactions
 * 
 * Usage: node automated_bulk_backfill.js
 * Estimated time: ~10 minutes for 342 transactions (68 cash + 274 supplier)
 */

const { execSync } = require('child_process');

const DB = 'agri-nile-flow-data-lake';
const BATCH_SIZE = 10; // Process 10 at a time to avoid overload
const DELAY_MS = 500; // Delay between batches to avoid rate limiting

// Progress tracking
let stats = {
  cash: { processed: 0, success: 0, failed: 0, total: 0 },
  supplier: { processed: 0, success: 0, failed: 0, total: 0 }
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function execSQL(sql) {
  try {
    const cmd = `npx wrangler d1 execute ${DB} --remote --command "${sql.replace(/"/g, '\\"')}"`;
    const result = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
    return { success: true, result };
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
    return { success: false, error: err.message.substring(0, 150), data: [] };
  }
}

function printProgress() {
  console.clear();
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  AUTOMATED BULK BACKFILL — PROGRESS                           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('CASH TRANSACTIONS:');
  console.log(`  Total: ${stats.cash.total} | Processed: ${stats.cash.processed} | Success: ${stats.cash.success} | Failed: ${stats.cash.failed}`);
  console.log(`  Progress: ${stats.cash.total > 0 ? Math.round((stats.cash.processed / stats.cash.total) * 100) : 0}%`);
  console.log('');
  console.log('SUPPLIER TRANSACTIONS:');
  console.log(`  Total: ${stats.supplier.total} | Processed: ${stats.supplier.processed} | Success: ${stats.supplier.success} | Failed: ${stats.supplier.failed}`);
  console.log(`  Progress: ${stats.supplier.total > 0 ? Math.round((stats.supplier.processed / stats.supplier.total) * 100) : 0}%`);
  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
}

async function processCashTransaction(tx, accounts) {
  const credit = parseFloat(tx.credit) || 0;
  const debit = parseFloat(tx.debit) || 0;
  
  if (credit === 0 && debit === 0) {
    return { success: false, error: 'Zero amount' };
  }
  
  let drAccount, crAccount, drAmt, txType;
  
  if (credit > 0) {
    drAccount = accounts.cash || '14010101';
    crAccount = accounts.revenue_default || '41010001';
    drAmt = credit;
    txType = 'Receipt';
  } else {
    drAccount = accounts.expense_default || '51200034';
    crAccount = accounts.cash || '14010101';
    drAmt = debit;
    txType = 'Payment';
  }
  
  const date = (tx.created_at || '2026-04-27').split(' ')[0];
  const ref = tx.document_type || 'cash';
  const desc = `Cash ${txType} Tx ${tx.id}`;
  
  // Step 1: Create JE header
  const jeResult = execSQL(`INSERT INTO journal_entries (company_id,entry_date,description,ref_type,ref_id,is_posted) VALUES (1,'${date}','${desc}','${ref}',${tx.id},1)`);
  
  if (!jeResult.success) {
    return { success: false, error: `JE create failed: ${jeResult.error}` };
  }
  
  // Step 2: Get JE ID
  const jeQuery = queryJSON(`SELECT id FROM journal_entries WHERE ref_type='${ref}' AND ref_id=${tx.id} ORDER BY id DESC LIMIT 1`);
  if (!jeQuery.success || jeQuery.data.length === 0) {
    return { success: false, error: 'Could not find JE ID' };
  }
  
  const jeId = jeQuery.data[0].id;
  
  // Step 3: Create JE lines
  const line1 = execSQL(`INSERT INTO journal_entry_lines (entry_id,company_id,account_code,debit,credit,description,source_ledger,source_record_id) VALUES (${jeId},1,'${drAccount}',${drAmt},0,'${desc}','cash',${tx.id})`);
  const line2 = execSQL(`INSERT INTO journal_entry_lines (entry_id,company_id,account_code,debit,credit,description,source_ledger,source_record_id) VALUES (${jeId},1,'${crAccount}',0,${drAmt},'${desc}','cash',${tx.id})`);
  
  if (!line1.success || !line2.success) {
    return { success: false, error: `Lines failed: ${line1.error || line2.error}` };
  }
  
  // Step 4: Link transaction
  const update = execSQL(`UPDATE cash_transactions SET journal_entry_id=${jeId} WHERE id=${tx.id}`);
  
  if (!update.success) {
    return { success: false, error: `Update failed: ${update.error}` };
  }
  
  return { success: true, jeId };
}

async function processSupplierTransaction(tx, accounts) {
  const amount = parseFloat(tx.amount) || 0;
  
  if (amount === 0) {
    return { success: false, error: 'Zero amount' };
  }
  
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
  
  // Step 1: Create JE header
  const jeResult = execSQL(`INSERT INTO journal_entries (company_id,entry_date,description,ref_type,ref_id,is_posted) VALUES (1,'${date}','${desc}','${ref}',${tx.id},1)`);
  
  if (!jeResult.success) {
    return { success: false, error: `JE create failed: ${jeResult.error}` };
  }
  
  // Step 2: Get JE ID
  const jeQuery = queryJSON(`SELECT id FROM journal_entries WHERE ref_type='${ref}' AND ref_id=${tx.id} ORDER BY id DESC LIMIT 1`);
  if (!jeQuery.success || jeQuery.data.length === 0) {
    return { success: false, error: 'Could not find JE ID' };
  }
  
  const jeId = jeQuery.data[0].id;
  
  // Step 3: Create JE lines
  const line1 = execSQL(`INSERT INTO journal_entry_lines (entry_id,company_id,account_code,debit,credit,description,source_ledger,source_record_id) VALUES (${jeId},1,'${drAccount}',${amount},0,'${desc}','supplier',${tx.id})`);
  const line2 = execSQL(`INSERT INTO journal_entry_lines (entry_id,company_id,account_code,debit,credit,description,source_ledger,source_record_id) VALUES (${jeId},1,'${crAccount}',0,${amount},'${desc}','supplier',${tx.id})`);
  
  if (!line1.success || !line2.success) {
    return { success: false, error: `Lines failed: ${line1.error || line2.error}` };
  }
  
  // Step 4: Link transaction
  const update = execSQL(`UPDATE supplier_transactions SET journal_entry_id=${jeId} WHERE id=${tx.id}`);
  
  if (!update.success) {
    return { success: false, error: `Update failed: ${update.error}` };
  }
  
  return { success: true, jeId };
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  AUTOMATED BULK BACKFILL — TASK A1.3                          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`Database: ${DB}`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('');
  
  // Step 1: Load control accounts
  console.log('Loading control accounts...');
  const controlAccounts = queryJSON(`SELECT mapping_key,account_code FROM posting_rules WHERE company_id=1 AND rule_type='control' AND is_active=1`);
  
  const accounts = {};
  if (controlAccounts.success) {
    controlAccounts.data.forEach(acc => {
      accounts[acc.mapping_key] = acc.account_code;
    });
  }
  
  console.log(`  Cash: ${accounts.cash || '14010101'}`);
  console.log(`  Revenue: ${accounts.revenue_default || '41010001'}`);
  console.log(`  Expense: ${accounts.expense_default || '51200034'}`);
  console.log(`  AP: ${accounts.accounts_payable || '2110'}`);
  console.log('');
  
  // Step 2: Get totals
  console.log('Counting transactions to process...');
  const cashCount = queryJSON(`SELECT COUNT(*) as n FROM cash_transactions WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL`);
  const supplierCount = queryJSON(`SELECT COUNT(*) as n FROM supplier_transactions WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL`);
  
  stats.cash.total = cashCount.success ? (cashCount.data[0]?.n || 0) : 0;
  stats.supplier.total = supplierCount.success ? (supplierCount.data[0]?.n || 0) : 0;
  
  console.log(`  Cash to process: ${stats.cash.total}`);
  console.log(`  Supplier to process: ${stats.supplier.total}`);
  console.log(`  Total: ${stats.cash.total + stats.supplier.total}`);
  console.log('');
  
  if (stats.cash.total === 0 && stats.supplier.total === 0) {
    console.log('✅ All transactions already have GL links!');
    process.exit(0);
  }
  
  console.log('Starting backfill in 3 seconds... (Press Ctrl+C to cancel)');
  await sleep(3000);
  
  // Step 3: Process cash transactions
  while (stats.cash.processed < stats.cash.total) {
    const batch = queryJSON(`SELECT id,created_at,amount,debit,credit,document_type FROM cash_transactions WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL LIMIT ${BATCH_SIZE}`);
    
    if (!batch.success || batch.data.length === 0) {
      break;
    }
    
    for (const tx of batch.data) {
      const result = await processCashTransaction(tx, accounts);
      
      if (result.success) {
        stats.cash.success++;
      } else {
        stats.cash.failed++;
        console.log(`  ⚠️ Cash Tx ${tx.id}: ${result.error}`);
      }
      
      stats.cash.processed++;
      printProgress();
    }
    
    await sleep(DELAY_MS);
  }
  
  // Step 4: Process supplier transactions
  while (stats.supplier.processed < stats.supplier.total) {
    const batch = queryJSON(`SELECT id,created_at,amount,transaction_type,document_type,supplier_id FROM supplier_transactions WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL LIMIT ${BATCH_SIZE}`);
    
    if (!batch.success || batch.data.length === 0) {
      break;
    }
    
    for (const tx of batch.data) {
      const result = await processSupplierTransaction(tx, accounts);
      
      if (result.success) {
        stats.supplier.success++;
      } else {
        stats.supplier.failed++;
        console.log(`  ⚠️ Supplier Tx ${tx.id}: ${result.error}`);
      }
      
      stats.supplier.processed++;
      printProgress();
    }
    
    await sleep(DELAY_MS);
  }
  
  // Final summary
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  BACKFILL COMPLETE                                             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`Finished: ${new Date().toISOString()}`);
  console.log('');
  console.log('CASH:');
  console.log(`  Processed: ${stats.cash.processed}/${stats.cash.total}`);
  console.log(`  Success: ${stats.cash.success}`);
  console.log(`  Failed: ${stats.cash.failed}`);
  console.log('');
  console.log('SUPPLIER:');
  console.log(`  Processed: ${stats.supplier.processed}/${stats.supplier.total}`);
  console.log(`  Success: ${stats.supplier.success}`);
  console.log(`  Failed: ${stats.supplier.failed}`);
  console.log('');
  
  const totalSuccess = stats.cash.success + stats.supplier.success;
  const totalFailed = stats.cash.failed + stats.supplier.failed;
  const totalProcessed = stats.cash.processed + stats.supplier.processed;
  
  console.log(`TOTAL: ${totalSuccess} success, ${totalFailed} failed out of ${totalProcessed}`);
  console.log('');
  
  if (totalFailed > 0) {
    console.log('⚠️ Some transactions failed. Review errors above and re-run.');
    process.exit(1);
  } else {
    console.log('✅ All transactions successfully backfilled!');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
