const XLSX = require('xlsx');
const wb = XLSX.readFile('مخازن نواة المستقبل2025-2026.xlsx');
const ws = wb.Sheets["البيانات"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
console.log(`Total rows: ${rows.length}`);
for (let i = 800; i < rows.length; i++) {
  const r = rows[i];
  if (r && r.some(c => c !== null && c !== '')) {
    console.log(`Found data at Row ${i}:`, JSON.stringify(r));
    break;
  }
}
