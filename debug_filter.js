const XLSX = require('xlsx');
const wb = XLSX.readFile('الموردين والعملاء نواة المستقبل2025-2026.xlsx');
const ws = wb.Sheets[wb.SheetNames[3]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
console.log(`Total rows: ${rows.length}`);

let count = 0;
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  if (r && r[2] && (r[8] || r[9])) {
    count++;
    if (count < 20) {
      console.log(`Valid Row ${i}:`, JSON.stringify(r));
    }
  }
}
console.log(`Final count of rows matching filter: ${count}`);
