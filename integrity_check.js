#!/usr/bin/env node
/**
 * integrity_check.js
 * Run DB integrity checks against the remote Cloudflare D1 database.
 *
 * Usage:
 *   node integrity_check.js
 *
 * Requires:
 *   npx wrangler (authenticated, with access to agri-nile-flow-data-lake)
 */

const { execSync } = require('child_process');

const DB = 'agri-nile-flow-data-lake';

function query(sql) {
  const result = execSync(
    `npx wrangler d1 execute ${DB} --remote --json --command "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  const parsed = JSON.parse(result);
  return parsed[0]?.results ?? [];
}

function check(name, sql, validator) {
  try {
    const rows = query(sql);
    const { pass, actual, expected } = validator(rows);
    const icon = pass ? '✅ PASS' : '❌ FAIL';
    console.log(`${icon}  ${name}`);
    if (!pass) {
      console.log(`       expected: ${expected}`);
      console.log(`       actual:   ${actual}`);
    }
    return pass;
  } catch (err) {
    console.log(`❌ FAIL  ${name}`);
    console.log(`       error: ${err.message}`);
    return false;
  }
}

console.log('\n=== Agri-Nile Flow — DB Integrity Check ===\n');

const results = [];

// 1. Inventory movements linked to journal entries
results.push(check(
  'inventory_movements linked (status=posted, journal_entry_id NOT NULL)',
  'SELECT COUNT(*) AS cnt FROM inventory_movements WHERE status=\'posted\' AND journal_entry_id IS NOT NULL',
  rows => {
    const cnt = rows[0]?.cnt ?? 0;
    return { pass: Number(cnt) >= 596, actual: cnt, expected: '>= 596' };
  }
));

// 2. Unpriced movements (zero-value, no JE)
results.push(check(
  'inventory_movements unpriced (status=unpriced)',
  'SELECT COUNT(*) AS cnt FROM inventory_movements WHERE status=\'unpriced\'',
  rows => {
    const cnt = rows[0]?.cnt ?? 0;
    return { pass: Number(cnt) >= 0, actual: cnt, expected: '>= 0 (informational)' };
  }
));

// 3. cost_centers UNIQUE index exists
results.push(check(
  'cost_centers UNIQUE index (uq_cost_centers_code) exists',
  'SELECT name FROM sqlite_master WHERE type=\'index\' AND name=\'uq_cost_centers_code\'',
  rows => {
    const found = rows.length > 0 && rows[0]?.name === 'uq_cost_centers_code';
    return { pass: found, actual: found ? 'found' : 'missing', expected: 'uq_cost_centers_code' };
  }
));

// 4. GL mappings count
results.push(check(
  'gl_account_mappings has >= 15 rows for company_id=1',
  'SELECT COUNT(*) AS cnt FROM gl_account_mappings WHERE company_id=1',
  rows => {
    const cnt = rows[0]?.cnt ?? 0;
    return { pass: Number(cnt) >= 15, actual: cnt, expected: '>= 15' };
  }
));

// 5. No duplicate mappings (unique per company_id + mapping_key)
results.push(check(
  'gl_account_mappings no duplicates (unique company+key)',
  'SELECT COUNT(*) AS cnt FROM (SELECT company_id, mapping_key FROM gl_account_mappings GROUP BY company_id, mapping_key HAVING COUNT(*) > 1)',
  rows => {
    const cnt = rows[0]?.cnt ?? 0;
    return { pass: Number(cnt) === 0, actual: cnt, expected: '0' };
  }
));

// 6. No unmapped P&L root accounts (codes '4' and '5' should have mappings or be ignored)
results.push(check(
  'chart_of_accounts P&L root nodes (code 4,5) are not plain unmapped leaves',
  'SELECT COUNT(*) AS cnt FROM chart_of_accounts WHERE company_id=1 AND code IN (\'4\',\'5\') AND is_header=0',
  rows => {
    const cnt = rows[0]?.cnt ?? 0;
    return { pass: Number(cnt) === 0, actual: cnt, expected: '0 (should be header nodes)' };
  }
));

// 7. gl_account_mappings UNIQUE index exists
results.push(check(
  'gl_account_mappings UNIQUE index on (company_id, mapping_key) exists',
  'SELECT name FROM sqlite_master WHERE type=\'index\' AND tbl_name=\'gl_account_mappings\' AND name LIKE \'%unique%\' OR (type=\'index\' AND tbl_name=\'gl_account_mappings\' AND sql LIKE \'%UNIQUE%\')',
  rows => {
    const found = rows.length > 0;
    return { pass: found, actual: found ? rows[0]?.name : 'not found', expected: 'a UNIQUE index on gl_account_mappings' };
  }
));

// 8. Journal entries exist (basic sanity)
results.push(check(
  'journal_entries table has rows',
  'SELECT COUNT(*) AS cnt FROM journal_entries WHERE company_id=1',
  rows => {
    const cnt = rows[0]?.cnt ?? 0;
    return { pass: Number(cnt) > 0, actual: cnt, expected: '> 0' };
  }
));

const passed = results.filter(Boolean).length;
const total = results.length;
console.log(`\n=== Result: ${passed}/${total} checks passed ===\n`);

if (passed < total) {
  process.exit(1);
} else {
  process.exit(0);
}
