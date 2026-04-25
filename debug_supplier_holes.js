const XLSX = require('xlsx');
const wb = XLSX.readFile('الموردين والعملاء نواة المستقبل2025-2026.xlsx');
const ws = wb.Sheets["البيان"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
for (let i = 500; i < rows.length; i++) {
  const r = rows[i];
  if (r && r.some(c => c !== null && c !== '')) {
    console.log(`Found data at Row ${i}:`, JSON.stringify(r));
    break;
  }
}
