#!/usr/bin/env node
const { execSync } = require('child_process');

const DB = 'agri-nile-flow-data-lake';
const CID = 1;

function run(sql) {
  const cmd = `npx wrangler d1 execute ${DB} --remote --yes --json --command "${sql}"`;
  const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(out);
}

console.log(`\n🗑️  PHASE 4 DELETION: Batch approach\n`);

try {
  // First, get list of entry IDs
  console.log(`1. Getting entry IDs...`);
  const result = run(`SELECT id FROM journal_entries WHERE company_id=${CID} AND ref_type IN ('supplier_transaction','cash_transaction','inventory_movement') LIMIT 100;`);
  const ids = result[0].results.map(r => r.id);
  console.log(`   Found ${ids.length} entries`);
  
  if (ids.length === 0) {
    console.log(`   ✅ No entries to delete`);
    process.exit(0);
  }
  
  // Delete in batches
  console.log(`2. Deleting in batches...`);
  const batchSize = 50;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const idStr = batch.join(',');
    run(`DELETE FROM journal_entries WHERE id IN (${idStr});`);
    console.log(`   ✓ Deleted ${Math.min(batchSize, ids.length - i)} entries`);
  }
  
  console.log(`\n✅ Phase 4 deletion complete\n`);
} catch (e) {
  console.error(`❌ Error:`, e.message);
  process.exit(1);
}
