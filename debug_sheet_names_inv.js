const XLSX = require('xlsx');
const wb = XLSX.readFile('مخازن نواة المستقبل2025-2026.xlsx');
wb.SheetNames.forEach((name, i) => {
  console.log(`Index ${i}: "${name}"`);
});
