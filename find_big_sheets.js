const XLSX = require('xlsx');
const files = [
  'الموردين والعملاء نواة المستقبل2025-2026.xlsx',
  'خزينة نواة المستقبل 2025-2026.xlsx',
  'مخازن نواة المستقبل2025-2026.xlsx'
];
files.forEach(f => {
  const wb = XLSX.readFile(f);
  wb.SheetNames.forEach(n => {
    const ws = wb.Sheets[n];
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    const rowCount = range.e.r + 1;
    if (rowCount > 1000) {
      console.log(`File: ${f} | Sheet: "${n}" | Rows: ${rowCount}`);
    }
  });
});
