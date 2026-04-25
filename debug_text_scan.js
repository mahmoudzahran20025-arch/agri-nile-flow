const XLSX = require('xlsx');
const wb = XLSX.readFile('الموردين والعملاء نواة المستقبل2025-2026.xlsx');
const ws = wb.Sheets[wb.SheetNames[3]]; // كشف حساب مفصل
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  if (r && r[3] && typeof r[3] === 'string' && r[3].length > 5) {
    console.log(`Row ${i} has text: "${r[3]}"`);
  }
}
