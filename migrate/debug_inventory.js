import XLSX from 'xlsx';
const wb = XLSX.readFile('مخازن نواة المستقبل2025-2026.xlsx');
const data = XLSX.utils.sheet_to_json(wb.Sheets['البيانات'], { header: 1 });
console.log('Row 3 (header):', data[2]);
console.log('Row 4 (data):', data[3]);
console.log('Row 4 has values at columns:');
for (let i = 0; i < Math.min(35, data[3].length); i++) {
  if (data[3][i] !== null && data[3][i] !== undefined && data[3][i] !== '') {
    console.log('Col ' + i + ': ' + data[3][i]);
  }
}
