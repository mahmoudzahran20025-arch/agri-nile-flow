const xlsx = require('xlsx');
const fs = require('fs');

const wb = xlsx.readFile('شجرة نواة المستقبل (1).xlsx', {sheetStubs: true});
const sheet = wb.Sheets[wb.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet, {header: 1});

console.log('=== استخراج جميع الحسابات النقدية والبنكية ===\n');

const cashAccounts = [];
const bankAccounts = [];

for (let i = 0; i < data.length; i++) {
  const row = data[i];
  if (!row || row.length < 4) continue;
  
  // الكود في العمود 2، الاسم في العمود 3
  const code = row[2];
  const name = row[3];
  
  if (typeof code === 'number' && typeof name === 'string') {
    const codeStr = String(code);
    const cleanName = name.trim().replace(/'/g, "''");
    
    // حسابات النقدية (140101xx)
    if (codeStr.startsWith('140101')) {
      cashAccounts.push({
        code: codeStr,
        name: cleanName,
        type: 'cash'
      });
    }
    // حسابات البنوك (140102xx, 140103xx, 140104xx, 140105xx, 140106xx)
    else if (codeStr.match(/^14010[2-6]/)) {
      bankAccounts.push({
        code: codeStr,
        name: cleanName,
        type: 'bank'
      });
    }
  }
}

console.log(`✅ الحسابات النقدية (خزائن): ${cashAccounts.length}`);
cashAccounts.forEach(acc => console.log(`   ${acc.code}: ${acc.name}`));

console.log(`\n✅ الحسابات البنكية: ${bankAccounts.length}`);
bankAccounts.forEach(acc => console.log(`   ${acc.code}: ${acc.name}`));

// توليد SQL
console.log('\n=== توليد SQL لإنشاء الحسابات ===\n');

let sql = '-- All Cash and Bank Accounts from Chart of Accounts\n';
sql += `-- Generated: ${new Date().toISOString()}\n`;
sql += `-- Total: ${cashAccounts.length + bankAccounts.length} accounts\n\n`;

// حذف الحسابات القديمة
sql += '-- Delete old accounts\n';
sql += `DELETE FROM bank_accounts WHERE company_id = 1;\n\n`;

// إضافة حسابات النقدية
if (cashAccounts.length > 0) {
  sql += '-- Cash Accounts (Treasury)\n';
  for (const acc of cashAccounts) {
    sql += `INSERT INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) `;
    sql += `VALUES (1, 'نقدية', '${acc.name}', '${acc.code}', 'EGP', '${acc.code}', 0, 1, datetime('now'));\n`;
  }
}

// إضافة حسابات البنوك
if (bankAccounts.length > 0) {
  sql += '\n-- Bank Accounts\n';
  for (const acc of bankAccounts) {
    sql += `INSERT INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) `;
    sql += `VALUES (1, 'بنك', '${acc.name}', '${acc.code}', 'EGP', '${acc.code}', 0, 1, datetime('now'));\n`;
  }
}

sql += `\n-- Total inserted: ${cashAccounts.length + bankAccounts.length} accounts\n`;

fs.writeFileSync('insert_all_bank_accounts.sql', sql);
console.log(`✅ تم حفظ SQL في insert_all_bank_accounts.sql`);

// تقرير
const report = {
  cash: { count: cashAccounts.length, accounts: cashAccounts },
  bank: { count: bankAccounts.length, accounts: bankAccounts },
  total: cashAccounts.length + bankAccounts.length
};

fs.writeFileSync('all_cash_accounts.json', JSON.stringify(report, null, 2));
console.log('📊 التقرير: all_cash_accounts.json');
