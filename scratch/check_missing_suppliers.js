/**
 * check_missing_suppliers.js
 * Read all supplier codes from Excel كود sheet and compare with D1
 */
const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', 'الموردين والعملاء نواة المستقبل2025-2026.xlsx');
const wb = XLSX.readFile(filePath);

const ws = wb.Sheets['الكود'];
const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

console.log('=== All suppliers in Excel كود sheet ===');
const excelSuppliers = [];
raw.slice(1).forEach(r => {
  if (r[0] && typeof r[0] === 'number') {
    excelSuppliers.push({ code: r[0], name: r[1], activity: r[2], notes: r[3] });
    console.log(`  code=${r[0]}, name="${r[1]}", activity="${r[2]}"`);
  }
});

// D1 codes (from previous query)
const d1Codes = [10100192, 20100033, 20300086, 20300121, 20800286, 20900151, 20900353, 21400002, 21400108, 35300902];

console.log('\n=== Missing from D1 ===');
const missing = excelSuppliers.filter(s => !d1Codes.includes(s.code));
missing.forEach(s => console.log(`  MISSING: code=${s.code}, name="${s.name}"`));

if (missing.length === 0) {
  console.log('  None — all Excel suppliers already in D1!');
}

console.log('\n=== In D1 but not in Excel ===');
const inD1NotExcel = d1Codes.filter(c => !excelSuppliers.find(s => s.code === c));
inD1NotExcel.forEach(c => console.log(`  D1-only: code=${c}`));
