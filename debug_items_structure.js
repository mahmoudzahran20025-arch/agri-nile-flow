const xlsx = require('xlsx');

const wb = xlsx.readFile('C:\\Users\\mahmo\\Contacts\\CLAUDE_CO WORK MY WORK\\agri-nile-flow\\مخازن نواة المستقبل2025-2026.xlsx', {sheetStubs: true});

console.log('=== تحليل بنية ملف المخازن ===\n');

console.log('الأوراق المتاحة:', wb.SheetNames);
console.log();

const dataSheet = wb.Sheets['البيانات'];
const data = xlsx.utils.sheet_to_json(dataSheet, {header: 1});

console.log(`إجمالي الصفوف: ${data.length}\n`);

// عرض أول 10 صفوف كاملة
console.log('أول 10 صفوف:');
for (let i = 0; i < Math.min(10, data.length); i++) {
  console.log(`\nRow ${i}:`);
  const row = data[i];
  for (let j = 0; j < row.length; j++) {
    if (row[j] !== undefined && row[j] !== null) {
      console.log(`  [${j}] = ${row[j]} (type: ${typeof row[j]})`);
    }
  }
}

// البحث عن أرقام أصناف (101xxxx)
console.log('\n=== البحث عن كود صنف (101xxxx) ===');
for (let i = 0; i < Math.min(100, data.length); i++) {
  const row = data[i];
  if (!row) continue;
  
  for (let j = 0; j < row.length; j++) {
    const val = row[j];
    if (typeof val === 'number' && val >= 1010000 && val <= 1099999) {
      console.log(`Found item code ${val} at row ${i}, col ${j}`);
      console.log(`  Name: ${row[j+1] || 'N/A'}`);
      console.log(`  Warehouse: ${row[j-2] || row[j-1] || 'N/A'}`);
    }
  }
}
