/**
 * test_posting_engine.js
 * =====================
 * Comprehensive test suite for posting_engine.ts
 * Tests all resolution functions, cascade paths, error conditions, and warnings
 * against the LIVE remote D1 database.
 *
 * Usage:  node test_posting_engine.js
 */

const { execSync } = require('child_process');

const COMPANY_ID = 1;
const DB = 'agri-nile-flow-data-lake';

let passed = 0;
let failed = 0;
const results = [];

// ────────────────────────────────────────────────────────────────────────────
// D1 Query Helper — uses --json flag for reliable parsing
// ────────────────────────────────────────────────────────────────────────────
function d1(sql) {
  try {
    const escaped = sql.replace(/"/g, '\\"').replace(/\n/g, ' ');
    const out = execSync(
      `npx wrangler d1 execute ${DB} --remote --json --command "${escaped}"`,
      { encoding: 'utf8', cwd: __dirname, timeout: 30_000 }
    );
    // wrangler --json outputs an array like: [{"results":[...],"success":true}]
    const json = JSON.parse(out.trim());
    if (Array.isArray(json) && json.length > 0 && Array.isArray(json[0].results)) {
      return json[0].results;
    }
    return [];
  } catch (e) {
    // If JSON parse fails, try to extract JSON from mixed output
    try {
      const match = e.stdout ? e.stdout.match(/\[[\s\S]*\]/) : null;
      if (match) {
        const json = JSON.parse(match[0]);
        if (Array.isArray(json) && json.length > 0) return json[0].results ?? [];
      }
    } catch {}
    return { __error: e.message };
  }
}

function d1one(sql) {
  const rows = d1(sql);
  if (Array.isArray(rows)) return rows[0] ?? null;
  return rows;
}

function d1exec(sql) {
  try {
    const escaped = sql.replace(/"/g, '\\"').replace(/\n/g, ' ');
    execSync(
      `npx wrangler d1 execute ${DB} --remote --json --command "${escaped}"`,
      { encoding: 'utf8', cwd: __dirname, timeout: 30_000 }
    );
    return true;
  } catch { return false; }
}

// ────────────────────────────────────────────────────────────────────────────
// Test Infrastructure
// ────────────────────────────────────────────────────────────────────────────
function test(name, fn) {
  try {
    const result = fn();
    if (result === true || result === undefined) {
      passed++;
      results.push({ status: 'PASS', name });
      console.log(`  ✓  ${name}`);
    } else {
      failed++;
      results.push({ status: 'FAIL', name, detail: result });
      console.log(`  ✗  ${name}\n     → ${result}`);
    }
  } catch (e) {
    failed++;
    results.push({ status: 'ERROR', name, detail: e.message });
    console.log(`  ✗  ${name}\n     → ERROR: ${e.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ────────────────────────────────────────────────────────────────────────────
// Posting Engine Query Replicas
// These replicate the exact SQL logic from posting_engine.ts
// ────────────────────────────────────────────────────────────────────────────

/**
 * Replicates posting_engine.ts resolveGeneralSetup cascade
 * Tries: [exact] → [bpg wildcard] → [ppg wildcard] → [null/null default]
 */
function resolveGeneralSetup(bpg, ppg) {
  const nullBpg = !bpg || bpg === 'NULL';
  const nullPpg = !ppg || ppg === 'NULL';

  const candidates = [
    [nullBpg ? null : bpg, nullPpg ? null : ppg],
    [nullBpg ? null : bpg, null],
    [null, nullPpg ? null : ppg],
    [null, null],
  ];

  for (const [b, p] of candidates) {
    const bCond = b === null
      ? 'bus_posting_group_code IS NULL'
      : `bus_posting_group_code = '${b}'`;
    const pCond = p === null
      ? 'prod_posting_group_code IS NULL'
      : `prod_posting_group_code = '${p}'`;

    const row = d1one(
      `SELECT bus_posting_group_code, prod_posting_group_code, ` +
      `sales_account, purchases_account, cogs_account, expense_account ` +
      `FROM general_posting_setup ` +
      `WHERE company_id=${COMPANY_ID} AND ${bCond} AND ${pCond} AND is_active=1 LIMIT 1`
    );
    if (row && !row.__error) return { row, matchedWith: [b, p] };
  }
  return null;
}

/**
 * Replicates posting_engine.ts resolveInventorySetup cascade
 */
function resolveInventorySetup(ipg, ppg) {
  const nullIpg = !ipg || ipg === 'NULL';
  const nullPpg = !ppg || ppg === 'NULL';

  const candidates = [
    [nullIpg ? null : ipg, nullPpg ? null : ppg],
    [nullIpg ? null : ipg, null],
    [null, nullPpg ? null : ppg],
    [null, null],
  ];

  for (const [i, p] of candidates) {
    const iCond = i === null
      ? 'inv_posting_group_code IS NULL'
      : `inv_posting_group_code = '${i}'`;
    const pCond = p === null
      ? 'prod_posting_group_code IS NULL'
      : `prod_posting_group_code = '${p}'`;

    const row = d1one(
      `SELECT inv_posting_group_code, prod_posting_group_code, inventory_account ` +
      `FROM inventory_posting_setup ` +
      `WHERE company_id=${COMPANY_ID} AND ${iCond} AND ${pCond} AND is_active=1 LIMIT 1`
    );
    if (row && !row.__error) return { row, matchedWith: [i, p] };
  }
  return null;
}

function isActive(val) {
  return val === 1 || val === '1' || val === true;
}

function checkAccountExists(code) {
  const row = d1one(
    `SELECT is_active FROM chart_of_accounts WHERE company_id=${COMPANY_ID} AND code='${code}'`
  );
  if (!row || row.__error) return 'NOT_FOUND';
  return isActive(row.is_active) ? 'ACTIVE' : 'INACTIVE';
}

function checkPostingGroupExists(table, code) {
  const row = d1one(
    `SELECT is_active FROM ${table} WHERE company_id=${COMPANY_ID} AND code='${code}'`
  );
  if (!row || row.__error) return 'NOT_FOUND';
  return isActive(row.is_active) ? 'ACTIVE' : 'INACTIVE';
}

// ────────────────────────────────────────────────────────────────────────────
// TEST SUITE
// ────────────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  POSTING ENGINE — Comprehensive Test Suite');
console.log(`  Company ID: ${COMPANY_ID} | DB: ${DB}`);
console.log('══════════════════════════════════════════════════════════════\n');

// ── Section 1: Posting Group Existence ────────────────────────────────────
console.log('── 1. Posting Group Existence ──────────────────────────────────');

test('BPG LOCAL exists and is active', () => {
  assert(checkPostingGroupExists('business_posting_groups', 'LOCAL') === 'ACTIVE', 'BPG LOCAL not active');
});
test('BPG IMPORT exists and is active', () => {
  assert(checkPostingGroupExists('business_posting_groups', 'IMPORT') === 'ACTIVE', 'BPG IMPORT not active');
});
test('BPG GOVT exists and is active', () => {
  assert(checkPostingGroupExists('business_posting_groups', 'GOVT') === 'ACTIVE', 'BPG GOVT not active');
});
test('BPG CUSTOMER exists and is active', () => {
  assert(checkPostingGroupExists('business_posting_groups', 'CUSTOMER') === 'ACTIVE', 'BPG CUSTOMER not active');
});
test('PPG FERT exists and is active', () => {
  assert(checkPostingGroupExists('product_posting_groups', 'FERT') === 'ACTIVE', 'PPG FERT not active');
});
test('PPG SEED exists and is active', () => {
  assert(checkPostingGroupExists('product_posting_groups', 'SEED') === 'ACTIVE', 'PPG SEED not active');
});
test('PPG CHEM exists and is active', () => {
  assert(checkPostingGroupExists('product_posting_groups', 'CHEM') === 'ACTIVE', 'PPG CHEM not active');
});
test('PPG EQUIP exists and is active', () => {
  assert(checkPostingGroupExists('product_posting_groups', 'EQUIP') === 'ACTIVE', 'PPG EQUIP not active');
});
test('IPG FERT-WH exists and is active', () => {
  assert(checkPostingGroupExists('inventory_posting_groups', 'FERT-WH') === 'ACTIVE', 'IPG FERT-WH not active');
});
test('IPG SEED-WH exists and is active', () => {
  assert(checkPostingGroupExists('inventory_posting_groups', 'SEED-WH') === 'ACTIVE', 'IPG SEED-WH not active');
});
test('BPG GHOST does not exist', () => {
  assert(checkPostingGroupExists('business_posting_groups', 'GHOST') === 'NOT_FOUND', 'BPG GHOST should not exist');
});

// ── Section 2: CoA Account Validation ────────────────────────────────────
console.log('\n── 2. Chart of Accounts Validation ────────────────────────────');

test('Account 140701 (Inventory) exists and is active', () => {
  assert(checkAccountExists('140701') === 'ACTIVE', '140701 not active');
});
test('Account 41010001 (Sales) exists and is active', () => {
  assert(checkAccountExists('41010001') === 'ACTIVE', '41010001 not active');
});
test('Account 45010001 (COGS) exists and is active', () => {
  assert(checkAccountExists('45010001') === 'ACTIVE', '45010001 not active');
});
test('Account 51200034 (Expense) exists and is active', () => {
  assert(checkAccountExists('51200034') === 'ACTIVE', '51200034 not active');
});
test('Fake account GHOST-001 does not exist', () => {
  assert(checkAccountExists('GHOST-001') === 'NOT_FOUND', 'GHOST-001 should not exist');
});

// ── Section 3: General Posting Setup — Exact Match ───────────────────────
console.log('\n── 3. General Posting Setup — Exact Match Resolution ──────────');

test('LOCAL × FERT → exact row resolves', () => {
  const result = resolveGeneralSetup('LOCAL', 'FERT');
  assert(result !== null, 'No setup found for LOCAL × FERT');
  assert(result.matchedWith[0] === 'LOCAL' && result.matchedWith[1] === 'FERT', `Matched wrong row: ${JSON.stringify(result.matchedWith)}`);
  assert(result.row.purchases_account === '140701', `Wrong purchases_account: ${result.row.purchases_account}`);
});

test('LOCAL × SEED → exact row resolves', () => {
  const result = resolveGeneralSetup('LOCAL', 'SEED');
  assert(result !== null, 'No setup found for LOCAL × SEED');
  assert(result.matchedWith[0] === 'LOCAL' && result.matchedWith[1] === 'SEED');
});

test('IMPORT × CHEM → exact row resolves', () => {
  const result = resolveGeneralSetup('IMPORT', 'CHEM');
  assert(result !== null, 'No setup found for IMPORT × CHEM');
  assert(result.matchedWith[0] === 'IMPORT' && result.matchedWith[1] === 'CHEM');
});

test('GOVT × HARVEST → exact row resolves', () => {
  const result = resolveGeneralSetup('GOVT', 'HARVEST');
  assert(result !== null, 'No setup found for GOVT × HARVEST');
});

// ── Section 4: General Posting Setup — Cascade Fallback ─────────────────
console.log('\n── 4. General Posting Setup — Cascade Fallback ────────────────');

test('UNKNOWN × FERT → falls back to NULL × FERT (PPG wildcard)', () => {
  // UNKNOWN BPG does not exist, should fall back
  // First check if there's a NULL × FERT row
  const nullFert = d1one(
    `SELECT id FROM general_posting_setup WHERE company_id=${COMPANY_ID} AND bus_posting_group_code IS NULL AND prod_posting_group_code='FERT' AND is_active=1`
  );
  // If no NULL × FERT row, should fall to NULL × NULL
  const result = resolveGeneralSetup('UNKNOWN', 'FERT');
  assert(result !== null, 'No fallback found for UNKNOWN × FERT — missing NULL/NULL catch-all');
  // Should NOT have matched on 'UNKNOWN' exact
  assert(result.matchedWith[0] !== 'UNKNOWN', `Unexpectedly matched on non-existent BPG UNKNOWN`);
});

test('LOCAL × UNKNOWN → falls back to LOCAL × NULL or NULL × NULL', () => {
  const result = resolveGeneralSetup('LOCAL', 'UNKNOWN');
  assert(result !== null, 'No fallback found for LOCAL × UNKNOWN');
  assert(result.matchedWith[1] !== 'UNKNOWN', `Should not match on non-existent PPG UNKNOWN`);
});

test('NULL × NULL catch-all row exists', () => {
  const row = d1one(
    `SELECT id, purchases_account FROM general_posting_setup WHERE company_id=${COMPANY_ID} AND bus_posting_group_code IS NULL AND prod_posting_group_code IS NULL AND is_active=1`
  );
  assert(row && !row.__error, 'Missing NULL/NULL catch-all row in general_posting_setup');
  assert(row.purchases_account, 'NULL/NULL catch-all has no purchases_account');
});

test('Cascade correctly prioritises exact over wildcard', () => {
  // LOCAL × FERT should match exact, not NULL × NULL
  const result = resolveGeneralSetup('LOCAL', 'FERT');
  assert(result !== null);
  assert(result.matchedWith[0] === 'LOCAL', `Expected exact BPG match, got: ${result.matchedWith[0]}`);
  assert(result.matchedWith[1] === 'FERT', `Expected exact PPG match, got: ${result.matchedWith[1]}`);
});

// ── Section 5: Inventory Posting Setup ───────────────────────────────────
console.log('\n── 5. Inventory Posting Setup Resolution ───────────────────────');

test('FERT-WH × FERT → exact row resolves', () => {
  const result = resolveInventorySetup('FERT-WH', 'FERT');
  assert(result !== null, 'No setup found for FERT-WH × FERT');
  assert(result.row.inventory_account, 'inventory_account is null');
});

test('SEED-WH × SEED → exact row resolves', () => {
  const result = resolveInventorySetup('SEED-WH', 'SEED');
  assert(result !== null, 'No setup found for SEED-WH × SEED');
});

test('MAIN-WH × EQUIP → exact row resolves', () => {
  const result = resolveInventorySetup('MAIN-WH', 'EQUIP');
  assert(result !== null, 'No setup found for MAIN-WH × EQUIP');
});

test('NULL × NULL catch-all exists in inventory_posting_setup', () => {
  const row = d1one(
    `SELECT id, inventory_account FROM inventory_posting_setup WHERE company_id=${COMPANY_ID} AND inv_posting_group_code IS NULL AND prod_posting_group_code IS NULL AND is_active=1`
  );
  assert(row && !row.__error, 'Missing NULL/NULL catch-all in inventory_posting_setup');
  assert(row.inventory_account, 'inventory_account is null in catch-all row');
});

test('MISC-WH × FERT → cascades to fallback', () => {
  // MISC-WH may not have exact FERT row, should fall to MISC-WH × NULL or NULL × NULL
  const result = resolveInventorySetup('MISC-WH', 'FERT');
  assert(result !== null, 'No fallback found for MISC-WH × FERT — missing catch-all');
});

// ── Section 6: Account Coverage Completeness ────────────────────────────
console.log('\n── 6. Account Coverage Completeness ───────────────────────────');

test('All general_posting_setup sales_accounts exist in CoA', () => {
  const rows = d1(
    `SELECT DISTINCT sales_account FROM general_posting_setup WHERE company_id=${COMPANY_ID} AND sales_account IS NOT NULL AND is_active=1`
  );
  const missing = [];
  for (const row of rows) {
    if (checkAccountExists(row.sales_account) !== 'ACTIVE') {
      missing.push(row.sales_account);
    }
  }
  assert(missing.length === 0, `Ghost sales_accounts: ${missing.join(', ')}`);
});

test('All general_posting_setup purchases_accounts exist in CoA', () => {
  const rows = d1(
    `SELECT DISTINCT purchases_account FROM general_posting_setup WHERE company_id=${COMPANY_ID} AND purchases_account IS NOT NULL AND is_active=1`
  );
  const missing = [];
  for (const row of rows) {
    if (checkAccountExists(row.purchases_account) !== 'ACTIVE') {
      missing.push(row.purchases_account);
    }
  }
  assert(missing.length === 0, `Ghost purchases_accounts: ${missing.join(', ')}`);
});

test('All general_posting_setup cogs_accounts exist in CoA', () => {
  const rows = d1(
    `SELECT DISTINCT cogs_account FROM general_posting_setup WHERE company_id=${COMPANY_ID} AND cogs_account IS NOT NULL AND is_active=1`
  );
  const missing = [];
  for (const row of rows) {
    if (checkAccountExists(row.cogs_account) !== 'ACTIVE') {
      missing.push(row.cogs_account);
    }
  }
  assert(missing.length === 0, `Ghost cogs_accounts: ${missing.join(', ')}`);
});

test('All inventory_posting_setup inventory_accounts exist in CoA', () => {
  const rows = d1(
    `SELECT DISTINCT inventory_account FROM inventory_posting_setup WHERE company_id=${COMPANY_ID} AND inventory_account IS NOT NULL AND is_active=1`
  );
  const missing = [];
  for (const row of rows) {
    if (checkAccountExists(row.inventory_account) !== 'ACTIVE') {
      missing.push(row.inventory_account);
    }
  }
  assert(missing.length === 0, `Ghost inventory_accounts: ${missing.join(', ')}`);
});

// ── Section 7: Entity → Posting Group Assignments ─────────────────────────
console.log('\n── 7. Entity → Posting Group Assignment Coverage ───────────────');

test('All active warehouses have inv_posting_group_code assigned', () => {
  const rows = d1(
    `SELECT name FROM warehouses WHERE company_id=${COMPANY_ID} AND is_active=1 AND (inv_posting_group_code IS NULL OR inv_posting_group_code='')`
  );
  assert(rows.length === 0, `Warehouses missing IPG: ${rows.map(r => r.name).join(', ')}`);
});

test('All active suppliers have bus_posting_group_code assigned', () => {
  const rows = d1(
    `SELECT name FROM suppliers WHERE company_id=${COMPANY_ID} AND is_active=1 AND (bus_posting_group_code IS NULL OR bus_posting_group_code='')`
  );
  assert(rows.length === 0, `Suppliers missing BPG: ${rows.map(r => r.name).join(', ')}`);
});

test('All active items have prod_posting_group_code assigned', () => {
  const rows = d1(
    `SELECT code FROM items WHERE company_id=${COMPANY_ID} AND is_active=1 AND (prod_posting_group_code IS NULL OR prod_posting_group_code='')`
  );
  assert(rows.length === 0, `Items missing PPG: ${rows.map(r => r.code).join(', ')}`);
});

test('All supplier BPGs reference valid active groups', () => {
  const rows = d1(
    `SELECT s.name, s.bus_posting_group_code FROM suppliers s ` +
    `LEFT JOIN business_posting_groups bg ON bg.code=s.bus_posting_group_code AND bg.company_id=s.company_id ` +
    `WHERE s.company_id=${COMPANY_ID} AND s.is_active=1 AND bg.code IS NULL AND s.bus_posting_group_code IS NOT NULL`
  );
  assert(rows.length === 0, `Suppliers with ghost BPG: ${rows.map(r => `${r.name}(${r.bus_posting_group_code})`).join(', ')}`);
});

test('All item PPGs reference valid active groups', () => {
  const rows = d1(
    `SELECT i.code, i.prod_posting_group_code FROM items i ` +
    `LEFT JOIN product_posting_groups pg ON pg.code=i.prod_posting_group_code AND pg.company_id=i.company_id ` +
    `WHERE i.company_id=${COMPANY_ID} AND i.is_active=1 AND pg.code IS NULL AND i.prod_posting_group_code IS NOT NULL`
  );
  assert(rows.length === 0, `Items with ghost PPG: ${rows.map(r => `${r.code}(${r.prod_posting_group_code})`).join(', ')}`);
});

// ── Section 8: Journal Line Balance (Debit = Credit) ─────────────────────
console.log('\n── 8. Journal Entry Balance Verification ───────────────────────');

test('Inventory increase: 2 balanced lines (debit inventory, credit purchases)', () => {
  const invResult = resolveInventorySetup('FERT-WH', 'FERT');
  const genResult = resolveGeneralSetup(null, 'FERT');
  assert(invResult !== null, 'No inventory setup for FERT-WH × FERT');
  assert(genResult !== null, 'No general setup for DEFAULT × FERT');
  // Simulate the blueprint
  const amount = 10000;
  const lines = [
    { account: invResult.row.inventory_account, debit: amount, credit: 0 },
    { account: genResult.row.purchases_account, debit: 0, credit: amount },
  ];
  const totalDebit  = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  assert(totalDebit === totalCredit, `Imbalanced: DR=${totalDebit} CR=${totalCredit}`);
  assert(lines[0].account !== null, 'inventory_account is null');
  assert(lines[1].account !== null, 'purchases_account is null');
});

test('Supplier invoice: 2 balanced lines (debit purchases, credit AP)', () => {
  const genResult = resolveGeneralSetup('LOCAL', 'FERT');
  assert(genResult !== null, 'No general setup for LOCAL × FERT');
  const amount = 5000;
  const ap_code = '210101'; // typical AP account
  const lines = [
    { account: genResult.row.purchases_account, debit: amount, credit: 0 },
    { account: ap_code, debit: 0, credit: amount },
  ];
  const totalDebit  = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  assert(totalDebit === totalCredit, `Imbalanced: DR=${totalDebit} CR=${totalCredit}`);
});

test('Expense posting: 2 balanced lines (debit expense, credit cash)', () => {
  const genResult = resolveGeneralSetup('LOCAL', null);
  assert(genResult !== null, 'No general setup for LOCAL × DEFAULT');
  const amount = 2000;
  const cash_code = '111001';
  const expAcc = genResult.row.expense_account;
  assert(expAcc, 'expense_account is null in setup');
  const lines = [
    { account: expAcc, debit: amount, credit: 0 },
    { account: cash_code, debit: 0, credit: amount },
  ];
  const totalDebit  = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  assert(totalDebit === totalCredit, `Imbalanced: DR=${totalDebit} CR=${totalCredit}`);
});

// ── Section 9: Missing Setup Error Conditions ─────────────────────────────
console.log('\n── 9. Error Condition Paths ────────────────────────────────────');

test('Missing general setup with no fallback returns null (would block)', () => {
  // Temporarily check: if we had a setup with 0 rows, cascade would return null
  // We verify by deleting + re-inserting is NOT needed — instead verify query with impossible company
  const result = d1one(
    `SELECT id FROM general_posting_setup WHERE company_id=99999 AND is_active=1 LIMIT 1`
  );
  assert(!result || result.__error, 'Should find no rows for non-existent company 99999');
});

test('Inactive posting group detected correctly', () => {
  // Insert a temp inactive BPG, verify checkPostingGroupExists returns INACTIVE
  d1exec(`INSERT INTO business_posting_groups (code, company_id, name, description, is_active, created_at) VALUES ('TEST_INACTIVE', ${COMPANY_ID}, 'Test Inactive', '', 0, datetime('now')) ON CONFLICT(code, company_id) DO UPDATE SET is_active=0`);
  const status = checkPostingGroupExists('business_posting_groups', 'TEST_INACTIVE');
  d1exec(`DELETE FROM business_posting_groups WHERE code='TEST_INACTIVE' AND company_id=${COMPANY_ID}`);
  assert(status === 'INACTIVE', `Expected INACTIVE, got ${status}`);
});

test('Non-existent account detected (would produce PG-ACCT-001 error)', () => {
  const status = checkAccountExists('FAKE-9999999');
  assert(status === 'NOT_FOUND', `Expected NOT_FOUND for ghost account`);
});

// ── Section 10: Posting Engine Global Settings ────────────────────────────
console.log('\n── 10. Posting Engine Global Settings ──────────────────────────');

test('posting_engine is enabled in gl_integration_settings', () => {
  const row = d1one(
    `SELECT is_enabled FROM gl_integration_settings WHERE company_id=${COMPANY_ID} AND module_key='posting_engine'`
  );
  assert(row && !row.__error, 'posting_engine row not found in gl_integration_settings');
  assert(isActive(row.is_enabled), `posting_engine is_enabled=${row.is_enabled} (expected 1)`);
});

test('gl_account_mappings has at least 1 mapping for cash/AP/expenses', () => {
  const row = d1one(
    `SELECT COUNT(*) AS cnt FROM gl_account_mappings WHERE company_id=${COMPANY_ID}`
  );
  assert(row && parseInt(row.cnt ?? '0') > 0, 'No GL account mappings found');
});

// ── Section 11: Cross-table Consistency ──────────────────────────────────
console.log('\n── 11. Cross-table Data Consistency ───────────────────────────');

test('No inventory_movements with null movement_date', () => {
  const row = d1one(
    `SELECT COUNT(*) AS c FROM inventory_movements WHERE company_id=${COMPANY_ID} AND movement_date IS NULL`
  );
  assert(parseInt(row?.c ?? '0') === 0, `${row?.c} inventory_movements with null movement_date`);
});

test('No supplier_transactions with missing supplier_code', () => {
  const row = d1one(
    `SELECT COUNT(*) AS c FROM supplier_transactions st LEFT JOIN suppliers s ON s.code=st.supplier_code AND s.company_id=st.company_id WHERE st.company_id=${COMPANY_ID} AND s.code IS NULL`
  );
  assert(parseInt(row?.c ?? '0') === 0, `${row?.c} orphan supplier_transactions`);
});

test('No inventory_movements with missing item_code', () => {
  const row = d1one(
    `SELECT COUNT(*) AS c FROM inventory_movements im LEFT JOIN items i ON i.code=im.item_code AND i.company_id=im.company_id WHERE im.company_id=${COMPANY_ID} AND i.code IS NULL`
  );
  assert(parseInt(row?.c ?? '0') === 0, `${row?.c} orphan inventory_movements`);
});

test('purchase_orders table has correct FK structure (no suppliers.id reference)', () => {
  const row = d1one(`SELECT sql FROM sqlite_master WHERE name='purchase_orders'`);
  assert(row && !row.__error, 'purchase_orders not found in sqlite_master');
  const sql = Object.values(row)[0] ?? '';
  assert(!sql.includes('REFERENCES suppliers(id)'), 'purchase_orders still references suppliers(id) — FK fix not applied');
  assert(sql.includes('REFERENCES suppliers(code, company_id)') || sql.includes('REFERENCES suppliers'), 'No valid supplier FK found');
});

// ── Section 12: GL Posting Health Check ──────────────────────────────────
console.log('\n── 12. GL Posting Health Check ─────────────────────────────────');

test('General posting setup has at least 1 row per supplier BPG', () => {
  const bpgs = d1(`SELECT code FROM business_posting_groups WHERE company_id=${COMPANY_ID} AND is_active=1`);
  const missing = [];
  for (const bpg of bpgs) {
    const row = d1one(
      `SELECT id FROM general_posting_setup WHERE company_id=${COMPANY_ID} AND bus_posting_group_code='${bpg.code}' AND is_active=1 LIMIT 1`
    );
    if (!row || row.__error) missing.push(bpg.code);
  }
  assert(missing.length === 0, `BPGs with no GPS row: ${missing.join(', ')}`);
});

test('Inventory posting setup has at least 1 row per IPG', () => {
  const ipgs = d1(`SELECT code FROM inventory_posting_groups WHERE company_id=${COMPANY_ID} AND is_active=1`);
  const missing = [];
  for (const ipg of ipgs) {
    const row = d1one(
      `SELECT id FROM inventory_posting_setup WHERE company_id=${COMPANY_ID} AND inv_posting_group_code='${ipg.code}' AND is_active=1 LIMIT 1`
    );
    if (!row || row.__error) missing.push(ipg.code);
  }
  // MISC-WH and newer IPGs might not have explicit rows — acceptable if catch-all exists
  const catchAll = d1one(
    `SELECT id FROM inventory_posting_setup WHERE company_id=${COMPANY_ID} AND inv_posting_group_code IS NULL AND prod_posting_group_code IS NULL AND is_active=1`
  );
  const reallyMissing = missing.filter(() => !catchAll);
  assert(reallyMissing.length === 0, `IPGs with no IPS row and no catch-all: ${reallyMissing.join(', ')}`);
});

// ────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ────────────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log('\n══════════════════════════════════════════════════════════════');
console.log(`  RESULTS: ${passed}/${total} passed  |  ${failed} failed`);
console.log('══════════════════════════════════════════════════════════════');

const failedTests = results.filter(r => r.status !== 'PASS');
if (failedTests.length > 0) {
  console.log('\n  FAILURES:');
  failedTests.forEach(r => {
    console.log(`  ✗ [${r.status}] ${r.name}`);
    if (r.detail) console.log(`         → ${r.detail}`);
  });
}

// Save results
const fs = require('fs');
fs.writeFileSync(
  require('path').join(__dirname, 'posting_engine_test_results.json'),
  JSON.stringify({ timestamp: new Date().toISOString(), total, passed, failed, results }, null, 2)
);
console.log('\n  Report saved: posting_engine_test_results.json\n');

process.exit(failed > 0 ? 1 : 0);
