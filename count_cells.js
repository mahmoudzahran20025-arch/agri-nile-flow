const XLSX = require('xlsx');
const files = [
  'الموردين والعملاء نواة المستقبل2025-2026.xlsx',
  'خزينة نواة المستقبل 2025-2026.xlsx',
  'مخازن نواة المستقبل2025-2026.xlsx'
];
files.forEach(f => {
  console.log(`\n--- File: ${f} ---`);
  const wb = XLSX.readFile(f);
  wb.SheetNames.forEach(n => {
    const ws = wb.Sheets[n];
    let count = 0;
    Object.keys(ws).forEach(k => {
      if (k[0] !== '!' && ws[k].v !== undefined) {
        count++;
      }
    });
    console.log(`  Sheet: "${n}" | Non-empty Cells: ${count}`);
  });
});
