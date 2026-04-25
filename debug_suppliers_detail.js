const XLSX = require('xlsx');
const path = require('path');

const wb = XLSX.readFile('الموردين والعملاء نواة المستقبل2025-2026.xlsx');
const ws = wb.Sheets['البيان'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

console.log(`Total rows in 'البيان': ${rows.length}`);
rows.slice(300, 350).forEach((r, i) => {
  console.log(`Row ${i + 300}:`, JSON.stringify(r));
});
