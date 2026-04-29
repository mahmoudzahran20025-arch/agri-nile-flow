import XLSX from 'xlsx';
const wb = XLSX.readFile('خزينة نواة المستقبل 2025-2026.xlsx');
const data = XLSX.utils.sheet_to_json(wb.Sheets['البيان'], { header: 1 });
for (let r = 0; r < 20; r++) {
  if (!data[r]) continue;
  let hasData = false;
  let rowStr = 'Row ' + (r+1) + ': ';
  for (let c = 0; c < data[r].length; c++) {
    if (data[r][c] !== null && data[r][c] !== undefined && data[r][c] !== '') {
      rowStr += '[' + c + ']: ' + data[r][c] + ' | ';
      hasData = true;
    }
  }
  if (hasData) console.log(rowStr);
}
