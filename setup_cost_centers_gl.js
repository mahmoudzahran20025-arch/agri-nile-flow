const xlsx = require('xlsx');
const fs = require('fs');

const wb = xlsx.readFile('مخازن نواة المستقبل2025-2026.xlsx', {sheetStubs: true});

console.log('=== ربط مراكز التكلفة بحسابات GL ===\n');

const centersSheet = wb.Sheets['تكاليف مراكز'];
if (!centersSheet) {
  console.error('❌ شيت تكاليف مراكز غير موجود');
  process.exit(1);
}

const data = xlsx.utils.sheet_to_json(centersSheet, {header: 1});
console.log(`إجمالي صفوف مراكز التكلفة: ${data.length}\n`);

// استخراج المراكز الفريدة
const centers = new Map();
for (let i = 1; i < data.length; i++) {
  const row = data[i];
  if (!row || row.length < 2) continue;
  
  // البحث عن كود المركز (أرقام 1006xxx)
  for (const val of row) {
    if (typeof val === 'number' && val >= 1006000 && val <= 1006999) {
      const centerCode = val;
      const name = row.find(v => typeof v === 'string' && v.length > 2) || `مركز ${centerCode}`;
      
      if (!centers.has(centerCode)) {
        centers.set(centerCode, {
          code: centerCode,
          name: name.replace(/'/g, "''"),
          gl_account: determineGLAccount(centerCode)
        });
      }
    }
  }
}

function determineGLAccount(centerCode) {
  // مراكز المشروع (1006001 - 1006010) → حساب تكلفة زراعية
  if (centerCode >= 1006001 && centerCode <= 1006010) {
    return '51101001'; // تكلفة زراعية - مشروع
  }
  // مراكز الإدارة (1006100+) → حساب إدارية
  if (centerCode >= 1006100) {
    return '51200001'; // مصروفات إدارية
  }
  // افتراضي
  return '51990001'; // تكاليف غير مباشرة
}

console.log(`✅ تم استخراج ${centers.size} مركز تكلفة\n`);

// توليد SQL
let sql = `-- Cost Centers GL Mapping SQL\n`;
sql += `-- Generated: ${new Date().toISOString()}\n`;
sql += `-- Total centers: ${centers.size}\n\n`;
sql += `BEGIN TRANSACTION;\n\n`;

// إنشاء/تحديث مراكز التكلفة
sql += `-- Insert/Update Cost Centers\n`;
for (const [code, center] of centers) {
  sql += `INSERT OR REPLACE INTO cost_centers (code, company_id, name, is_active, created_at) `;
  sql += `VALUES (${code}, 1, '${center.name}', 1, datetime('now'));\n`;
}

// إنشاء علاقات المراكز بالحسابات
sql += `\n-- Link Centers to GL Accounts (via posting_rules or center_accounts)\n`;
sql += `DELETE FROM center_account_mapping WHERE company_id = 1;\n`;

for (const [code, center] of centers) {
  sql += `INSERT INTO center_account_mapping (company_id, center_code, account_code, mapping_type, created_at) `;
  sql += `VALUES (1, ${code}, '${center.gl_account}', 'expense', datetime('now'));\n`;
}

sql += `\nCOMMIT;\n`;

fs.writeFileSync('setup_cost_centers_gl.sql', sql);
console.log(`✅ تم حفظ SQL في setup_cost_centers_gl.sql`);

// تقرير
const report = {
  total_centers: centers.size,
  by_gl_account: {},
  centers: Array.from(centers.values()).slice(0, 20)
};

for (const center of centers.values()) {
  report.by_gl_account[center.gl_account] = (report.by_gl_account[center.gl_account] || 0) + 1;
}

fs.writeFileSync('cost_centers_report.json', JSON.stringify(report, null, 2));

console.log(`\n📊 توزيع المراكز على حسابات GL:`);
for (const [acc, cnt] of Object.entries(report.by_gl_account)) {
  console.log(`   ${acc}: ${cnt} مركز`);
}

console.log(`\n📝 ملاحظة:`);
console.log(`   - 51101001 = تكاليف زراعية مباشرة (المشروع)`);
console.log(`   - 51200001 = مصروفات إدارية`);
console.log(`   - 51990001 = تكاليف غير مباشرة`);
