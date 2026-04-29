const xlsx = require('xlsx');
const fs = require('fs');

const wb = xlsx.readFile('شجرة نواة المستقبل (1).xlsx', {sheetStubs: true});

console.log('=== استخراج الحسابات النقدية والبنكية من شجرة الحسابات ===\n');

const sheet = wb.Sheets[wb.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet, {header: 1});

console.log(`إجمالي الصفوف: ${data.length}\n`);

// استخراج حسابات النقدية والبنوك (1401xxxx)
const cashAccounts = [];
const bankAccounts = [];

for (let i = 1; i < data.length; i++) {
  const row = data[i];
  if (!row || row.length < 3) continue;
  
  const code = row[0]; // عمود كود الحساب
  const name = row[1]; // عمود اسم الحساب
  
  if (typeof code === 'number' && typeof name === 'string') {
    const codeStr = String(code);
    
    // حسابات النقدية (140101xxx)
    if (codeStr.startsWith('140101')) {
      cashAccounts.push({
        code: codeStr,
        name: name.trim(),
        type: 'cash'
      });
    }
    // حسابات البنوك (140102xxx, 140103xxx, 140104xxx, 140105xxx)
    else if (codeStr.startsWith('140102') || codeStr.startsWith('140103') || 
             codeStr.startsWith('140104') || codeStr.startsWith('140105')) {
      bankAccounts.push({
        code: codeStr,
        name: name.trim(),
        type: 'bank'
      });
    }
  }
}

console.log(`✅ الحسابات النقدية (خزائن): ${cashAccounts.length}`);
cashAccounts.forEach(acc => console.log(`   ${acc.code}: ${acc.name}`));

console.log(`\n✅ الحسابات البنكية: ${bankAccounts.length}`);
bankAccounts.slice(0, 15).forEach(acc => console.log(`   ${acc.code}: ${acc.name}`));
if (bankAccounts.length > 15) console.log(`   ... و ${bankAccounts.length - 15} أخرى`);

// توليد SQL لإنشاء الحسابات في bank_accounts
console.log('\n=== توليد SQL ===\n');

let sql = '-- Cash and Bank Accounts from Chart of Accounts\n';
sql += `-- Generated: ${new Date().toISOString()}\n\n`;

// إنشاء الحسابات النقدية
if (cashAccounts.length > 0) {
  sql += '-- Cash Accounts (Treasury)\n';
  for (const acc of cashAccounts) {
    sql += `INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) `;
    sql += `VALUES (1, 'نقدية', '${acc.name.replace(/'/g, "''")}', '${acc.code}', 'EGP', '${acc.code}', 0, 1, datetime('now'));\n`;
  }
}

// إنشاء الحسابات البنكية
if (bankAccounts.length > 0) {
  sql += '\n-- Bank Accounts\n';
  for (const acc of bankAccounts) {
    sql += `INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) `;
    sql += `VALUES (1, 'بنك', '${acc.name.replace(/'/g, "''")}', '${acc.code}', 'EGP', '${acc.code}', 0, 1, datetime('now'));\n`;
  }
}

fs.writeFileSync('create_all_bank_accounts.sql', sql);
console.log(`✅ تم حفظ SQL في create_all_bank_accounts.sql`);
console.log(`   إجمالي الحسابات: ${cashAccounts.length + bankAccounts.length}`);

// تقرير
const report = {
  cash_accounts: cashAccounts.length,
  bank_accounts: bankAccounts.length,
  total: cashAccounts.length + bankAccounts.length,
  cash_details: cashAccounts,
  bank_details: bankAccounts.slice(0, 20)
};

fs.writeFileSync('cash_accounts_report.json', JSON.stringify(report, null, 2));
console.log('\n📊 التقرير محفوظ في cash_accounts_report.json');
