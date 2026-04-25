const XLSX = require('xlsx');
const path = require('path');

const files = [
  { name: 'الموردين والعملاء نواة المستقبل2025-2026.xlsx', sheet: 'البيان', start: 300 },
  { name: 'خزينة نواة المستقبل 2025-2026.xlsx', sheet: 'البيان', start: 100 },
  { name: 'مخازن نواة المستقبل2025-2026.xlsx', sheet: 'البيانات', start: 800 }
];

files.forEach(f => {
  console.log(`\n--- Inspecting ${f.name} | Sheet: ${f.sheet} | Starting at ${f.start} ---`);
  const wb = XLSX.readFile(f.name);
  const ws = wb.Sheets[f.sheet];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(f.start);
  
  rows.slice(0, 10).forEach((r, i) => {
    console.log(`Row ${i + f.start}:`, JSON.stringify(r));
  });
});
