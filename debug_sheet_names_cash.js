const XLSX = require('xlsx');
const wb = XLSX.readFile('خزينة نواة المستقبل 2025-2026.xlsx');
wb.SheetNames.forEach((name, i) => {
  console.log(`Index ${i}: "${name}"`);
});
