const XLSX = require('xlsx');
const path = require('path');

const wb = XLSX.readFile('الموردين والعملاء نواة المستقبل2025-2026.xlsx');
const ws = wb.Sheets['النشاط'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

console.log(`Total rows in 'النشاط': ${rows.length}`);
rows.slice(0, 50).forEach((r, i) => {
  if (r.length > 0) {
    console.log(`Row ${i}:`, JSON.stringify(r));
  }
});
