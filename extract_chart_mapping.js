const xlsx = require('xlsx');
const fs = require('fs');

console.log('=== استخراج Mapping من شجرة الحسابات ===\n');

const wb = xlsx.readFile('شجرة نواة المستقبل (1).xlsx', {sheetStubs: true});
const sheet = wb.Sheets[wb.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet, {header: 1});

// استخراج Mapping
const mappingData = [];
const uniqueMappings = new Set();

for (let i = 1; i < data.length; i++) {
  const row = data[i];
  if (!row || row.length < 4) continue;
  
  const mapping = row[0];        // العمود 0: Mapping عام
  const mappingDetailed = row[1]; // العمود 1: Mapping تفصيلي
  const accountCode = row[2];     // العمود 2: رقم الحساب
  const accountName = row[3];     // العمود 3: اسم الحساب
  
  // فقط الحسابات ذات الكود الرقمي الكامل (8 أرقام)
  if (typeof accountCode === 'number' && accountCode >= 10000000) {
    const codeStr = String(accountCode);
    const mappingValue = mapping && String(mapping).trim() !== '' ? String(mapping).trim() : null;
    const mappingDetailedValue = mappingDetailed && String(mappingDetailed).trim() !== '' ? String(mappingDetailed).trim() : null;
    
    if (mappingValue) uniqueMappings.add(mappingValue);
    
    mappingData.push({
      code: codeStr,
      name: accountName && String(accountName).trim(),
      mapping: mappingValue,
      mappingDetailed: mappingDetailedValue,
      prefix: codeStr.substring(0, 2) // أول رقمين للتصنيف
    });
  }
}

console.log(`✅ تم استخراج ${mappingData.length} حساب`);
console.log(`✅ عدد التصنيفات الفريدة: ${uniqueMappings.size}`);

// عرض التصنيفات
console.log('\n📋 التصنيفات المتاحة:');
Array.from(uniqueMappings).sort().forEach((m, i) => {
  const count = mappingData.filter(d => d.mapping === m).length;
  console.log(`  ${i + 1}. ${m} (${count} حساب)`);
});

// توليد SQL لتحديث chart_of_accounts
console.log('\n=== توليد SQL لتحديث قاعدة البيانات ===\n');

let sql = '-- Update chart_of_accounts with mapping data\n';
sql += `-- Generated: ${new Date().toISOString()}\n\n`;

// إنشاء جدول mapping مؤقت أو تحديث مباشر
sql += '-- Add mapping column if not exists\n';
sql += `ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS account_group TEXT;\n\n`;

// تحديث كل حساب
for (const item of mappingData) {
  if (item.mapping) {
    sql += `UPDATE chart_of_accounts SET account_group = '${item.mapping.replace(/'/g, "''")}' WHERE code = '${item.code}' AND company_id = 1;\n`;
  }
}

sql += `\n-- Total accounts updated: ${mappingData.filter(d => d.mapping).length}\n`;

fs.writeFileSync('update_chart_mapping.sql', sql);
console.log(`✅ تم حفظ SQL في update_chart_mapping.sql`);

// حفظ JSON للتحليل
fs.writeFileSync('chart_mapping_data.json', JSON.stringify({
  total: mappingData.length,
  withMapping: mappingData.filter(d => d.mapping).length,
  uniqueGroups: Array.from(uniqueMappings).sort(),
  accounts: mappingData
}, null, 2));
console.log(`✅ البيانات محفوظة في chart_mapping_data.json`);

// تحليل حسب البداية
console.log('\n📊 توزيع الحسابات حسب البداية:');
const byPrefix = {};
for (const item of mappingData) {
  const prefix = item.code.substring(0, 2);
  if (!byPrefix[prefix]) byPrefix[prefix] = { count: 0, mapping: item.mapping };
  byPrefix[prefix].count++;
}

Object.entries(byPrefix).sort().forEach(([prefix, data]) => {
  console.log(`  ${prefix}xxxxx: ${data.count} حساب (${data.mapping || 'بدون تصنيف'})`);
});

console.log('\n🚀 للتنفيذ: npx wrangler d1 execute agri-nile-flow-data-lake --remote --file=update_chart_mapping.sql');
