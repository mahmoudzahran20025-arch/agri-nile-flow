const XLSX = require('xlsx');
const fs = require('fs');

const files = [
  'الموردين والعملاء نواة المستقبل2025-2026.xlsx',
  'خزينة نواة المستقبل 2025-2026.xlsx',
  'مخازن نواة المستقبل2025-2026.xlsx',
  'شجرة نواة المستقبل (1).xlsx'
];

console.log('='.repeat(80));
console.log('تحليل ملفات Excel - نواة المستقبل 2025-2026');
console.log('='.repeat(80));

files.forEach(filename => {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📁 الملف: ${filename}`);
  console.log('='.repeat(80));
  
  try {
    const workbook = XLSX.readFile(filename);
    console.log(`\n📊 عدد الشيتات: ${workbook.SheetNames.length}`);
    console.log(`📋 أسماء الشيتات: ${workbook.SheetNames.join(', ')}`);
    
    workbook.SheetNames.forEach(sheetName => {
      console.log(`\n  ├─ Sheet: "${sheetName}"`);
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      
      console.log(`  │  ├─ عدد الصفوف: ${data.length}`);
      
      if (data.length > 0) {
        const headers = data[0];
        console.log(`  │  ├─ عدد الأعمدة: ${headers.length}`);
        console.log(`  │  ├─ الأعمدة (Headers):`);
        headers.forEach((h, i) => {
          if (h) console.log(`  │  │  ${i + 1}. ${h}`);
        });
        
        // عرض أول 3 صفوف بيانات
        console.log(`  │  └─ عينة من البيانات (أول 3 صفوف):`);
        for (let i = 1; i <= Math.min(3, data.length - 1); i++) {
          console.log(`  │     صف ${i}:`);
          data[i].forEach((cell, idx) => {
            if (cell !== '' && headers[idx]) {
              console.log(`  │       ${headers[idx]}: ${cell}`);
            }
          });
        }
      }
    });
    
  } catch (error) {
    console.log(`  ❌ خطأ في قراءة الملف: ${error.message}`);
  }
});

console.log('\n' + '='.repeat(80));
console.log('✅ انتهى التحليل');
console.log('='.repeat(80));
