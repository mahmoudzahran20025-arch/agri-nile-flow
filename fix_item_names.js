const fs = require('fs');
const { execSync } = require('child_process');

const DB_NAME = 'agri-nile-flow-data-lake';

function runD1(sql) {
  const compactSql = sql.replace(/\s+/g, ' ').trim();
  const escapedSql = compactSql.replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --yes --command "${escapedSql}"`;
  return execSync(cmd, { encoding: 'utf8' });
}

function findRef(obj, keyName) {
  for (const k in obj) {
    if (k.includes(keyName)) return obj[k];
  }
  return null;
}

const data = JSON.parse(fs.readFileSync('مخازن_نواة_المستقبل_2025-2026.json', 'utf8'));
const refs = findRef(data, 'الأكواد_المرجعية');
const itemsObj = findRef(refs, 'الأصناف');
const list = itemsObj['البيانات'] || itemsObj['المعاملات'];

console.log(`Processing ${list.length} reference items...`);

let updates = [];
list.forEach(item => {
  const code = item['كود_الصنف'];
  const name = item['الصنف'];
  if (code && name) {
    const escapedName = name.replace(/'/g, "''");
    updates.push(`UPDATE items SET name='${escapedName}' WHERE code=${code} AND company_id=1;`);
  }
});

// Execute in chunks
const chunkSize = 100;
for (let i = 0; i < updates.length; i += chunkSize) {
  const chunk = updates.slice(i, i + chunkSize);
  const sql = chunk.join('\n');
  fs.writeFileSync('temp_updates.sql', sql);
  console.log(`Executing update chunk ${i / chunkSize + 1}...`);
  execSync(`npx wrangler d1 execute ${DB_NAME} --remote --yes --file temp_updates.sql`, { stdio: 'inherit' });
}

fs.unlinkSync('temp_updates.sql');
console.log('Item names updated successfully.');
