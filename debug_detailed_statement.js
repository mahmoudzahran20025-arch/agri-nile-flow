const XLSX = require('xlsx');
const wb = XLSX.readFile('الموردين والعملاء نواة المستقبل2025-2026.xlsx');
const ws = wb.Sheets[wb.SheetNames[3]]; // "كشف حساب مفصل"
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
console.log(`Total rows: ${rows.length}`);
rows.slice(0, 20).forEach((r, i) => {
  console.log(`Row ${i}:`, JSON.stringify(r));
});
