const XLSX = require('xlsx');
const wb = XLSX.readFile('الموردين والعملاء نواة المستقبل2025-2026.xlsx');
const ws = wb.Sheets["البيان"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
let count = 0;
for (let i = 4; i < rows.length; i++) {
  const r = rows[i];
  if (r && r.some(c => c !== null && c !== '' && c !== 0)) {
    count++;
    if (count < 50) {
      console.log(`Data Row ${i}:`, JSON.stringify(r));
    }
  }
}
console.log(`Total data-containing rows: ${count}`);
