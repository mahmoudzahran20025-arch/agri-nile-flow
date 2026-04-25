const XLSX = require('xlsx');
const wb = XLSX.readFile('الموردين والعملاء نواة المستقبل2025-2026.xlsx');
const ws = wb.Sheets[wb.SheetNames[3]]; // كشف حساب مفصل
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
console.log(`Total rows: ${rows.length}`);
for (let i = 50; i < rows.length; i++) {
  const r = rows[i];
  if (r && r.some(c => c !== null && c !== '')) {
    console.log(`Found more data at Row ${i}:`, JSON.stringify(r));
    // If it's a date or amount, keep looking, if we find many, let's count them
  }
}
