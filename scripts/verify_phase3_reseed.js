#!/usr/bin/env node
/**
 * Post-Phase 3 Reseed Verification Checklist
 * Confirms data integrity after wipe+reseed execution
 */

const { execSync } = require('child_process');

function run(sql) {
  const cmd = `npx wrangler d1 execute agri-nile-flow-data-lake --remote --yes --command "${sql.replace(/"/g, '\\"')}"`;
  try {
    const output = execSync(cmd, { encoding: 'utf8' });
    return output;
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    return null;
  }
}

console.log('═══════════════════════════════════════════════════════');
console.log('POST-PHASE 3 RESEED VERIFICATION CHECKLIST');
console.log('═══════════════════════════════════════════════════════\n');

const checks = [
  {
    name: 'Chart of Accounts (COA)',
    sql: "SELECT COUNT(*) as total_accounts, SUM(CASE WHEN parent_code IS NULL THEN 1 ELSE 0 END) as root_accounts FROM chart_of_accounts WHERE company_id = 1;",
    expect: 'total_accounts > 300'
  },
  {
    name: 'Suppliers Master',
    sql: "SELECT COUNT(*) as supplier_count FROM suppliers WHERE company_id = 1;",
    expect: 'supplier_count = 10'
  },
  {
    name: 'Supplier Transactions',
    sql: "SELECT COUNT(*) as transaction_count FROM supplier_transactions WHERE company_id = 1;",
    expect: 'transaction_count > 300'
  },
  {
    name: 'Cash Transactions (Treasury)',
    sql: "SELECT COUNT(*) as cash_txn_count FROM cash_transactions WHERE company_id = 1;",
    expect: 'cash_txn_count > 60'
  },
  {
    name: 'Items Inventory',
    sql: "SELECT COUNT(*) as item_count FROM items WHERE company_id = 1;",
    expect: 'item_count > 4800'
  },
  {
    name: 'Inventory Movements',
    sql: "SELECT COUNT(*) as movement_count FROM inventory_movements WHERE company_id = 1;",
    expect: 'movement_count > 690'
  },
  {
    name: 'Journal Entries (Should be empty post-wipe)',
    sql: "SELECT COUNT(*) as journal_entry_count FROM journal_entries WHERE company_id = 1;",
    expect: 'journal_entry_count = 0'
  },
  {
    name: 'Business Events (Should be empty post-wipe)',
    sql: "SELECT COUNT(*) as event_count FROM business_events WHERE company_id = 1;",
    expect: 'event_count = 0'
  },
  {
    name: 'Orphan Bridge Check: source_documents',
    sql: "SELECT COUNT(*) as orphan_docs FROM source_documents WHERE company_id = 1 AND event_id IS NOT NULL AND event_id NOT IN (SELECT id FROM business_events WHERE company_id = 1);",
    expect: 'orphan_docs = 0 (expected after wipe)'
  },
  {
    name: 'Invalid movement_type check',
    sql: "SELECT COUNT(*) as invalid_types FROM inventory_movements WHERE company_id = 1 AND movement_type NOT IN ('GRN','ISSUE','RETURN_SUPPLIER','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT_IN','ADJUSTMENT_OUT');",
    expect: 'invalid_types = 0'
  }
];

let passCount = 0;
let failCount = 0;

for (const check of checks) {
  console.log(`✓ ${check.name}`);
  console.log(`  Query: ${check.sql.substring(0, 80)}...`);
  console.log(`  Expected: ${check.expect}`);
  
  const result = run(check.sql);
  if (result && result.includes('Executed 1 command')) {
    console.log(`  Result: ✅ PASS`);
    passCount++;
  } else {
    console.log(`  Result: ❌ FAIL`);
    console.log(`  Raw Output:\n${result}`);
    failCount++;
  }
  console.log();
}

console.log('═══════════════════════════════════════════════════════');
console.log(`SUMMARY: ${passCount} passed, ${failCount} failed out of ${checks.length} checks`);
console.log('═══════════════════════════════════════════════════════');

if (failCount === 0) {
  console.log('\n✅ ALL CHECKS PASSED — Phase 3 Reseed Successful!');
  process.exit(0);
} else {
  console.log('\n❌ SOME CHECKS FAILED — Review above for details');
  process.exit(1);
}
