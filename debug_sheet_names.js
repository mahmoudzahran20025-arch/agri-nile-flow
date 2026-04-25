const XLSX = require('xlsx');
const wb = XLSX.readFile('الموردين والعملاء نواة المستقبل2025-2026.xlsx');
wb.SheetNames.forEach((name, i) => {
  console.log(`Index ${i}: "${name}" (Length: ${name.length})`);
  for(let j=0; j<name.length; j++) {
    console.log(`  Char ${j}: ${name.charCodeAt(j)}`);
  }
});
