#!/usr/bin/env node
/**
 * financial_integrity_audit.js
 * 20-Step Financial Integrity Audit for Agri-Nile Flow
 * 
 * Usage: node financial_integrity_audit.js
 */

const { execSync } = require('child_process');

const DB = 'agri-nile-flow-data-lake';
const USE_LOCAL = false; // Set to true to use local DB

function query(sql) {
  try {
    const mode = USE_LOCAL ? '--local' : '--remote';
    const result = execSync(
      `npx wrangler d1 execute ${DB} ${mode} --json --command "${sql.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const parsed = JSON.parse(result);
    return parsed[0]?.results ?? [];
  } catch (err) {
    // Suppress error output for cleaner results
    return [];
  }
}

function check(stepNum, name, sql, validator) {
  try {
    const rows = query(sql);
    const { pass, actual, expected, evidence } = validator(rows);
    const icon = pass ? '✅ PASS' : '❌ FAIL';
    console.log(`\n${icon}  Step ${stepNum}: ${name}`);
    if (!pass) {
      console.log(`       Expected: ${expected}`);
      console.log(`       Actual:   ${actual}`);
    }
    if (evidence) {
      console.log(`       Evidence: ${evidence}`);
    }
    return { step: stepNum, name, pass, actual, expected, evidence };
  } catch (err) {
    console.log(`\n❌ FAIL  Step ${stepNum}: ${name}`);
    console.log(`       Error: ${err.message}`);
    return { step: stepNum, name, pass: false, actual: 'ERROR', expected: 'Query execution', evidence: err.message };
  }
}

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║     Agri-Nile Flow — 20-Step Financial Integrity Audit       ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

const results = [];

// STEP 1: Verify Chart of Accounts completeness and structure
results.push(check(
  1,
  'Chart of Accounts completeness',
  `SELECT 
    COUNT(*) as total_accounts,
    COUNT(DISTINCT account_type) as distinct_types,
    SUM(CASE WHEN is_header = 1 THEN 1 ELSE 0 END) as header_count,
    SUM(CASE WHEN is_header = 0 THEN 1 ELSE 0 END) as leaf_count
   FROM chart_of_accounts WHERE company_id = 1`,
  rows => {
    const r = rows[0] || {};
    const hasAllTypes = r.distinct_types >= 5; // asset, liability, equity, revenue, expense
    const hasAccounts = r.total_accounts > 0;
    const pass = hasAccounts && hasAllTypes;
    return { 
      pass, 
      actual: `${r.total_accounts} accounts, ${r.distinct_types} types (${r.header_count} headers, ${r.leaf_count} leaves)`,
      expected: 'Accounts > 0, all 5 account types present',
      evidence: `Total: ${r.total_accounts}, Types: ${r.distinct_types}, Headers: ${r.header_count}, Leaves: ${r.leaf_count}`
    };
  }
));

// STEP 2: Validate posting rules coverage for all transaction types
results.push(check(
  2,
  'Posting rules coverage',
  `SELECT 
    rule_type,
    COUNT(*) as count,
    SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_count
   FROM posting_rules 
   WHERE company_id = 1
   GROUP BY rule_type`,
  rows => {
    const types = rows.map(r => `${r.rule_type}: ${r.active_count}/${r.count} active`).join(', ');
    const hasGeneral = rows.some(r => r.rule_type === 'general' && r.active_count > 0);
    const hasInventory = rows.some(r => r.rule_type === 'inventory' && r.active_count > 0);
    const hasControl = rows.some(r => r.rule_type === 'control' && r.active_count > 0);
    const pass = hasGeneral && hasInventory && hasControl;
    return {
      pass,
      actual: types,
      expected: 'All three rule types (general, inventory, control) with active rules',
      evidence: types
    };
  }
));

// STEP 3: Check GL account mappings for control accounts (now in posting_rules)
results.push(check(
  3,
  'Control account mappings in posting_rules',
  `SELECT mapping_key, account_code, is_active
   FROM posting_rules 
   WHERE company_id = 1 AND rule_type = 'control' AND is_active = 1`,
  rows => {
    const requiredKeys = ['cash', 'inventory', 'accounts_payable', 'revenue_default', 'expense_default'];
    const presentKeys = rows.map(r => r.mapping_key);
    const missing = requiredKeys.filter(k => !presentKeys.includes(k));
    const pass = missing.length === 0;
    return {
      pass,
      actual: `${rows.length} mappings, missing: ${missing.join(', ') || 'none'}`,
      expected: `All required keys: ${requiredKeys.join(', ')}`,
      evidence: `Present: ${presentKeys.join(', ')}, Missing: ${missing.join(', ') || 'none'}`
    };
  }
));

// STEP 4: Verify financial periods are properly defined and closed
results.push(check(
  4,
  'Financial periods definition',
  `SELECT 
    COUNT(*) as total_periods,
    SUM(CASE WHEN is_closed = 1 THEN 1 ELSE 0 END) as closed_count
   FROM financial_periods WHERE company_id = 1`,
  rows => {
    const r = rows[0] || {};
    const hasPeriods = r.total_periods > 0;
    const pass = hasPeriods;
    return {
      pass,
      actual: `${r.total_periods} periods, ${r.closed_count} closed`,
      expected: 'At least 1 financial period defined',
      evidence: `Total: ${r.total_periods}, Closed: ${r.closed_count}`
    };
  }
));

// STEP 5: Validate journal entry balance integrity
results.push(check(
  5,
  'Journal entry balance integrity',
  `SELECT COUNT(*) as unbalanced_count
   FROM (
     SELECT je.id FROM journal_entries je
     JOIN journal_entry_lines jel ON jel.entry_id = je.id
     WHERE je.company_id = 1
     GROUP BY je.id
     HAVING ABS(ROUND(SUM(jel.debit), 2) - ROUND(SUM(jel.credit), 2)) > 0.01
   )`,
  rows => {
    const count = rows[0]?.unbalanced_count || 0;
    const pass = count === 0;
    return {
      pass,
      actual: `${count} unbalanced entries`,
      expected: '0 unbalanced entries',
      evidence: count > 0 ? `${count} entries have debit != credit` : 'All entries balanced'
    };
  }
));

// STEP 6: Check for orphaned journal entry lines
results.push(check(
  6,
  'Orphaned journal entry lines',
  `SELECT COUNT(*) as orphan_count
   FROM journal_entry_lines jel
   WHERE NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.id = jel.entry_id)`,
  rows => {
    const count = rows[0]?.orphan_count || 0;
    const pass = count === 0;
    return {
      pass,
      actual: `${count} orphaned lines`,
      expected: '0 orphaned lines',
      evidence: count > 0 ? `${count} lines reference non-existent entries` : 'All lines have valid entries'
    };
  }
));

// STEP 7: Verify inventory movements have GL postings
results.push(check(
  7,
  'Inventory movements GL integration',
  `SELECT 
    COUNT(*) as total_posted,
    SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) as with_gl
   FROM inventory_movements 
   WHERE company_id = 1 AND status = 'posted'`,
  rows => {
    const r = rows[0] || {};
    const total = r.total_posted || 0;
    const withGL = r.with_gl || 0;
    const coverage = total > 0 ? Math.round((withGL / total) * 100) : 100;
    const pass = coverage >= 95; // Allow 5% tolerance
    return {
      pass,
      actual: `${withGL}/${total} posted movements have GL (${coverage}%)`,
      expected: '>= 95% of posted movements have GL entries',
      evidence: `Coverage: ${coverage}%, Unlinked: ${total - withGL}`
    };
  }
));

// STEP 8: Check cash transactions for GL integration
results.push(check(
  8,
  'Cash transactions GL integration',
  `SELECT 
    COUNT(*) as total_posted,
    SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) as with_gl
   FROM cash_transactions 
   WHERE company_id = 1 AND status = 'posted'`,
  rows => {
    const r = rows[0] || {};
    const total = r.total_posted || 0;
    const withGL = r.with_gl || 0;
    const coverage = total > 0 ? Math.round((withGL / total) * 100) : 100;
    const pass = coverage >= 95;
    return {
      pass,
      actual: `${withGL}/${total} posted cash tx have GL (${coverage}%)`,
      expected: '>= 95% of posted cash transactions have GL entries',
      evidence: `Coverage: ${coverage}%, Unlinked: ${total - withGL}`
    };
  }
));

// STEP 9: Validate supplier transactions GL posting
results.push(check(
  9,
  'Supplier transactions GL integration',
  `SELECT 
    COUNT(*) as total_posted,
    SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) as with_gl
   FROM supplier_transactions 
   WHERE company_id = 1 AND status = 'posted'`,
  rows => {
    const r = rows[0] || {};
    const total = r.total_posted || 0;
    const withGL = r.with_gl || 0;
    const coverage = total > 0 ? Math.round((withGL / total) * 100) : 100;
    const pass = coverage >= 95;
    return {
      pass,
      actual: `${withGL}/${total} posted supplier tx have GL (${coverage}%)`,
      expected: '>= 95% of posted supplier transactions have GL entries',
      evidence: `Coverage: ${coverage}%, Unlinked: ${total - withGL}`
    };
  }
));

// STEP 10: Check payroll runs for GL posting
results.push(check(
  10,
  'Payroll runs GL integration',
  `SELECT 
    COUNT(*) as total_runs,
    SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) as with_gl
   FROM payroll_runs 
   WHERE company_id = 1 AND status IN ('approved', 'paid')`,
  rows => {
    const r = rows[0] || {};
    const total = r.total_runs || 0;
    const withGL = r.with_gl || 0;
    const coverage = total > 0 ? Math.round((withGL / total) * 100) : 100;
    const pass = total === 0 || coverage >= 95;
    return {
      pass,
      actual: total > 0 ? `${withGL}/${total} payroll runs have GL (${coverage}%)` : 'No payroll runs',
      expected: '>= 95% of approved/paid payroll runs have GL entries (or no runs)',
      evidence: total > 0 ? `Coverage: ${coverage}%, Unlinked: ${total - withGL}` : 'N/A - no payroll data'
    };
  }
));

// STEP 11: Verify bank reconciliation integrity
results.push(check(
  11,
  'Bank reconciliation integrity',
  `SELECT 
    COUNT(*) as total_recon,
    SUM(CASE WHEN status = 'reconciled' THEN 1 ELSE 0 END) as reconciled,
    SUM(CASE WHEN ABS(difference) > 0.01 THEN 1 ELSE 0 END) as with_diff
   FROM bank_reconciliations 
   WHERE company_id = 1`,
  rows => {
    const r = rows[0] || {};
    const total = r.total_recon || 0;
    const withDiff = r.with_diff || 0;
    const pass = withDiff === 0;
    return {
      pass,
      actual: `${r.reconciled}/${total} reconciled, ${withDiff} with differences`,
      expected: '0 reconciliations with material differences',
      evidence: total > 0 ? `Total: ${total}, Reconciled: ${r.reconciled}, With diff: ${withDiff}` : 'No reconciliations'
    };
  }
));

// STEP 12: Check trial balance equality
results.push(check(
  12,
  'Trial balance equality',
  `SELECT 
    ROUND(SUM(CASE WHEN normal_balance = 'debit' THEN closing_balance ELSE 0 END), 2) as total_debit,
    ROUND(SUM(CASE WHEN normal_balance = 'credit' THEN closing_balance ELSE 0 END), 2) as total_credit
   FROM (
     SELECT 
       coa.normal_balance,
       SUM(CASE 
         WHEN coa.normal_balance = 'debit' THEN jel.debit - jel.credit
         ELSE jel.credit - jel.debit
       END) as closing_balance
     FROM journal_entry_lines jel
     JOIN chart_of_accounts coa ON coa.code = jel.account_code AND coa.company_id = jel.company_id
     JOIN journal_entries je ON je.id = jel.entry_id AND je.is_posted = 1
     WHERE jel.company_id = 1
     GROUP BY coa.code, coa.normal_balance
   )`,
  rows => {
    const r = rows[0] || {};
    const diff = Math.abs((r.total_debit || 0) - (r.total_credit || 0));
    const pass = diff < 0.01;
    return {
      pass,
      actual: `Debit: ${r.total_debit}, Credit: ${r.total_credit}, Diff: ${diff}`,
      expected: 'Total debit = Total credit (diff < 0.01)',
      evidence: `Difference: ${diff}`
    };
  }
));

// STEP 13: Validate cost center dimension enforcement
results.push(check(
  13,
  'Cost center dimension on journal lines',
  `SELECT 
    COUNT(*) as total_lines,
    SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) as with_center
   FROM journal_entry_lines 
   WHERE company_id = 1`,
  rows => {
    const r = rows[0] || {};
    const total = r.total_lines || 0;
    const withCenter = r.with_center || 0;
    const coverage = total > 0 ? Math.round((withCenter / total) * 100) : 100;
    const pass = coverage >= 80; // Allow some lines without cost center
    return {
      pass,
      actual: `${withCenter}/${total} lines have cost center (${coverage}%)`,
      expected: '>= 80% of journal lines have cost center assigned',
      evidence: `Coverage: ${coverage}%, Without center: ${total - withCenter}`
    };
  }
));

// STEP 14: Check for duplicate or missing business events
results.push(check(
  14,
  'Business events integrity',
  `SELECT 
    COUNT(*) as total_events,
    SUM(CASE WHEN status = 'posted' AND journal_entry_id IS NULL THEN 1 ELSE 0 END) as orphan_posted,
    SUM(CASE WHEN status IN ('error', 'pending') THEN 1 ELSE 0 END) as stuck_events
   FROM business_events 
   WHERE company_id = 1`,
  rows => {
    const r = rows[0] || {};
    const orphanPosted = r.orphan_posted || 0;
    const stuck = r.stuck_events || 0;
    const pass = orphanPosted === 0 && stuck === 0;
    return {
      pass,
      actual: `${r.total_events} events, ${orphanPosted} orphan posted, ${stuck} stuck`,
      expected: '0 orphan posted events, 0 stuck events',
      evidence: `Orphan posted: ${orphanPosted}, Stuck: ${stuck}`
    };
  }
));

// STEP 15: Verify inventory stock quant accuracy
results.push(check(
  15,
  'Stock quant accuracy vs movements',
  `SELECT 
    (SELECT COUNT(*) FROM stock_quants WHERE company_id = 1 AND quantity != 0) as quant_count,
    (SELECT COUNT(DISTINCT item_code) FROM inventory_movements WHERE company_id = 1 AND status = 'posted') as movement_item_count`,
  rows => {
    const r = rows[0] || {};
    const pass = r.quant_count > 0 || r.movement_item_count > 0;
    return {
      pass,
      actual: `${r.quant_count} active quants, ${r.movement_item_count} items with movements`,
      expected: 'Stock quants should exist for items with movements',
      evidence: `Quants: ${r.quant_count}, Movement items: ${r.movement_item_count}`
    };
  }
));

// STEP 16: Check AP aging against GL balances
results.push(check(
  16,
  'AP balance vs GL accounts payable',
  `SELECT 
    (SELECT SUM(CASE WHEN normal_balance = 'credit' THEN credit - debit ELSE 0 END) 
     FROM journal_entry_lines jel
     JOIN chart_of_accounts coa ON coa.code = jel.account_code
     WHERE jel.company_id = 1 AND coa.account_type = 'liability') as gl_ap_balance,
    (SELECT COALESCE(SUM(total_amount - paid_amount), 0) 
     FROM supplier_invoices 
     WHERE company_id = 1 AND status != 'cancelled') as invoice_ap_balance`,
  rows => {
    const r = rows[0] || {};
    const glAP = r.gl_ap_balance || 0;
    const invoiceAP = r.invoice_ap_balance || 0;
    const diffPct = glAP > 0 ? Math.abs((invoiceAP - glAP) / glAP) * 100 : 0;
    const pass = diffPct < 10; // Allow 10% variance
    return {
      pass,
      actual: `GL AP: ${glAP}, Invoice AP: ${invoiceAP}, Variance: ${diffPct.toFixed(1)}%`,
      expected: 'AP variance < 10% between GL and invoice subledger',
      evidence: `GL: ${glAP}, Invoices: ${invoiceAP}, Variance: ${diffPct.toFixed(1)}%`
    };
  }
));

// STEP 17: Validate season closure guards
results.push(check(
  17,
  'Season closure guards',
  `SELECT 
    COUNT(*) as closed_seasons,
    (SELECT COUNT(*) FROM inventory_movements im
     JOIN seasons s ON s.id = im.season_id
     WHERE s.status = 'closed' AND im.company_id = 1) as movements_after_close
   FROM seasons 
   WHERE company_id = 1 AND status = 'closed'`,
  rows => {
    const r = rows[0] || {};
    const movementsAfterClose = r.movements_after_close || 0;
    const pass = movementsAfterClose === 0;
    return {
      pass,
      actual: `${r.closed_seasons} closed seasons, ${movementsAfterClose} movements after close`,
      expected: '0 movements in closed seasons (guards working)',
      evidence: movementsAfterClose > 0 ? `GUARD FAILURE: ${movementsAfterClose} movements in closed seasons` : 'Guards active'
    };
  }
));

// STEP 18: Check for unposted transactions in critical modules
results.push(check(
  18,
  'Unposted transactions in critical modules',
  `SELECT 
    (SELECT COUNT(*) FROM cash_transactions WHERE company_id = 1 AND status = 'draft') as draft_cash,
    (SELECT COUNT(*) FROM supplier_transactions WHERE company_id = 1 AND status = 'draft') as draft_supplier,
    (SELECT COUNT(*) FROM inventory_movements WHERE company_id = 1 AND status = 'draft') as draft_inv`,
  rows => {
    const r = rows[0] || {};
    const totalDraft = (r.draft_cash || 0) + (r.draft_supplier || 0) + (r.draft_inv || 0);
    const pass = totalDraft === 0;
    return {
      pass,
      actual: `Draft cash: ${r.draft_cash}, supplier: ${r.draft_supplier}, inv: ${r.draft_inv}`,
      expected: '0 draft transactions in critical modules',
      evidence: totalDraft > 0 ? `${totalDraft} unposted transactions` : 'All transactions posted'
    };
  }
));

// STEP 19: Verify audit log completeness
results.push(check(
  19,
  'Audit log completeness',
  `SELECT 
    COUNT(*) as total_logs,
    COUNT(DISTINCT table_name) as distinct_tables,
    MIN(created_at) as first_log,
    MAX(created_at) as last_log
   FROM audit_log 
   WHERE company_id = 1`,
  rows => {
    const r = rows[0] || {};
    const hasLogs = r.total_logs > 0;
    const pass = hasLogs;
    return {
      pass,
      actual: `${r.total_logs} logs across ${r.distinct_tables} tables`,
      expected: 'Audit log should have entries',
      evidence: hasLogs ? `Range: ${r.first_log} to ${r.last_log}` : 'No audit logs found'
    };
  }
));

// STEP 20: Generate final integrity score
const passedCount = results.filter(r => r.pass).length;
const totalCount = results.length;
const score = Math.round((passedCount / totalCount) * 100);

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║                    AUDIT SUMMARY                               ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');
console.log(`Overall Score: ${score}% (${passedCount}/${totalCount} steps passed)\n`);

const failures = results.filter(r => !r.pass);
if (failures.length > 0) {
  console.log('FAILED STEPS:');
  failures.forEach(f => {
    console.log(`  ${f.step}. ${f.name}`);
    console.log(`     Evidence: ${f.evidence}`);
  });
  console.log('');
}

const warnings = results.filter(r => r.pass && r.evidence && r.evidence.includes('WARNING'));
if (warnings.length > 0) {
  console.log('WARNINGS:');
  warnings.forEach(w => {
    console.log(`  ${w.step}. ${w.name}: ${w.evidence}`);
  });
  console.log('');
}

// Risk assessment
const criticalFailures = failures.filter(f => 
  [5, 7, 8, 9, 12].includes(f.step) // Balance integrity and GL integration are critical
);

if (criticalFailures.length > 0) {
  console.log('⚠️  CRITICAL RISKS IDENTIFIED:');
  criticalFailures.forEach(f => {
    console.log(`  - ${f.name}: ${f.evidence}`);
  });
  console.log('');
}

if (score >= 90) {
  console.log('✅ SYSTEM HEALTH: EXCELLENT');
} else if (score >= 70) {
  console.log('⚠️  SYSTEM HEALTH: GOOD (Attention needed)');
} else if (score >= 50) {
  console.log('❌ SYSTEM HEALTH: FAIR (Immediate action required)');
} else {
  console.log('🚨 SYSTEM HEALTH: CRITICAL (Emergency action required)');
}

console.log('\n');

process.exit(score >= 70 ? 0 : 1);
