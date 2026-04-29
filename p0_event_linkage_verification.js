#!/usr/bin/env node
/**
 * P0 Event-Linkage Verification
 *
 * Verifies that posted operational records are connected to GL through either:
 * 1) direct journal_entry_id linkage, or
 * 2) posted business_event linkage (idempotent key path).
 *
 * Usage:
 *   node p0_event_linkage_verification.js
 */

const { execSync } = require('child_process');

const DB = 'agri-nile-flow-data-lake';
const COMPANY_ID = Number(process.env.COMPANY_ID || 1);
const CUTOFF_DATE = process.env.CUTOFF_DATE || new Date().toISOString().slice(0, 10);

function query(sql) {
  const cmd = `npx wrangler d1 execute ${DB} --remote --json --command "${sql.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
  const raw = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const parsed = JSON.parse(raw);
  return parsed[0]?.results ?? [];
}

function check(name, sql, validator) {
  try {
    const rows = query(sql);
    const result = validator(rows);
    const icon = result.pass ? 'PASS' : 'FAIL';
    console.log(`[${icon}] ${name}`);
    if (!result.pass) {
      console.log(`  expected: ${result.expected}`);
      console.log(`  actual:   ${result.actual}`);
    }
    return result.pass;
  } catch (err) {
    console.log(`[FAIL] ${name}`);
    console.log(`  error: ${err.message}`);
    return false;
  }
}

console.log('P0 verification: event-backed posting and linkage integrity\n');
console.log(`Scope: company_id=${COMPANY_ID}, transaction_date >= ${CUTOFF_DATE}\n`);

const checks = [];

checks.push(check(
  'Posted business_events must have journal_entry_id',
  `SELECT COUNT(*) AS n
   FROM business_events
   WHERE company_id = ${COMPANY_ID}
     AND status = 'posted'
     AND journal_entry_id IS NULL`,
  rows => {
    const n = rows[0]?.n ?? 0;
    return { pass: n === 0, expected: '0', actual: String(n) };
  }
));

checks.push(check(
  'Posted inventory rows must link to journal or posted event',
  `SELECT COUNT(*) AS n
   FROM inventory_movements im
   WHERE im.company_id = ${COMPANY_ID}
     AND im.status = 'posted'
     AND im.movement_date >= '${CUTOFF_DATE}'
     AND im.journal_entry_id IS NULL
     AND NOT EXISTS (
       SELECT 1
       FROM business_events be
       WHERE be.company_id = im.company_id
         AND be.source_module = 'inventory'
         AND be.source_id = im.id
         AND be.status = 'posted'
         AND be.event_type IN ('inventory_movement', 'inventory_transfer', 'purchase_receipt')
     )`,
  rows => {
    const n = rows[0]?.n ?? 0;
    return { pass: n === 0, expected: '0', actual: String(n) };
  }
));

checks.push(check(
  'Posted cash rows must link to journal or posted event',
  `SELECT COUNT(*) AS n
   FROM cash_transactions ct
   WHERE ct.company_id = ${COMPANY_ID}
     AND ct.status = 'posted'
     AND ct.transaction_date >= '${CUTOFF_DATE}'
     AND ct.journal_entry_id IS NULL
     AND NOT EXISTS (
       SELECT 1
       FROM business_events be
       WHERE be.company_id = ct.company_id
         AND be.source_module = 'treasury'
         AND be.source_id = ct.id
         AND be.status = 'posted'
         AND be.event_type IN ('cash_transaction', 'expense', 'partner_capital', 'partner_current', 'contract_advance')
     )`,
  rows => {
    const n = rows[0]?.n ?? 0;
    return { pass: n === 0, expected: '0', actual: String(n) };
  }
));

checks.push(check(
  'Supplier rows with posted supplier events must have journal_entry_id',
  `SELECT COUNT(*) AS n
   FROM supplier_transactions st
   JOIN business_events be
     ON be.company_id = st.company_id
    AND be.source_module = 'suppliers'
    AND be.source_id = st.id
    AND be.status = 'posted'
    AND be.event_type IN ('supplier_invoice', 'supplier_payment')
   WHERE st.company_id = ${COMPANY_ID}
     AND st.status = 'posted'
     AND st.transaction_date >= '${CUTOFF_DATE}'
     AND st.journal_entry_id IS NULL`,
  rows => {
    const n = rows[0]?.n ?? 0;
    return { pass: n === 0, expected: '0', actual: String(n) };
  }
));

checks.push(check(
  'Supplier mirror rows (from cash) must inherit cash journal link',
  `SELECT COUNT(*) AS n
   FROM supplier_transactions st
   JOIN cash_transactions ct
     ON ct.company_id = st.company_id
    AND st.local_id IS NOT NULL
    AND st.local_id = ('st_' || ct.local_id)
   WHERE st.company_id = ${COMPANY_ID}
     AND st.status = 'posted'
     AND st.transaction_date >= '${CUTOFF_DATE}'
     AND ct.journal_entry_id IS NOT NULL
     AND st.journal_entry_id IS NULL`,
  rows => {
    const n = rows[0]?.n ?? 0;
    return { pass: n === 0, expected: '0', actual: String(n) };
  }
));

checks.push(check(
  'No duplicate idempotency keys in business_events',
  `SELECT COUNT(*) AS n
   FROM (
     SELECT company_id, source_module, source_id, event_type, COUNT(*) AS c
     FROM business_events
     WHERE company_id = ${COMPANY_ID}
     GROUP BY company_id, source_module, source_id, event_type
     HAVING c > 1
   )`,
  rows => {
    const n = rows[0]?.n ?? 0;
    return { pass: n === 0, expected: '0', actual: String(n) };
  }
));

checks.push(check(
  'No posted business_event journal refs pointing to missing entries',
  `SELECT COUNT(*) AS n
   FROM business_events be
   WHERE be.company_id = ${COMPANY_ID}
     AND be.status = 'posted'
     AND be.journal_entry_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM journal_entries je
       WHERE je.id = be.journal_entry_id
         AND je.company_id = be.company_id
     )`,
  rows => {
    const n = rows[0]?.n ?? 0;
    return { pass: n === 0, expected: '0', actual: String(n) };
  }
));

const passed = checks.filter(Boolean).length;
const total = checks.length;

console.log(`\nSummary: ${passed}/${total} checks passed.`);
process.exit(passed === total ? 0 : 1);
