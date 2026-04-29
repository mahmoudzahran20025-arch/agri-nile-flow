const xlsx = require('xlsx');
const fs = require('fs');

const wb = xlsx.readFile('مخازن نواة المستقبل2025-2026.xlsx', {sheetStubs: true});

console.log('=== استخراج جميع الأصناف من شيت الكود ===\n');

const codeSheet = wb.Sheets['الكود'];
if (!codeSheet) {
  console.error('❌ شيت الكود غير موجود');
  process.exit(1);
}

const data = xlsx.utils.sheet_to_json(codeSheet, {header: 1});
console.log(`إجمالي الصفوف في شيت الكود: ${data.length}\n`);

// استخراج الأصناف الفريدة
const items = new Map();
let rowNum = 0;

for (const row of data) {
  rowNum++;
  // البحث عن كود الصنف (أرقام تبدأ بـ 101, 102, 103, etc.)
  for (let i = 0; i < row.length; i++) {
    const cell = row[i];
    if (typeof cell === 'number' && cell >= 1010000 && cell <= 1999999) {
      const itemCode = cell;
      const name = row[i + 1] || row[i - 1] || 'غير معروف';
      
      if (!items.has(itemCode)) {
        // تحديد الفئة
        let category = 'أخرى';
        const prefix = Math.floor(itemCode / 100000);
        switch(prefix) {
          case 101: category = 'اسمدة'; break;
          case 102: category = 'مبيدات'; break;
          case 103: category = 'تقاوي وبذور'; break;
          case 104: category = 'زيوت ووقود'; break;
          case 105: category = 'شبكات ري'; break;
          case 106: category = 'معدات'; break;
          case 107: category = 'قطع غيار'; break;
          case 108: category = 'تعبئة وتغليف'; break;
          case 109: category = 'متنوعات'; break;
        }
        
        items.set(itemCode, {
          code: itemCode,
          name: typeof name === 'string' ? name.replace(/'/g, "''") : `صنف ${itemCode}`,
          category: category,
          warehouse: category,
          row: rowNum
        });
      }
    }
  }
}

console.log(`✅ تم العثور على ${items.size} صنف فريد\n`);

// توليد SQL
console.log('=== توليد SQL للاستيراد ===\n');

let sql = `-- Generated: ${new Date().toISOString()}\n`;
sql += `-- Total items: ${items.size}\n\n`;
sql += `DELETE FROM items WHERE company_id = 1;\n\n`;

let count = 0;
const postingGroups = {
  'اسمدة': 'FERT',
  'مبيدات': 'CHEM',
  'تقاوي وبذور': 'SEED',
  'زيوت ووقود': 'FERT',
  'شبكات ري': 'EQUIP',
  'معدات': 'EQUIP',
  'قطع غيار': 'EQUIP',
  'تعبئة وتغليف': 'FERT',
  'متنوعات': 'EQUIP'
};

for (const [code, item] of items) {
  const pg = postingGroups[item.category] || 'EQUIP';
  sql += `INSERT INTO items (code, company_id, name, unit, warehouse, is_active, prod_posting_group_code, created_at) VALUES `;
  sql += `(${code}, 1, '${item.name}', 'وحدة', '${item.category}', 1, '${pg}', datetime('now'));\n`;
  count++;
  
  if (count % 50 === 0) {
    sql += `\n-- Batch ${count / 50}\n`;
  }
}

sql += `\n-- Items imported: ${count}\n`;

// حفظ الملف
fs.writeFileSync('import_all_items.sql', sql);
console.log(`✅ تم حفظ SQL في import_all_items.sql`);
console.log(`   إجمالي الأصناف: ${count}`);

// حفظ التقرير
const report = {
  total_items: items.size,
  by_category: {}
};

for (const [code, item] of items) {
  report.by_category[item.category] = (report.by_category[item.category] || 0) + 1;
}

fs.writeFileSync('items_extraction_report.json', JSON.stringify(report, null, 2));
console.log(`\n📊 توزيع الأصناف:`);
for (const [cat, count] of Object.entries(report.by_category)) {
  console.log(`   ${cat}: ${count}`);
}
