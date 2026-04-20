import XLSX from 'xlsx'
const wb = XLSX.readFile('خزينة نواة المستقبل 2025-2026.xlsx')
const data = XLSX.utils.sheet_to_json(wb.Sheets['البيان'], { header: 1 })
console.log('Row 2 (header):', data[1])
console.log('Row 3 (data):', data[2])
console.log('Row 3 has values at columns:')
for (let i = 0; i < data[2].length; i++) {
  if (data[2][i] !== null && data[2][i] !== undefined && data[2][i] !== '') {
    console.log('Col ' + i + ': ' + data[2][i])
  }
}