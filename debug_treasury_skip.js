const XLSX = require('xlsx');
const wb = XLSX.readFile('خزينة نواة المستقبل 2025-2026.xlsx');
const ws = wb.Sheets["البيان"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
console.log(`Total rows: ${rows.length}`);
rows.slice(100, 150).forEach((r, i) => {
  console.log(`Row ${i + 100}:`, JSON.stringify(r));
});
