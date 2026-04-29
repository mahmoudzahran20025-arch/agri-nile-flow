const xlsx = require('xlsx');

const wb = xlsx.readFile('شجرة نواة المستقبل (1).xlsx', {sheetStubs: true});

console.log('=== تحليل بنية ملف شجرة الحسابات ===\n');

console.log('أسماء الأوراق:', wb.SheetNames);
console.log();

const sheet = wb.Sheets[wb.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet, {header: 1});

console.log(`إجمالي الصفوف: ${data.length}\n`);

// عرض أول 20 صف لمعرفة البنية
console.log('أول 20 صف:');
for (let i = 0; i < Math.min(20, data.length); i++) {
  const row = data[i];
  console.log(`Row ${i}:`, row.slice(0, 5).map(v => typeof v === 'number' ? v : String(v).substring(0, 30)));
}

// البحث عن أي رقم يبدأ بـ 1401
console.log('\n=== البحث عن حسابات النقدية ===');
let found = 0;
for (let i = 0; i < data.length; i++) {
  const row = data[i];
  if (!row) continue;
  
  for (let j = 0; j < row.length; j++) {
    const val = row[j];
    if (typeof val === 'number' && val >= 14010000 && val < 14020000) {
      console.log(`Found: ${val} at row ${i}, col ${j}, name: ${row[j+1] || row[j-1] || 'unknown'}`);
      found++;
      if (found > 20) break;
    }
  }
  if (found > 20) break;
}

if (found === 0) {
  console.log('لم يتم العثور على حسابات 1401xxxxx');
  console.log('\n=== البحث عن أي حسابات ===');
  for (let i = 0; i < Math.min(50, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    
    for (let j = 0; j < row.length; j++) {
      const val = row[j];
      if (typeof val === 'number' && val >= 10000000 && val < 99999999) {
        console.log(`Found account: ${val} at row ${i}, col ${j}`);
      }
    }
  }
}
