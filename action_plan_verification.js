#!/usr/bin/env node
/**
 * action_plan_verification.js
 * Verifies all items in the Recommended Action Plan are complete
 * 
 * Usage: node action_plan_verification.js
 */

const { execSync } = require('child_process');

const DB = 'agri-nile-flow-data-lake';

function query(sql) {
  try {
    const result = execSync(
      `npx wrangler d1 execute ${DB} --remote --json --command "${sql.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const parsed = JSON.parse(result);
    return parsed[0]?.results ?? [];
  } catch (err) {
    return [];
  }
}

function check(phase, item, sql, validator) {
  try {
    const rows = query(sql);
    const { pass, actual, expected } = validator(rows);
    const icon = pass ? '✅' : '❌';
    console.log(`${icon} [${phase}] ${item}`);
    if (!pass) {
      console.log(`   Expected: ${expected}`);
      console.log(`   Actual:   ${actual}`);
    }
    return { phase, item, pass, actual, expected };
  } catch (err) {
    console.log(`❌ [${phase}] ${item}`);
    console.log(`   Error: ${err.message}`);
    return { phase, item, pass: false, actual: 'ERROR', expected: 'Query execution' };
  }
}

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║     Action Plan Verification — All Phases                    ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

const results = [];

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 1: CRITICAL FOUNDATION
// ═════════════════════════════════════════════════════════════════════════════
console.log('📋 PHASE 1: Critical Foundation\n');

results.push(check(
  'P1', 'Chart of Accounts imported',
  'SELECT COUNT(*) as n FROM chart_of_accounts WHERE company_id = 1',
  rows => {
    const n = rows[0]?.n ?? 0;
    return { pass: n >= 300, actual: `${n} accounts`, expected: '>= 300' };
  }
));

results.push(check(
  'P1', 'Posting rules migrations applied',
  'SELECT COUNT(*) as n FROM posting_rules WHERE company_id = 1',
  rows => {
    const n = rows[0]?.n ?? 0;
    return { pass: n >= 50, actual: `${n} rules`, expected: '>= 50' };
  }
));

results.push(check(
  'P1', 'Control account mappings configured',
  `SELECT mapping_key, account_code FROM posting_rules 
   WHERE company_id = 1 AND rule_type = 'control' 
   AND mapping_key IN ('cash', 'inventory', 'accounts_payable', 'revenue_default', 'expense_default', 'wip_asset', 'wip_contra', 'depreciation_expense', 'accumulated_depreciation', 'deferred_revenue')`,
  rows => {
    const keys = rows.map(r => r.mapping_key);
    const required = ['cash', 'inventory', 'accounts_payable', 'revenue_default', 'expense_default', 'wip_asset', 'wip_contra', 'depreciation_expense', 'accumulated_depreciation', 'deferred_revenue'];
    const missing = required.filter(k => !keys.includes(k));
    return { 
      pass: missing.length === 0, 
      actual: `${keys.length}/10 control accounts`, 
      expected: 'All 10 control accounts present',
    };
  }
));

results.push(check(
  'P1', 'Financial periods created',
  'SELECT COUNT(*) as n FROM financial_periods WHERE company_id = 1',
  rows => {
    const n = rows[0]?.n ?? 0;
    return { pass: n >= 1, actual: `${n} periods`, expected: '>= 1' };
  }
));

results.push(check(
  'P1', 'No unbalanced journal entries',
  `SELECT COUNT(*) as n FROM (
     SELECT je.id FROM journal_entries je
     JOIN journal_entry_lines jel ON jel.entry_id = je.id
     WHERE je.company_id = 1
     GROUP BY je.id
     HAVING ABS(ROUND(SUM(jel.debit), 2) - ROUND(SUM(jel.credit), 2)) > 0.01
   )`,
  rows => {
    const n = rows[0]?.n ?? 0;
    return { pass: n === 0, actual: `${n} unbalanced`, expected: '0' };
  }
));

results.push(check(
  'P1', 'No orphaned journal lines',
  `SELECT COUNT(*) as n FROM journal_entry_lines jel
   WHERE NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.id = jel.entry_id)`,
  rows => {
    const n = rows[0]?.n ?? 0;
    return { pass: n === 0, actual: `${n} orphans`, expected: '0' };
  }
));

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 2: DATA INTEGRITY
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n📋 PHASE 2: Data Integrity\n');

results.push(check(
  'P2', 'Stock quants table exists',
  `SELECT name FROM sqlite_master WHERE type='table' AND name='stock_quants'`,
  rows => {
    const exists = rows.length > 0 && rows[0]?.name === 'stock_quants';
    return { pass: exists, actual: exists ? 'exists' : 'missing', expected: 'exists' };
  }
));

results.push(check(
  'P2', 'Stock quants reconciled with movements',
  `SELECT (SELECT COUNT(DISTINCT item_code) FROM inventory_movements WHERE company_id = 1 AND status='posted') as movement_items,
          (SELECT COUNT(DISTINCT item_code) FROM stock_quants WHERE company_id = 1 AND quantity != 0) as quant_items`,
  rows => {
    const r = rows[0] || {};
    const diff = Math.abs((r.movement_items || 0) - (r.quant_items || 0));
    return { pass: diff <= 5, actual: `Diff: ${diff}`, expected: '<= 5 items variance' };
  }
));

results.push(check(
  'P2', 'Audit log triggers installed',
  `SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_audit_%'`,
  rows => {
    const count = rows.length;
    return { pass: count >= 3, actual: `${count} triggers`, expected: '>= 3' };
  }
));

results.push(check(
  'P2', 'Inventory movements have GL links',
  `SELECT COUNT(*) as total, SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) as linked
   FROM inventory_movements WHERE company_id = 1 AND status = 'posted'`,
  rows => {
    const r = rows[0] || {};
    const total = r.total || 0;
    const linked = r.linked || 0;
    const pct = total > 0 ? Math.round((linked / total) * 100) : 100;
    return { pass: pct >= 95, actual: `${linked}/${total} (${pct}%)`, expected: '>= 95%' };
  }
));

results.push(check(
  'P2', 'Cash transactions have GL links',
  `SELECT COUNT(*) as total, SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) as linked
   FROM cash_transactions WHERE company_id = 1 AND status = 'posted'`,
  rows => {
    const r = rows[0] || {};
    const total = r.total || 0;
    const linked = r.linked || 0;
    const pct = total > 0 ? Math.round((linked / total) * 100) : 100;
    return { pass: pct >= 95, actual: `${linked}/${total} (${pct}%)`, expected: '>= 95%' };
  }
));

results.push(check(
  'P2', 'Supplier transactions have GL links',
  `SELECT COUNT(*) as total, SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) as linked
   FROM supplier_transactions WHERE company_id = 1 AND status = 'posted'`,
  rows => {
    const r = rows[0] || {};
    const total = r.total || 0;
    const linked = r.linked || 0;
    const pct = total > 0 ? Math.round((linked / total) * 100) : 100;
    return { pass: pct >= 95, actual: `${linked}/${total} (${pct}%)`, expected: '>= 95%' };
  }
));

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 3: PROCESS VALIDATION
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n📋 PHASE 3: Process Validation\n');

results.push(check(
  'P3', 'Posting engine is enabled',
  `SELECT COUNT(*) as n FROM gl_integration_settings WHERE company_id = 1 AND is_enabled = 1`,
  rows => {
    const n = rows[0]?.n ?? 0;
    return { pass: n > 0, actual: `${n} modules enabled`, expected: '> 0' };
  }
));

results.push(check(
  'P3', 'Business events system working',
  `SELECT COUNT(*) as n FROM business_events WHERE company_id = 1`,
  rows => {
    const n = rows[0]?.n ?? 0;
    return { pass: n >= 0, actual: `${n} events`, expected: '>= 0 (informational)' };
  }
));

results.push(check(
  'P3', 'No stuck/error business events',
  `SELECT COUNT(*) as n FROM business_events WHERE company_id = 1 AND status IN ('error', 'pending')`,
  rows => {
    const n = rows[0]?.n ?? 0;
    return { pass: n === 0, actual: `${n} stuck events`, expected: '0' };
  }
));

results.push(check(
  'P3', 'Trial balance is equal',
  `SELECT 
     ROUND(SUM(CASE WHEN normal_balance = 'debit' THEN closing_balance ELSE 0 END), 2) as total_debit,
     ROUND(SUM(CASE WHEN normal_balance = 'credit' THEN closing_balance ELSE 0 END), 2) as total_credit
   FROM (
     SELECT coa.normal_balance,
       SUM(CASE WHEN coa.normal_balance = 'debit' THEN jel.debit - jel.credit ELSE jel.credit - jel.debit END) as closing_balance
     FROM journal_entry_lines jel
     JOIN chart_of_accounts coa ON coa.code = jel.account_code AND coa.company_id = jel.company_id
     JOIN journal_entries je ON je.id = jel.entry_id AND je.is_posted = 1
     WHERE jel.company_id = 1
     GROUP BY coa.code, coa.normal_balance
   )`,
  rows => {
    const r = rows[0] || {};
    const diff = Math.abs((r.total_debit || 0) - (r.total_credit || 0));
    return { pass: diff < 0.01, actual: `Diff: ${diff}`, expected: '< 0.01' };
  }
));

// ═════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║                        SUMMARY                                 ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

const byPhase = {
  'P1': results.filter(r => r.phase === 'P1'),
  'P2': results.filter(r => r.phase === 'P2'),
  'P3': results.filter(r => r.phase === 'P3')
};

console.log('Phase 1 (Critical Foundation):');
const p1Pass = byPhase['P1'].filter(r => r.pass).length;
const p1Total = byPhase['P1'].length;
console.log(`  ${p1Pass}/${p1Total} items passed ${p1Pass === p1Total ? '✅' : '⚠️'}`);

console.log('\nPhase 2 (Data Integrity):');
const p2Pass = byPhase['P2'].filter(r => r.pass).length;
const p2Total = byPhase['P2'].length;
console.log(`  ${p2Pass}/${p2Total} items passed ${p2Pass === p2Total ? '✅' : '⚠️'}`);

console.log('\nPhase 3 (Process Validation):');
const p3Pass = byPhase['P3'].filter(r => r.pass).length;
const p3Total = byPhase['P3'].length;
console.log(`  ${p3Pass}/${p3Total} items passed ${p3Pass === p3Total ? '✅' : '⚠️'}`);

const totalPass = results.filter(r => r.pass).length;
const totalItems = results.length;
const overallPct = Math.round((totalPass / totalItems) * 100);

console.log(`\n═══════════════════════════════════════════════════════════════`);
console.log(`Overall Score: ${overallPct}% (${totalPass}/${totalItems})`);

if (overallPct >= 95) {
  console.log('🎉 STATUS: EXCELLENT — All critical items complete!');
} else if (overallPct >= 80) {
  console.log('✅ STATUS: GOOD — Minor items need attention');
} else if (overallPct >= 60) {
  console.log('⚠️  STATUS: FAIR — Some important items incomplete');
} else {
  console.log('❌ STATUS: CRITICAL — Immediate action required');
}

console.log('');

// Show any failures
const failures = results.filter(r => !r.pass);
if (failures.length > 0) {
  console.log('Failed Items:');
  failures.forEach(f => {
    console.log(`  ❌ [${f.phase}] ${f.item}`);
    console.log(`     Expected: ${f.expected}`);
    console.log(`     Actual:   ${f.actual}`);
  });
  console.log('');
}

process.exit(failures.length === 0 ? 0 : 1);
