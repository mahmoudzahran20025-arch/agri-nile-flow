#!/usr/bin/env node
import { execSync } from 'child_process';
import { writeFileSync, existsSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const DB_NAME = 'agri-nile-flow-data-lake';
const COMPANY_ID = 1;

function d1Query(sql) {
  const escapedSql = sql.replace(/"/g, '\\"');
  const out = execSync(
    `npx wrangler d1 execute ${DB_NAME} --remote --command="${escapedSql}" --json`,
    { cwd: path.join(__dir, '..'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  try {
    const jsonMatch = out.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed[0]?.results || [];
  } catch (e) {
    console.error('Error parsing JSON:', e);
    return [];
  }
}

function d1Execute(sql) {
  const tmpFile = path.join(__dir, '_tmp_backfill.sql');
  const batch = sql.split('\n').filter(l => l.trim().length > 0);
  if (batch.length === 0) return;

  // Execute in chunks to avoid massive files/timeouts
  // Execute in chunks to avoid massive files/timeouts
  // Use a multiple of 3 (300) so headers and lines stay together
  for (let i = 0; i < batch.length; i += 300) {
    const chunk = batch.slice(i, i + 300).join('\n');
    writeFileSync(tmpFile, chunk, 'utf8');
    console.log(`🚀 Pushing batch ${i / 300 + 1}...`);
    try {
      execSync(
        `npx wrangler d1 execute ${DB_NAME} --remote --file="${tmpFile}"`,
        { cwd: path.join(__dir, '..'), stdio: 'inherit' }
      );
    } finally {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    }
  }
}

async function run() {
  console.log('🚀 Starting GL Backfill...');

  // 1. Get Mappings
  const mappingsRaw = d1Query(`SELECT mapping_key, account_code FROM gl_account_mappings WHERE company_id = ${COMPANY_ID}`);
  const mappings = {};
  mappingsRaw.forEach(m => mappings[m.mapping_key] = m.account_code);

  const cashAcc = mappings['cash'];
  const invAcc = mappings['inventory'];
  const apAcc = mappings['accounts_payable'];
  const expDef = mappings['expense_default'];
  const revDef = mappings['revenue_default'];

  if (!cashAcc || !invAcc || !apAcc) {
    console.error('❌ Missing critical GL mappings (cash, inventory, accounts_payable). Aborting.');
    return;
  }

  // 2. Get Periods
  const periods = d1Query(`SELECT id, start_date, end_date FROM financial_periods WHERE company_id = ${COMPANY_ID} AND is_closed = 0`);

  function getPeriod(date) {
    const p = periods.find(p => date >= p.start_date && date <= p.end_date);
    return p ? p.id : null;
  }

  function esc(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  }

  let jeSql = [];

  // --- A. CASH TRANSACTIONS ---
  console.log('💰 Processing Cash Transactions...');
  const cashTx = d1Query(`SELECT * FROM cash_transactions WHERE company_id = ${COMPANY_ID}`);
  console.log(`   Found ${cashTx.length} transactions`);

  for (const tx of cashTx) {
    const pid = getPeriod(tx.transaction_date);
    if (!pid) continue;

    const jeKey = `mig_cash_${tx.id}`;
    const amount = tx.amount || (tx.debit + tx.credit);
    const contraAcc = tx.supplier_code ? apAcc : (tx.direction === 'د' ? revDef : expDef);

    jeSql.push(`INSERT INTO journal_entries (company_id, period_id, entry_date, description, ref_type, ref_id, is_posted, local_id) VALUES (${COMPANY_ID}, ${pid}, ${esc(tx.transaction_date)}, ${esc(tx.narration)}, 'cash_transaction', ${tx.id}, 1, ${esc(jeKey)});`);
    
    // Line 1: Cash
    jeSql.push(`INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code) VALUES ((SELECT id FROM journal_entries WHERE local_id = ${esc(jeKey)}), ${COMPANY_ID}, ${esc(cashAcc)}, ${tx.direction === 'د' ? amount : 0}, ${tx.direction === 'م' ? amount : 0}, ${esc(tx.narration)}, ${esc(tx.center_code)});`);
    
    // Line 2: Contra
    jeSql.push(`INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code) VALUES ((SELECT id FROM journal_entries WHERE local_id = ${esc(jeKey)}), ${COMPANY_ID}, ${esc(contraAcc)}, ${tx.direction === 'م' ? amount : 0}, ${tx.direction === 'د' ? amount : 0}, ${esc(tx.narration)}, ${esc(tx.center_code)});`);
  }

  // --- B. INVENTORY MOVEMENTS ---
  console.log('📦 Processing Inventory Movements...');
  const invTx = d1Query(`SELECT * FROM inventory_movements WHERE company_id = ${COMPANY_ID}`);
  console.log(`   Found ${invTx.length} movements`);

  for (const tx of invTx) {
    const pid = getPeriod(tx.movement_date);
    if (!pid) continue;
    const value = tx.value_in || tx.value_out || (tx.quantity * tx.unit_price);
    if (value <= 0) continue;

    const jeKey = `mig_inv_${tx.id}`;
    const desc = `${tx.movement_type === 'اضافة' ? 'إضافة' : 'صرف'} مخزون: ${tx.notes || ''}`;

    jeSql.push(`INSERT INTO journal_entries (company_id, period_id, entry_date, description, ref_type, ref_id, is_posted, local_id) VALUES (${COMPANY_ID}, ${pid}, ${esc(tx.movement_date)}, ${esc(desc)}, 'inventory_movement', ${tx.id}, 1, ${esc(jeKey)});`);

    if (tx.movement_type === 'اضافة') {
       // DR Inventory / CR AP
       jeSql.push(`INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description) VALUES ((SELECT id FROM journal_entries WHERE local_id = ${esc(jeKey)}), ${COMPANY_ID}, ${esc(invAcc)}, ${value}, 0, ${esc(desc)});`);
       jeSql.push(`INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description) VALUES ((SELECT id FROM journal_entries WHERE local_id = ${esc(jeKey)}), ${COMPANY_ID}, ${esc(apAcc)}, 0, ${value}, ${esc(desc)});`);
    } else {
       // DR Expense / CR Inventory
       jeSql.push(`INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description) VALUES ((SELECT id FROM journal_entries WHERE local_id = ${esc(jeKey)}), ${COMPANY_ID}, ${esc(expDef)}, ${value}, 0, ${esc(desc)});`);
       jeSql.push(`INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description) VALUES ((SELECT id FROM journal_entries WHERE local_id = ${esc(jeKey)}), ${COMPANY_ID}, ${esc(invAcc)}, 0, ${value}, ${esc(desc)});`);
    }
  }

  // --- C. SUPPLIER TRANSACTIONS (Invoices only) ---
  console.log('📄 Processing Supplier Transactions (Invoices)...');
  // Avoid duplicating cash payments
  const supTx = d1Query(`SELECT * FROM supplier_transactions WHERE company_id = ${COMPANY_ID} AND document_type != 'cash_payment'`);
  console.log(`   Found ${supTx.length} invoices`);

  for (const tx of supTx) {
    const pid = getPeriod(tx.transaction_date);
    if (!pid) continue;
    if (tx.entry_type !== 'د') continue; // Only credit purchases (invoices)

    const jeKey = `mig_sup_${tx.id}`;
    const desc = `فاتورة مورد: ${tx.notes || ''}`;

    jeSql.push(`INSERT INTO journal_entries (company_id, period_id, entry_date, description, ref_type, ref_id, is_posted, local_id) VALUES (${COMPANY_ID}, ${pid}, ${esc(tx.transaction_date)}, ${esc(desc)}, 'supplier_invoice', ${tx.id}, 1, ${esc(jeKey)});`);
    
    // DR Expense / CR AP
    jeSql.push(`INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description) VALUES ((SELECT id FROM journal_entries WHERE local_id = ${esc(jeKey)}), ${COMPANY_ID}, ${esc(expDef)}, ${tx.amount}, 0, ${esc(desc)});`);
    jeSql.push(`INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description) VALUES ((SELECT id FROM journal_entries WHERE local_id = ${esc(jeKey)}), ${COMPANY_ID}, ${esc(apAcc)}, 0, ${tx.amount}, ${esc(desc)});`);
  }

  if (jeSql.length > 0) {
    console.log(`🚀 Pushing ${jeSql.length} SQL statements to D1...`);
    d1Execute(jeSql.join('\n'));
    console.log('✅ GL Backfill completed successfully.');
  } else {
    console.log('ℹ️ No entries to backfill.');
  }
}

run();
