const xlsx = require('xlsx');
const fs = require('fs');

const wb = xlsx.readFile('C:\\Users\\mahmo\\Contacts\\CLAUDE_CO WORK MY WORK\\agri-nile-flow\\مخازن نواة المستقبل2025-2026.xlsx', {sheetStubs: true});

console.log('=== استخراج جميع الأصناف من ملف المخازن ===\n');

const dataSheet = wb.Sheets['البيانات'];
if (!dataSheet) {
  console.error('❌ شيت البيانات غير موجود');
  process.exit(1);
}

const data = xlsx.utils.sheet_to_json(dataSheet, {header: 1});
console.log(`إجمالي الصفوف في شيت البيانات: ${data.length}\n`);

// استخراج الأصناف الفريدة
const items = new Map();

for (let i = 1; i < data.length; i++) {
  const row = data[i];
  if (!row) continue;
  
  // كود الصنف في العمود 11 (index 11)
  const itemCode = row[11];
  const itemName = row[12]; // اسم الصنف في العمود 13
  const warehouse = row[5]; // المخزن في العمود 6
  
  if (typeof itemCode === 'number' && itemCode >= 1010000 && itemCode <= 1099999) {
    if (!items.has(itemCode)) {
      const cleanName = typeof itemName === 'string' ? itemName.trim().replace(/'/g, "''") : `صنف ${itemCode}`;
      const cleanWarehouse = typeof warehouse === 'string' ? warehouse.trim() : 'متنوعات';
      
      // تحديد الفئة
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
      
      items.set(itemCode, {
        code: itemCode,
        name: cleanName,
        unit: unit,
        warehouse: cleanWarehouse,
        category: category,
        postingGroup: getPostingGroup(prefix)
      });
    }
  }
}

function getPostingGroup(prefix) {
  switch(prefix) {
    case 101: return 'FERT';
    case 102: return 'CHEM';
    case 103: return 'SEED';
    case 104: return 'FERT';
    case 105: return 'EQUIP';
    case 106: return 'EQUIP';
    case 107: return 'EQUIP';
    case 108: return 'FERT';
    case 109: return 'EQUIP';
    default: return 'EQUIP';
  }
}

console.log(`✅ تم استخراج ${items.size} صنف فريد\n`);

// توليد SQL - تقسيم إلى batches صغيرة
const itemsArray = Array.from(items.values());
const batchSize = 50;
const batches = [];

for (let i = 0; i < itemsArray.length; i += batchSize) {
  batches.push(itemsArray.slice(i, i + batchSize));
}

console.log(`📦 سيتم إنشاء ${batches.length} batch\n`);

// إنشاء ملف SQL رئيسي
let mainSQL = `-- Items Import - Total: ${items.size} items\n`;
mainSQL += `-- Generated: ${new Date().toISOString()}\n\n`;

for (let i = 0; i < batches.length; i++) {
  mainSQL += `-- Batch ${i + 1}\n`;
  for (const item of batches[i]) {
    mainSQL += `INSERT OR REPLACE INTO items (code, company_id, name, unit, warehouse, is_active, prod_posting_group_code, created_at) `;
    mainSQL += `VALUES (${item.code}, 1, '${item.name}', '${item.unit}', '${item.warehouse}', 1, '${item.postingGroup}', datetime('now'));\n`;
  }
  mainSQL += '\n';
}

fs.writeFileSync('items_import_all.sql', mainSQL);
console.log(`✅ تم حفظ SQL في items_import_all.sql`);

// تقرير
const report = {
  total: items.size,
  by_category: {},
  by_warehouse: {}
};

for (const item of items.values()) {
  report.by_category[item.category] = (report.by_category[item.category] || 0) + 1;
  report.by_warehouse[item.warehouse] = (report.by_warehouse[item.warehouse] || 0) + 1;
}

fs.writeFileSync('items_full_report.json', JSON.stringify(report, null, 2));

console.log('\n📊 توزيع الأصناف:');
for (const [cat, count] of Object.entries(report.by_category)) {
  console.log(`   ${cat}: ${count}`);
}

console.log('\n📦 توزيع المخازن (أول 10):');
const sortedWarehouses = Object.entries(report.by_warehouse)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);
for (const [wh, count] of sortedWarehouses) {
  console.log(`   ${wh}: ${count}`);
}

console.log('\n🚀 للتنفيذ:');
console.log('   npx wrangler d1 execute agri-nile-flow-data-lake --remote --file=items_import_all.sql');
