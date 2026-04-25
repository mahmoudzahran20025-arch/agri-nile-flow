const XLSX = require('xlsx');
const path = require('path');

const files = [
  'الموردين والعملاء نواة المستقبل2025-2026.xlsx',
  'خزينة نواة المستقبل 2025-2026.xlsx',
  'مخازن نواة المستقبل2025-2026.xlsx',
  'شجرة نواة المستقبل (1).xlsx'
];

files.forEach(f => {
  console.log(`\n--- File: ${f} ---`);
  try {
    const wb = XLSX.readFile(f);
    wb.SheetNames.forEach(name => {
      const ws = wb.Sheets[name];
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      const rows = range.e.r + 1;
      console.log(`  Sheet: "${name}" | Approx Rows: ${rows}`);
    });
  } catch (e) {
    console.error(`  Error reading ${f}: ${e.message}`);
  }
});
