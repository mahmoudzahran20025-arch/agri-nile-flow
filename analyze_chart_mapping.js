const xlsx = require('xlsx');

console.log('=== تحليل شجرة الحسابات - Mapping Columns ===\n');

const wb = xlsx.readFile('شجرة نواة المستقبل (1).xlsx', {sheetStubs: true});
const sheet = wb.Sheets[wb.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet, {header: 1});

console.log('إجمالي الصفوف:', data.length);
console.log('عدد الأعمدة في الصف الأول:', data[0].length);
console.log('\nصف الرأس (Header):');
for (let i = 0; i < data[0].length; i++) {
  console.log(`  [${i}] = ${data[0][i]}`);
}

console.log('\n=== البحث عن Mapping ===');
// عرض أول 10 صفوف بعد الرأس
for (let i = 1; i <= Math.min(10, data.length - 1); i++) {
  const row = data[i];
  console.log(`\nRow ${i}:`);
  for (let j = 0; j < row.length; j++) {
    if (row[j] !== undefined && row[j] !== null && row[j] !== '') {
      const val = String(row[j]).substring(0, 30);
      console.log(`  [${j}] = ${val}`);
    }
  }
}

// تحديد أعمدة mapping
console.log('\n=== تحديد أعمدة Mapping ===');
const mappingInfo = [];
for (let i = 1; i < Math.min(20, data.length); i++) {
  const row = data[i];
  const accountCode = row[2]; // عمود الكود
  const accountName = row[3]; // عمود الاسم
  const mappingCol = row[5];    // عمود محتمل للـ mapping
  const mappingDetail = row[6]; // عمود محتمل للـ mapping detailed
  
  if (typeof accountCode === 'number' && accountCode >= 10000000) {
    mappingInfo.push({
      code: accountCode,
      name: accountName,
      mapping: mappingCol,
      mappingDetail: mappingDetail
    });
  }
}

console.log('\nعينة من Mapping:');
mappingInfo.slice(0, 10).forEach(m => {
  console.log(`  ${m.code}: ${m.name}`);
  console.log(`    → Mapping: ${m.mapping || '(فارغ)'}`);
  console.log(`    → Detailed: ${m.mappingDetail || '(فارغ)'}`);
});

// إحصائيات Mapping
const withMapping = mappingInfo.filter(m => m.mapping && String(m.mapping).trim() !== '');
console.log(`\n✅ الحسابات التي لديها Mapping: ${withMapping.length} من ${mappingInfo.length}`);
