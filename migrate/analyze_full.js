import xlsx from 'xlsx';
import path from 'path';

const files = [
  '../الموردين والعملاء نواة المستقبل2025-2026.xlsx',
  '../خزينة نواة المستقبل 2025-2026.xlsx',
  '../مخازن نواة المستقبل2025-2026.xlsx'
];

for (const file of files) {
  console.log(`\n======================================================`);
  console.log(`ANALYZING: ${file}`);
  console.log(`======================================================\n`);
  try {
    const workbook = xlsx.readFile(file);
    for (const sheetName of workbook.SheetNames) {
      console.log(`\n--- Sheet: ${sheetName} ---`);
      const sheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
      if (data.length === 0) {
        console.log('  (Empty sheet)');
        continue;
      }
      
      console.log(`  Row count: ${data.length}`);
      
      // Find the first row that looks like a header (has multiple string values)
      let headerRowIndex = 0;
      for (let i = 0; i < Math.min(10, data.length); i++) {
        if (data[i] && data[i].length > 2) {
          headerRowIndex = i;
          break;
        }
      }
      
      console.log(`  Detected Headers (Row ${headerRowIndex + 1}):`);
      const headers = data[headerRowIndex] || [];
      headers.forEach((h, idx) => {
        if (h !== undefined && h !== null && h !== '') {
          console.log(`    Col[${idx}]: ${h}`);
        }
      });
      
      console.log(`\n  Sample Data (Row ${headerRowIndex + 2}):`);
      const sampleRow = data[headerRowIndex + 1] || [];
      headers.forEach((h, idx) => {
         if (h !== undefined && h !== null && h !== '') {
            console.log(`    [${h}]: ${sampleRow[idx]}`);
         }
      });
      
    }
  } catch (err) {
    console.error(`Error reading ${file}:`, err.message);
  }
}
