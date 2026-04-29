const xlsx = require('xlsx');
const fs = require('fs');

const wb = xlsx.readFile('مخازن نواة المستقبل2025-2026.xlsx', {sheetStubs: true});

console.log('=== استخراج الأصناف من شيت الكود (تحسين 2) ===\n');

const codeSheet = wb.Sheets['الكود'];
const dataSheet = wb.Sheets['البيانات'];

if (!codeSheet) {
  console.error('❌ شيت الكود غير موجود');
  process.exit(1);
}

// قراءة البيانات
const codeData = xlsx.utils.sheet_to_json(codeSheet, {header: 1});
const dataData = dataSheet ? xlsx.utils.sheet_to_json(dataSheet, {header: 1}) : [];

console.log(`شيت الكود: ${codeData.length} صف`);
console.log(`شيت البيانات: ${dataData.length} صف\n`);

// بناء خريطة الأصناف من شيت البيانات (item_code → warehouse)
const itemWarehouses = new Map();
for (const row of dataData.slice(1)) {
  const itemCode = row[10]; // __EMPTY_10 - عمود كود الصنف
  const warehouse = row[4]; // __EMPTY_4 - عمود المخزن
  if (typeof itemCode === 'number' && warehouse && typeof warehouse === 'string') {
    itemWarehouses.set(itemCode, warehouse.trim());
  }
}

console.log(`✅ تم استخراج ${itemWarehouses.size} ربط صنف-مخزن من البيانات\n`);

// استخراج الأصناف من شيت الكود
const items = new Map();
for (let i = 1; i < codeData.length; i++) {
  const row = codeData[i];
  if (!row || row.length < 3) continue;
  
  // كود الصنف في العمود A (أو العمود الأول الرقمي)
  let itemCode = null;
  let name = null;
  
  for (let j = 0; j < row.length; j++) {
    const val = row[j];
    if (typeof val === 'number' && val >= 1010000 && val <= 1099999) {
      itemCode = val;
      // الاسم في العمود التالي عادة
      name = row[j + 1];
      break;
    }
  }
  
  if (!itemCode) continue;
  
  // تنظيف الاسم
  const cleanName = typeof name === 'string' 
    ? name.replace(/'/g, "''").trim() 
    : `صنف ${itemCode}`;
  
  // تحديد المخزن
  const warehouse = itemWarehouses.get(itemCode);
  
  // تحديد الفئة من الكود
  const prefix = Math.floor(itemCode / 100000);
  let category = 'متنوعات';
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
  
  // الوحدة
  let unit = 'وحدة';
  if (cleanName.includes('كجم') || cleanName.includes('كيلو')) unit = 'كجم';
  else if (cleanName.includes('لتر')) unit = 'لتر';
  else if (cleanName.includes('جركن')) unit = 'جركن';
  else if (cleanName.includes('شيكارة')) unit = 'شيكارة';
  
  if (!items.has(itemCode)) {
    items.set(itemCode, {
      code: itemCode,
      name: cleanName,
      category: category,
      warehouse: warehouse || category,
      unit: unit,
      postingGroup: getPostingGroup(prefix)
    });
  }
}

function getPostingGroup(prefix) {
  switch(prefix) {
    case 101: return 'FERT'; // fertilizers
    case 102: return 'CHEM'; // chemicals
    case 103: return 'SEED'; // seeds
    case 104: return 'FERT'; // fuel as consumable
    case 105: return 'EQUIP'; // equipment
    case 106: return 'EQUIP'; // equipment
    case 107: return 'EQUIP'; // spare parts
    case 108: return 'FERT'; // packaging
    case 109: return 'EQUIP'; // miscellaneous
    default: return 'EQUIP';
  }
}

console.log(`✅ تم استخراج ${items.size} صنف فريد\n`);

// توليد SQL
let sql = `-- Items Import SQL - Generated: ${new Date().toISOString()}\n`;
sql += `-- Total items: ${items.size}\n\n`;
sql += `BEGIN TRANSACTION;\n\n`;

let count = 0;
for (const [code, item] of items) {
  sql += `INSERT OR REPLACE INTO items (code, company_id, name, unit, warehouse, is_active, prod_posting_group_code, updated_at) `;
  sql += `VALUES (${code}, 1, '${item.name}', '${item.unit}', '${item.warehouse}', 1, '${item.postingGroup}', datetime('now'));\n`;
  count++;
}

sql += `\nCOMMIT;\n`;
sql += `-- Imported: ${count} items\n`;

fs.writeFileSync('import_items_complete.sql', sql);
console.log(`✅ تم حفظ SQL في import_items_complete.sql`);

// تقرير
const report = {
  total: items.size,
  by_category: {},
  by_warehouse: {},
  sample_items: Array.from(items.values()).slice(0, 10)
};

for (const item of items.values()) {
  report.by_category[item.category] = (report.by_category[item.category] || 0) + 1;
  report.by_warehouse[item.warehouse] = (report.by_warehouse[item.warehouse] || 0) + 1;
}

fs.writeFileSync('items_report.json', JSON.stringify(report, null, 2));

console.log(`\n📊 توزيع الأصناف بالفئة:`);
for (const [cat, cnt] of Object.entries(report.by_category)) {
  console.log(`   ${cat}: ${cnt}`);
}

console.log(`\n📦 توزيع الأصناف بالمخزن (أول 10):`);
const sortedWarehouses = Object.entries(report.by_warehouse)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);
for (const [wh, cnt] of sortedWarehouses) {
  console.log(`   ${wh}: ${cnt}`);
}
