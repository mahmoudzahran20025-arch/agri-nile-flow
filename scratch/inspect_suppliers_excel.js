const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', 'الموردين والعملاء نواة المستقبل2025-2026.xlsx');
const wb = XLSX.readFile(filePath);

console.log('=== Sheets ===');
console.log(wb.SheetNames);

// Check each sheet
wb.SheetNames.forEach(sheetName => {
  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const rows = data.filter(r => r.some(c => c !== ''));
  console.log(`\n=== Sheet: "${sheetName}" — ${rows.length} rows ===`);
  if (rows.length > 0) {
    console.log('Headers:', JSON.stringify(rows[0]));
  }
  if (rows.length > 1) {
    console.log('Row 2:', JSON.stringify(rows[1]));
  }
  if (rows.length > 2) {
    console.log('Row 3:', JSON.stringify(rows[2]));
  }
});
