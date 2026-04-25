const XLSX = require('xlsx');
const wb = XLSX.readFile('خزينة نواة المستقبل 2025-2026.xlsx');
const ws = wb.Sheets["البيان"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
console.log(`Total rows: ${rows.length}`);
let nonHeaderRows = 0;
for (let i = 6; i < rows.length; i++) {
  const r = rows[i];
  if (r && r.some(c => c !== null && c !== '')) {
    nonHeaderRows++;
  }
}
console.log(`Total non-empty rows after header: ${nonHeaderRows}`);
