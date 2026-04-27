// Debug treasury date formats
const XLSX = require('xlsx');
const path = require('path');
const BASE = 'C:\\Users\\mahmo\\Contacts\\CLAUDE_CO WORK MY WORK\\agri-nile-flow';

const wb = XLSX.readFile(path.join(BASE, 'خزينة نواة المستقبل 2025-2026.xlsx'), { cellDates: false });
const ws = wb.Sheets['البيان'];
const data = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });

console.log('Total rows:', data.length);
console.log('\nRows 3-8 (date col analysis):');
for (let i = 3; i < 9; i++) {
  const r = data[i];
  const k0 = Object.keys(r)[0];
  const k1 = Object.keys(r)[1];
  const v0 = r[k0];
  const v1 = r[k1];
  console.log(`Row ${i}: col0="${k0}"=${JSON.stringify(v0)} (${typeof v0}) | col1="${k1}"=${JSON.stringify(v1)}`);
}

// Count how many rows have date-like values in first column
let numericDates = 0, stringDates = 0, nullDates = 0, otherDates = 0;
data.forEach(r => {
  const v = r[Object.keys(r)[0]];
  if (!v) { nullDates++; return; }
  if (typeof v === 'number' && v > 40000 && v < 55000) { numericDates++; return; }
  if (/^\d{4}[\/\-]\d{2}[\/\-]\d{2}/.test(String(v).trim())) { stringDates++; return; }
  if (/^\d{2}[\/\-]\d{2}[\/\-]\d{4}/.test(String(v).trim())) { otherDates++; return; }
  nullDates++;
});

console.log('\nDate type distribution (col0):');
console.log('  Numeric Excel dates (>40000):', numericDates);
console.log('  String YYYY/MM/DD dates:', stringDates);
console.log('  String DD/MM/YYYY dates:', otherDates);
console.log('  Null/other:', nullDates);

// Also check supplier transactions
const wb2 = XLSX.readFile(path.join(BASE, 'الموردين والعملاء نواة المستقبل2025-2026.xlsx'), { cellDates: false });
const ws2 = wb2.Sheets['البيان'];
const data2 = XLSX.utils.sheet_to_json(ws2, { raw: true, defval: null });
console.log('\n\nSupplier البيان Total rows:', data2.length);
for (let i = 0; i < 5; i++) {
  const r = data2[i];
  const k0 = Object.keys(r)[0];
  const v0 = r[k0];
  console.log(`Row ${i}: col0="${k0}"=${JSON.stringify(v0)} (${typeof v0})`);
}

let n2 = 0, s2 = 0;
data2.forEach(r => {
  const v = r[Object.keys(r)[0]];
  if (typeof v === 'number' && v > 40000 && v < 55000) { n2++; return; }
  if (v && /^\d{4}[\/\-]\d{2}[\/\-]\d{2}/.test(String(v).trim())) { s2++; }
});
console.log('  Numeric dates:', n2, '| String YYYY/MM/DD:', s2);
