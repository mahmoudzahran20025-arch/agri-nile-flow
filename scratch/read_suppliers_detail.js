const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', 'الموردين والعملاء نواة المستقبل2025-2026.xlsx');
const wb = XLSX.readFile(filePath);

// ===== بيان sheet — actual transaction data =====
const ws = wb.Sheets['البيان'];
const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

// Row 0,1,2 = headers/totals, Row 3+ = headers labels, Row 4+ = data
const headers = raw[2]; // Row 3 (0-indexed = 2) has actual column names
console.log('=== البيان Headers (row 3) ===');
headers.forEach((h, i) => { if (h) console.log(`  [${i}] ${h}`); });

// Find actual data rows (skip header and summary rows)
const dataRows = raw.slice(3).filter(r => {
  // Data rows have a date in col 0 or supplier code in col 2
  return r[0] && r[0] !== 'التاريخ' && r[2];
});

console.log(`\n=== Total data rows: ${dataRows.length} ===`);

if (dataRows.length > 0) {
  console.log('\n=== First 5 rows ===');
  dataRows.slice(0, 5).forEach((r, i) => {
    console.log(`Row ${i+1}:`, {
      date: r[0],
      type: r[1],
      supplier_code: r[2],
      supplier_name: r[3],
      description: r[4],
      doc_type: r[5],
      doc_num: r[6],
      expense: r[7],
      equipment: r[8],
      service: r[9],
      account_code: r[10],
      account_name: r[11],
      center_code: r[12],
      center_name: r[13],
      sub_code: r[14],
      sub: r[15],
      unit: r[16],
      quantity: r[17],
      unit_price: r[18],
      amount: r[19],
      credit: r[20],
      debit: r[21],
      check_amount: r[22],
      due_date: r[23],
      balance_no_checks: r[24],
      balance_with_checks: r[25],
      year: r[27],
      month: r[28],
      service2: r[29],
      notes: r[30],
    });
  });
}

// Get unique supplier codes
const supplierCodes = [...new Set(dataRows.map(r => r[2]).filter(Boolean))];
console.log('\n=== Unique supplier codes ===', supplierCodes);

// ===== الكود sheet — supplier master =====
const wsKod = wb.Sheets['الكود'];
const rawKod = XLSX.utils.sheet_to_json(wsKod, { header: 1, defval: '' });
console.log('\n=== الكود sheet — all suppliers ===');
rawKod.slice(1).forEach(r => {
  if (r[0]) console.log(`  code=${r[0]}, name=${r[1]}, activity=${r[2]}`);
});
