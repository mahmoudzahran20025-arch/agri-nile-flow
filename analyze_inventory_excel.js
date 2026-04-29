const xlsx = require('xlsx');

const wb = xlsx.readFile('مخازن نواة المستقبل2025-2026.xlsx', {sheetStubs: true});

console.log('=== أسماء الشيتات في ملف المخزن ===');
wb.SheetNames.forEach((name, i) => {
  const ws = wb.Sheets[name];
  const ref = ws['!ref'] || 'N/A';
  console.log(`${i+1}. ${name} - النطاق: ${ref}`);
});

// تحليل البيانات الرئيسية
console.log('\n=== تحليل شيت البيانات الرئيسي ===');
const dataSheet = wb.Sheets['البيانات'];
if (dataSheet) {
  const jsonData = xlsx.utils.sheet_to_json(dataSheet, {header: 1});
  console.log(`عدد الصفوف: ${jsonData.length}`);
  console.log(`الصف الأول (العناوين): ${JSON.stringify(jsonData[0])}`);
  console.log(`الصف الثاني: ${JSON.stringify(jsonData[1])}`);
}

// البحث عن Pivot Tables
console.log('\n=== البحث عن تحليلات Pivot Table ===');
wb.SheetNames.forEach(name => {
  if (name.includes('Pivot') || name.includes(' pivot') || name.includes('تلخيص') || name.includes('كشف')) {
    console.log(`🔄 Pivot Table محتمل: ${name}`);
    const ws = wb.Sheets[name];
    const json = xlsx.utils.sheet_to_json(ws, {header: 1});
    console.log(`   الصفوف: ${json.length}`);
    if (json.length > 0) {
      console.log(`   العناوين: ${JSON.stringify(json[0])}`);
    }
  }
});
