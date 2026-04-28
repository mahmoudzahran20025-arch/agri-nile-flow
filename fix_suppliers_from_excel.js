'use strict';
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DB_NAME = 'agri-nile-flow-data-lake';
const BASE = __dirname;

const wb = XLSX.readFile(path.join(BASE, 'الموردين والعملاء نواة المستقبل2025-2026.xlsx'));
const ws = wb.Sheets['الكود'];
const data = XLSX.utils.sheet_to_json(ws, { defval: '' });

const lines = data
  .filter(r => r['الكود'] && r['المورد'])
  .map(r => {
    const code = Number(r['الكود']);
    const name = String(r['المورد']).replace(/'/g, "''");
    const act  = String(r['النشاط'] || '').replace(/'/g, "''");
    return `UPDATE suppliers SET name='${name}', activity='${act}' WHERE code=${code} AND company_id=1;`;
  });

const sqlPath = path.join(BASE, 'fix_suppliers_from_excel.sql');
fs.writeFileSync(sqlPath, lines.join('\n') + '\n', 'utf8');
console.log(`Generated ${lines.length} UPDATE statements`);

execSync(`npx wrangler d1 execute ${DB_NAME} --remote --file "${sqlPath}" --yes`, {
  cwd: BASE, encoding: 'utf8', stdio: 'inherit', timeout: 60000
});

console.log('\nVerifying...');
const out = execSync(
  `npx wrangler d1 execute ${DB_NAME} --remote --json --command "SELECT code, name, hex(substr(name,1,1)) as hx FROM suppliers WHERE company_id=1 AND code!=85 ORDER BY code"`,
  { cwd: BASE, encoding: 'utf8', timeout: 30000 }
);
const rows = JSON.parse(out)[0]?.results || [];
let bad = 0;
rows.forEach(r => {
  const ok = r.hx === 'D8' || r.hx === 'D9' || r.hx === 'D8';
  if (!ok) bad++;
  console.log(`  [${r.code}] ${ok ? '✅' : '⚠️ '} ${r.name}`);
});
console.log(`\nCorrupted names remaining: ${bad}`);
