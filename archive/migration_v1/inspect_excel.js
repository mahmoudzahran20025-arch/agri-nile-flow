import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const dir = '..';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.xlsx'));

for (const fileName of files) {
  const filePath = path.join(dir, fileName);
  console.log('\n--- Inspecting File: ' + fileName + ' ---');
  try {
    const wb = XLSX.readFile(filePath);
    console.log('Sheets:', wb.SheetNames);
    for (const sheetName of wb.SheetNames) {
      const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
      console.log('\nSheet: ' + sheetName);
      console.log('Total Rows: ' + data.length);
      console.log('First 3 Rows:');
      console.log(JSON.stringify(data.slice(0, 3), null, 2));
    }
  } catch (err) {
    console.error('Error reading ' + fileName + ':', err.message);
  }
}