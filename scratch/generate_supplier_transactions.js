/**
 * generate_supplier_transactions.js
 * Reads Excel البيان sheet and generates SQL INSERTs for supplier_transactions
 * Run: node scratch/generate_supplier_transactions.js
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'الموردين والعملاء نواة المستقبل2025-2026.xlsx');
const wb = XLSX.readFile(filePath);

// ─── Helper: convert Excel serial date to ISO string ───────────────────────
function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number') return null;
  // Excel epoch: Dec 30, 1899
  const ms = (serial - 25569) * 86400 * 1000;
  const d = new Date(ms);
  return d.toISOString().split('T')[0];
}

// ─── Helper: safe number ────────────────────────────────────────────────────
function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// ─── Helper: escape SQL string ─────────────────────────────────────────────
function esc(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  const s = String(v).replace(/'/g, "''");
  return `'${s}'`;
}

// ─── Helper: entry_type from النوع column ──────────────────────────────────
// 'د' = debit (مدين), 'د' could be credit too — check credit/debit fields
function entryType(typeVal, credit, debit) {
  if (credit && num(credit) > 0) return 'CREDIT';
  if (debit && num(debit) > 0) return 'DEBIT';
  return 'DEBIT'; // default
}

// ─── Read البيان sheet ─────────────────────────────────────────────────────
const ws = wb.Sheets['البيان'];
const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

// Row index 2 = column headers (التاريخ, النوع, كود المورد, ...)
// Row index 3+ = data rows
const dataRows = raw.slice(3).filter(r => r[0] && r[2] && r[2] !== 'كود المورد');

console.log(`Found ${dataRows.length} data rows`);

// ─── Check unique supplier codes ───────────────────────────────────────────
const supplierCodes = [...new Set(dataRows.map(r => r[2]))];
console.log('Unique supplier codes:', supplierCodes);

// ─── Generate SQL ──────────────────────────────────────────────────────────
const lines = [
  '-- supplier_transactions seed',
  '-- Source: الموردين والعملاء نواة المستقبل2025-2026.xlsx - شيت البيان',
  `-- Generated: ${new Date().toISOString()}`,
  `-- Rows: ${dataRows.length}`,
  '',
];

let inserted = 0;
let skipped = 0;

dataRows.forEach((r, i) => {
  const supplierCode = r[2];
  const transDate = excelDateToISO(r[0]);

  if (!transDate) { skipped++; return; }

  const credit = num(r[20]);
  const debit  = num(r[21]);
  const amount = num(r[19]);

  const entryT = entryType(r[1], credit, debit);

  // season_id: year 2025-2026 = season 1
  const year  = r[27] ? parseInt(r[27]) : null;
  const month = r[28] ? parseInt(r[28]) : null;
  const seasonId = (year === 2025 || year === 2026) ? 1 : 1;

  const centerCode  = r[12] !== '' && !isNaN(parseInt(r[12])) ? parseInt(r[12]) : null;
  const subCode     = r[14] !== '' && !isNaN(parseInt(r[14])) ? parseInt(r[14]) : null;
  const accountCode = r[10] !== '' && !isNaN(parseInt(r[10])) ? parseInt(r[10]) : null;

  const dueDate = excelDateToISO(r[23]) || null;
  const checkClearDate = excelDateToISO(r[26]) || null;

  // Format balance/check values
  const checkAmount      = num(r[22]);
  const balanceNoChecks  = num(r[24]);
  const balanceWithChecks = num(r[25]);

  const sql = `INSERT INTO supplier_transactions ` +
    `(company_id, season_id, supplier_code, account_code, center_code, sub_code, ` +
    `transaction_date, entry_type, document_type, document_number, ` +
    `expense_category, equipment, unit, quantity, unit_price, ` +
    `amount, credit, debit, check_amount, due_date, ` +
    `balance_no_checks, balance_with_checks, check_clearance_date, ` +
    `year, month, notes) VALUES (` +
    `1, ${seasonId}, ${supplierCode}, ` +
    `${accountCode !== null ? accountCode : 'NULL'}, ` +
    `${centerCode !== null ? centerCode : 'NULL'}, ` +
    `${subCode !== null ? subCode : 'NULL'}, ` +
    `${esc(transDate)}, ${esc(entryT)}, ` +
    `${esc(r[5])}, ` +
    `${r[6] ? parseInt(r[6]) : 'NULL'}, ` +
    `${esc(r[7])}, ${esc(r[8])}, ` +
    `${esc(r[16])}, ` +
    `${num(r[17])}, ${num(r[18])}, ` +
    `${amount}, ${credit}, ${debit}, ${checkAmount}, ` +
    `${dueDate ? esc(dueDate) : 'NULL'}, ` +
    `${balanceNoChecks}, ${balanceWithChecks}, ` +
    `${checkClearDate ? esc(checkClearDate) : 'NULL'}, ` +
    `${year !== null ? year : 'NULL'}, ` +
    `${month !== null ? month : 'NULL'}, ` +
    `${esc(r[30])});`;

  lines.push(sql);
  inserted++;
});

console.log(`Generated: ${inserted} inserts, skipped: ${skipped}`);

const output = lines.join('\n');
const outPath = path.join(__dirname, '..', 'seed_supplier_transactions.sql');
fs.writeFileSync(outPath, output, 'utf8');
console.log(`Written to: seed_supplier_transactions.sql`);

// ─── Also show a few samples ───────────────────────────────────────────────
console.log('\nFirst 3 SQL lines:');
lines.slice(5, 8).forEach(l => console.log(l.substring(0, 200)));
