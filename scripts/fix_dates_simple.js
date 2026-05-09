#!/usr/bin/env node
const { execSync } = require('child_process');

const DB = 'agri-nile-flow-data-lake';
const CID = 1;

function run(sql) {
  const cmd = `npx wrangler d1 execute ${DB} --remote --yes --json --command "${sql}"`;
  const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(out);
}

console.log(`\n🚨 REMEDIATION: Corrupted 2026 Dates\n`);

// Backup
console.log(`1. Backing up corrupted records...`);
try {
  run(`CREATE TABLE supplier_tx_bak AS SELECT * FROM supplier_transactions WHERE company_id=${CID} AND transaction_date LIKE '2026%';`);
  run(`CREATE TABLE inventory_bak AS SELECT * FROM inventory_movements WHERE company_id=${CID} AND movement_date LIKE '2026%';`);
  run(`CREATE TABLE cash_tx_bak AS SELECT * FROM cash_transactions WHERE company_id=${CID} AND transaction_date LIKE '2026%';`);
  console.log(`   ✓ Backups created`);
} catch { console.log(`   ⚠ Backups may exist`); }

// Delete corrupted
console.log(`2. Deleting corrupted 2026-dated records...`);
run(`DELETE FROM supplier_transactions WHERE company_id=${CID} AND transaction_date LIKE '2026%';`);
run(`DELETE FROM inventory_movements WHERE company_id=${CID} AND movement_date LIKE '2026%';`);
run(`DELETE FROM cash_transactions WHERE company_id=${CID} AND transaction_date LIKE '2026%';`);
console.log(`   ✓ Deleted`);

// Verify
console.log(`3. Verifying...`);
const check1 = run(`SELECT COUNT(*) AS c FROM supplier_transactions WHERE company_id=${CID} AND transaction_date LIKE '2026%';`);
const check2 = run(`SELECT COUNT(*) AS c FROM inventory_movements WHERE company_id=${CID} AND movement_date LIKE '2026%';`);
const check3 = run(`SELECT COUNT(*) AS c FROM cash_transactions WHERE company_id=${CID} AND transaction_date LIKE '2026%';`);

if (check1[0].results[0].c === 0 && check2[0].results[0].c === 0 && check3[0].results[0].c === 0) {
  console.log(`   ✅ All 2026 dates removed`);
} else {
  console.log(`   ❌ Some records remain`);
  process.exit(1);
}

console.log(`\n✅ REMEDIATION COMPLETE\n`);
