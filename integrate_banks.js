const xlsx = require('xlsx');
const fs = require('fs');

console.log('=== تكامل البنوك وربط حركات الخزينة ===\n');

const wb = xlsx.readFile('خزينة نواة المستقبل 2025-2026.xlsx', {sheetStubs: true});

const treasurySheet = wb.Sheets['البيان'];
if (!treasurySheet) {
  console.error('❌ شيت البيان غير موجود');
  process.exit(1);
}

const data = xlsx.utils.sheet_to_json(treasurySheet, {header: 1});
console.log(`إجمالي حركات الخزينة: ${data.length}\n`);

// استخراج الحسابات البنكية الفريدة من الحركات
const bankAccounts = new Map();
const transactions = [];

for (let i = 1; i < Math.min(data.length, 100); i++) {
  const row = data[i];
  if (!row || row.length < 10) continue;
  
  // العمود B (index 1) يحتوي على نوع الحركة (د/م)
  // العمود C (index 2) أو ما بعده قد يحتوي على بيانات الحساب
  const direction = row[1]; // د = قبض (ايراد), م = صرف (دفع)
  const narration = row.find((v, idx) => idx > 2 && typeof v === 'string' && v.length > 5);
  
  // تحديد نوع الحساب من البيان
  let bankType = 'cash';
  let accountCode = '14010101'; // صندوق افتراضي
  
  if (narration) {
    if (narration.includes('بنك') || narration.includes('تحويل')) {
      bankType = 'bank';
      accountCode = '14010201'; // البنك الأهلي
    }
    if (narration.includes('جهاز') || narration.includes('مستقبل مصر')) {
      accountCode = '14010301'; // حسابات خاصة
    }
  }
  
  transactions.push({
    row: i,
    direction,
    narration: narration || '',
    bank_type: bankType,
    account_code: accountCode
  });
}

// تعريف الحسابات البنكية
const bankAccountsDef = [
  { code: '14010101', name: 'صندوق النقدية الرئيسي', type: 'cash', is_default: 1 },
  { code: '14010201', name: 'البنك الأهلي - الحساب الجاري', type: 'bank', is_default: 0 },
  { code: '14010301', name: 'حساب جهاز مستقبل مصر', type: 'special', is_default: 0 }
];

// توليد SQL
let sql = `-- Bank Accounts Integration SQL\n`;
sql += `-- Generated: ${new Date().toISOString()}\n\n`;
sql += `BEGIN TRANSACTION;\n\n`;

// إنشاء حسابات البنوك
sql += `-- Create Bank Accounts\n`;
for (const acc of bankAccountsDef) {
  sql += `INSERT OR REPLACE INTO bank_accounts (account_code, company_id, name, account_type, is_active, is_default, created_at) `;
  sql += `VALUES ('${acc.code}', 1, '${acc.name}', '${acc.type}', 1, ${acc.is_default}, datetime('now'));\n`;
}

// تحديث حركات الخزينة - إضافة bank_account_id
sql += `\n-- Update Cash Transactions with Bank Account\n`;
sql += `-- Default all to cash account (14010101)\n`;
sql += `UPDATE cash_transactions SET bank_account_id = '14010101' WHERE company_id = 1 AND bank_account_id IS NULL;\n`;

// تحديث الحركات الخاصة
sql += `\n-- Update special transactions\n`;
sql += `UPDATE cash_transactions SET bank_account_id = '14010301' `;
sql += `WHERE company_id = 1 AND narration LIKE '%جهاز مستقبل مصر%';\n`;

sql += `\nCOMMIT;\n`;

fs.writeFileSync('integrate_banks.sql', sql);
console.log(`✅ تم حفظ SQL في integrate_banks.sql`);

console.log(`\n📊 ملخص الحسابات:`);
for (const acc of bankAccountsDef) {
  console.log(`   ${acc.code}: ${acc.name} (${acc.type}) ${acc.is_default ? '✓ افتراضي' : ''}`);
}

console.log(`\n📝 ملاحظات:`);
console.log(`   - صندوق النقدية (14010101) هو الحساب الافتراضي`);
console.log(`   - البنك الأهلي (14010201) للتحويلات البنكية`);
console.log(`   - حساب جهاز مستقبل مصر (14010301) للإيداعات الخاصة`);
