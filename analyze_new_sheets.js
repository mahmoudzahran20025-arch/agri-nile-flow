const XLSX = require('xlsx');
const path = require('path');

const targets = [
  { file: 'الموردين والعملاء نواة المستقبل2025-2026.xlsx', sheet: 'النشاط' },
  { file: 'خزينة نواة المستقبل 2025-2026.xlsx', sheet: 'مساهمة الشركاء' },
  { file: 'مخازن نواة المستقبل2025-2026.xlsx', sheet: 'البيان اليومي' }
];

targets.forEach(t => {
  console.log(`\n--- ${t.file} | Sheet: ${t.sheet} ---`);
  try {
    const wb = XLSX.readFile(t.file);
    const ws = wb.Sheets[t.sheet];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    
    // Show top 10 rows to see headers and data starts
    rows.slice(0, 10).forEach((r, i) => {
      console.log(`Row ${i}:`, JSON.stringify(r));
    });
  } catch (e) {
    console.error(`Error: ${e.message}`);
  }
});
