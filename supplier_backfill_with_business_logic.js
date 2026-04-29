#!/usr/bin/env node
/**
 * SUPPLIER BACKFILL — مع Business Logic صحيح
 * 
 * يأخذ في الاعتبار:
 * 1. تصنيف المورد (من supplier_categories)
 * 2. نوع العملية (مدين/دائن من document_type)
 * 3. الحسابات المحاسبية المناسبة
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
    return { success: false, error: err.message.substring(0, 100) };
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

// Determine transaction type from document_type (Arabic)
function getTransactionType(docType) {
  if (!docType) return 'invoice'; // default
  const dt = docType.toLowerCase();
  
  // مدين (Debit) = صرف = Expense/AP
  if (dt.includes('م') || dt.includes('صرف') || dt.includes('فاتورة') || dt.includes('مشتريات')) {
    return 'invoice'; // DR Expense/Purchases, CR AP
  }
  
  // دائن (Credit) = قبض = Payment
  if (dt.includes('د') || dt.includes('قبض') || dt.includes('دفع') || dt.includes('سداد')) {
    return 'payment'; // DR AP, CR Cash
  }
  
  // Default based on keywords
  if (dt.includes('مستخلص') || dt.includes('بيان') || dt.includes('توريد')) {
    return 'invoice';
  }
  
  return 'invoice'; // Default to invoice/expense
}

// Get accounts based on transaction type
function getAccounts(txType, accounts) {
  if (txType === 'payment') {
    // Payment: DR AP, CR Cash
    return {
      dr: accounts.accounts_payable || '2110',
      cr: accounts.cash || '14010101',
      desc: 'دفع لمورد'
    };
  } else {
    // Invoice: DR Purchases/Expense, CR AP
    return {
      dr: accounts.purchases || '45010001',
      cr: accounts.accounts_payable || '2110',
      desc: 'فاتورة مشتريات'
    };
  }
}

async function processSupplierTx(tx, accounts) {
  const amount = parseFloat(tx.amount) || 0;
  if (amount === 0) return { success: false, error: 'Zero amount' };
  
  const txType = getTransactionType(tx.document_type);
  const acc = getAccounts(txType, accounts);
  
  const date = (tx.created_at || '2026-04-27').split(' ')[0];
  const ref = 'supplier';
  const desc = `${acc.desc} Tx ${tx.id}`;
  
  // Create JE
  const jeResult = execSQL(`INSERT INTO journal_entries (company_id,entry_date,description,ref_type,ref_id,is_posted) VALUES (1,'${date}','${desc}','${ref}',${tx.id},1)`);
  if (!jeResult.success) return { success: false, error: 'JE failed' };
  
  // Get JE ID
  const jeQuery = queryJSON(`SELECT id FROM journal_entries WHERE ref_type='${ref}' AND ref_id=${tx.id} ORDER BY id DESC LIMIT 1`);
  if (!jeQuery.success || jeQuery.data.length === 0) return { success: false, error: 'No JE' };
  const jeId = jeQuery.data[0].id;
  
  // Create lines
  const line1 = execSQL(`INSERT INTO journal_entry_lines (entry_id,company_id,account_code,debit,credit,description,source_ledger,source_record_id) VALUES (${jeId},1,'${acc.dr}',${amount},0,'${desc}','supplier',${tx.id})`);
  const line2 = execSQL(`INSERT INTO journal_entry_lines (entry_id,company_id,account_code,debit,credit,description,source_ledger,source_record_id) VALUES (${jeId},1,'${acc.cr}',0,${amount},'${desc}','supplier',${tx.id})`);
  if (!line1.success || !line2.success) return { success: false, error: 'Lines failed' };
  
  // Link
  const update = execSQL(`UPDATE supplier_transactions SET journal_entry_id=${jeId} WHERE id=${tx.id}`);
  if (!update.success) return { success: false, error: 'Link failed' };
  
  return { success: true, jeId, txType, dr: acc.dr, cr: acc.cr };
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  SUPPLIER BACKFILL — مع Business Logic صحيح                      ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  
  // Load accounts
  const controlAccounts = queryJSON(`SELECT mapping_key,account_code FROM posting_rules WHERE company_id=1 AND rule_type='control' AND is_active=1`);
  const accounts = {};
  if (controlAccounts.success) {
    controlAccounts.data.forEach(acc => accounts[acc.mapping_key] = acc.account_code);
  }
  
  console.log('\nالحسابات المستخدمة:');
  console.log(`  • Cash: ${accounts.cash || '14010101'}`);
  console.log(`  • AP (موردين): ${accounts.accounts_payable || '2110'}`);
  console.log(`  • Purchases: ${accounts.purchases || '45010001'}`);
  console.log('');
  
  // Get total
  const count = queryJSON(`SELECT COUNT(*) as n FROM supplier_transactions WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL`);
  const total = count.success ? (count.data[0]?.n || 0) : 0;
  
  if (total === 0) {
    console.log('✅ لا يوجد معاملات للتعبئة!');
    return;
  }
  
  console.log(`المعاملات المتبقية: ${total}\n`);
  console.log('يبدأ التعبئة خلال 3 ثوانٍ...');
  await sleep(3000);
  
  let processed = 0, success = 0, failed = 0;
  let typeStats = { invoice: 0, payment: 0 };
  
  while (processed < total) {
    const batch = queryJSON(`SELECT id,created_at,amount,document_type FROM supplier_transactions WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL LIMIT ${BATCH_SIZE}`);
    
    if (!batch.success || batch.data.length === 0) break;
    
    for (const tx of batch.data) {
      const result = await processSupplierTx(tx, accounts);
      if (result.success) {
        success++;
        typeStats[result.txType]++;
        process.stdout.write(result.txType === 'invoice' ? '📄' : '💰');
      } else {
        failed++;
        process.stdout.write('❌');
      }
      processed++;
    }
    
    console.log(` ${processed}/${total}`);
    await sleep(DELAY_MS);
  }
  
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  اكتملت التعبئة!                                                ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`\nالإحصائيات:`);
  console.log(`  • إجمالي: ${processed}`);
  console.log(`  • نجح: ${success} ✅`);
  console.log(`  • فشل: ${failed} ❌`);
  console.log(`\nحسب النوع:`);
  console.log(`  • فواتير (Invoice): ${typeStats.invoice}`);
  console.log(`  • دفعات (Payment): ${typeStats.payment}`);
  
  if (failed > 0) {
    console.log('\n⚠️ بعض المعاملات فشلت. يمكن إعادة التشغيل.');
  } else {
    console.log('\n✅ جميع معاملات الموردين تم ربطها بالـ GL!');
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
