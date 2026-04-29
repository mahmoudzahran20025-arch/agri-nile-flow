const xlsx = require('xlsx');
const fs = require('fs');

console.log('=== البحث الشامل في جميع ملفات Excel ===\n');

const files = [
  { name: 'المخازن', path: '.\\مخازن نواة المستقبل2025-2026.xlsx' },
  { name: 'الموردين', path: '.\\الموردين والعملاء نواة المستقبل2025-2026.xlsx' },
  { name: 'الخزينة', path: '.\\خزينة نواة المستقبل 2025-2026.xlsx' },
  { name: 'الشجرة', path: '.\\شجرة نواة المستقبل (1).xlsx' }
];

// مصطلحات البحث
const searchTerms = [
  { term: 'حراث', desc: 'حراثة الأرض' },
  { term: 'حجار', desc: 'حجارة' },
  { term: 'مهمة', desc: 'مهام مرتبة' },
  { term: 'مهام', desc: 'مهام' },
  { term: 'تسوية', desc: 'تسوية أرض' },
  { term: 'تجهيز', desc: 'تجهيز أرض' },
  { term: 'شق', desc: 'شق طرق' },
  { term: 'ردم', desc: 'ردم' },
  { term: 'تطهير', desc: 'تطهير' },
  { term: 'عمالة', desc: 'عمالة يومية' },
  { term: 'مقاولة', desc: 'مقاولات' },
  { term: 'اشراف', desc: 'اشراف زراعي' },
  { term: 'اعمال', desc: 'اعمال' },
  { term: 'خدمة', desc: 'خدمات' }
];

const results = [];

for (const file of files) {
  console.log(`\n📁 ملف: ${file.name}`);
  console.log('=' .repeat(50));
  
  try {
    const wb = xlsx.readFile(file.path, {sheetStubs: true});
    
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet, {header: 1});
      
      let foundCount = 0;
      const foundTerms = new Set();
      
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!row) continue;
        
        for (let j = 0; j < row.length; j++) {
          const cell = row[j];
          if (typeof cell === 'string') {
            for (const search of searchTerms) {
              if (cell.includes(search.term)) {
                foundCount++;
                foundTerms.add(search.term);
                
                // استخراج رقم المركز إذا وجد
                let centerCode = null;
                for (let k = 0; k < row.length; k++) {
                  const val = row[k];
                  if (typeof val === 'number' && val >= 1006000 && val <= 1006999) {
                    centerCode = val;
                    break;
                  }
                }
                
                results.push({
                  file: file.name,
                  sheet: sheetName,
                  row: i,
                  term: search.term,
                  description: search.desc,
                  centerCode: centerCode,
                  text: cell.substring(0, 100)
                });
              }
            }
          }
        }
      }
      
      if (foundCount > 0) {
        console.log(`  📄 شيت "${sheetName}": ${foundCount} نتيجة`);
        console.log(`     المصطلحات: ${Array.from(foundTerms).join(', ')}`);
      }
    }
  } catch (err) {
    console.log(`  ❌ خطأ: ${err.message}`);
  }
}

// حفظ النتائج
fs.writeFileSync('excel_search_results.json', JSON.stringify(results, null, 2));

console.log('\n\n📊 ملخص النتائج:');
console.log('=' .repeat(50));
console.log(`إجمالي النتائج: ${results.length}`);

// تجميع حسب الملف
const byFile = {};
const byTerm = {};
const byCenter = {};

for (const r of results) {
  byFile[r.file] = (byFile[r.file] || 0) + 1;
  byTerm[r.term] = (byTerm[r.term] || 0) + 1;
  if (r.centerCode) {
    byCenter[r.centerCode] = (byCenter[r.centerCode] || 0) + 1;
  }
}

console.log('\nحسب الملف:');
for (const [f, c] of Object.entries(byFile)) {
  console.log(`  ${f}: ${c}`);
}

console.log('\nحسب المصطلح:');
for (const [t, c] of Object.entries(byTerm).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t}: ${c}`);
}

console.log('\nحسب مركز التكلفة:');
for (const [c, count] of Object.entries(byCenter).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${c}: ${count}`);
}

console.log('\n✅ التقرير محفوظ في: excel_search_results.json');
