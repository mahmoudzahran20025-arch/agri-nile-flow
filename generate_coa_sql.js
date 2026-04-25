const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const filePath = path.resolve('شجرة نواة المستقبل (1).xlsx');
const workbook = xlsx.readFile(filePath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

const sqlLines = [
  '-- Auto-generated COA Import Script',
  '-- Clearing existing chart of accounts for company 1 (optional, depends on if we want fresh start)',
  'DELETE FROM chart_of_accounts WHERE company_id = 1;'
];

const company_id = 1;

// Level 1 Headers (Base)
const baseHeaders = [
  { code: '1', name: 'الأصول', type: 'asset', bal: 'debit' },
  { code: '2', name: 'الالتزامات', type: 'liability', bal: 'credit' },
  { code: '3', name: 'حقوق الملكية', type: 'equity', bal: 'credit' },
  { code: '4', name: 'الإيرادات', type: 'revenue', bal: 'credit' },
  { code: '5', name: 'المصروفات', type: 'expense', bal: 'debit' },
  { code: '6', name: 'تكاليف النشاط', type: 'expense', bal: 'debit' }
];

for (const bh of baseHeaders) {
  sqlLines.push(`INSERT INTO chart_of_accounts (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active) VALUES (${company_id}, '${bh.code}', '${bh.name}', '${bh.type}', '${bh.bal}', NULL, 1, 1, 1);`);
}

// Process rows (skip header row 0)
for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  if (!row[2] || !row[3]) continue;
  
  let code = String(row[2]).trim();
  let name = String(row[3]).trim().replace(/'/g, "''"); // escape quotes for SQL
  
  // Determine Type & Balance
  let type = 'expense';
  let bal = 'debit';
  const firstDigit = code.charAt(0);
  
  if (firstDigit === '1') { type = 'asset'; bal = 'debit'; }
  else if (firstDigit === '2') { type = 'liability'; bal = 'credit'; }
  else if (firstDigit === '3') { type = 'equity'; bal = 'credit'; }
  else if (firstDigit === '4') { type = 'revenue'; bal = 'credit'; }
  else { type = 'expense'; bal = 'debit'; }
  
  // Determine Level & Parent
  let level = 1;
  let parent = null;
  let is_header = 0;
  
  if (code.length === 2) {
    level = 2;
    parent = code.substring(0, 1);
    is_header = 1;
  } else if (code.length === 4) {
    level = 3;
    parent = code.substring(0, 2);
    is_header = 1;
  } else if (code.length >= 6) {
    level = 4;
    parent = code.substring(0, 4);
    is_header = 0; // Leaf
  }
  
  sqlLines.push(`INSERT INTO chart_of_accounts (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active) VALUES (${company_id}, '${code}', '${name}', '${type}', '${bal}', '${parent}', ${level}, ${is_header}, 1);`);
}

// Write to file
fs.writeFileSync('import_coa.sql', sqlLines.join('\n'));
console.log(`Generated import_coa.sql with ${sqlLines.length} statements.`);
