const XLSX = require('xlsx');
const wb = XLSX.readFile('خزينة نواة المستقبل 2025-2026.xlsx');
const ws = wb.Sheets["البيان"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
let count = 0;
for (let i = 6; i < rows.length; i++) {
  const r = rows[i];
  if (r && r.some(c => c !== null && c !== '' && c !== 0)) {
    count++;
  }
}
console.log(`Total data-containing rows in Treasury: ${count}`);
