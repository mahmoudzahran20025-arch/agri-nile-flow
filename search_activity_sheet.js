const XLSX = require('xlsx');
const files = [
  'الموردين والعملاء نواة المستقبل2025-2026.xlsx',
  'خزينة نواة المستقبل 2025-2026.xlsx',
  'مخازن نواة المستقبل2025-2026.xlsx'
];
files.forEach(f => {
  const wb = XLSX.readFile(f);
  wb.SheetNames.forEach(n => {
    if (n.includes('نشاط') || n.includes('البيان')) {
      console.log(`File: ${f} | Sheet: "${n}"`);
    }
  });
});
