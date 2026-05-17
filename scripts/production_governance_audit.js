#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');

const DB_NAME = 'agri-nile-flow-data-lake';
const COMPANY_ID = 1;

function runD1(sql) {
  const compactSql = sql.replace(/\s+/g, ' ').trim();
  const escapedSql = compactSql.replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --yes --json --command "${escapedSql}"`;
  try {
    return execSync(cmd, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } catch (error) {
    const out = `${error.stdout || ''}\n${error.stderr || ''}`.trim();
    throw new Error(`D1 execution failed: ${out}`);
  }
}

function parseD1Json(raw) {
  if (!raw) return null;

  // Wrangler can prepend non-JSON text in some environments; parse only the JSON block.
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end < 0 || end < start) return null;

  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function scalar(sql) {
  const raw = runD1(sql);
  const parsed = parseD1Json(raw);
  if (!parsed || !parsed[0] || !Array.isArray(parsed[0].results) || parsed[0].results.length === 0) {
    return 0;
  }

  const firstRow = parsed[0].results[0];
  const firstValue = Object.values(firstRow)[0];
  const n = Number(firstValue);
  return Number.isFinite(n) ? n : 0;
}

function emitFinding(severity, domain, issue, detail, fix) {
  const icon = severity === 'BLOCKING' ? '🔴' : severity === 'WARNING' ? '🟡' : '🔵';
  console.log(`${icon} [${domain}] ${issue}: ${detail}`);
  if (fix) console.log(`   ↳ ${fix}`);
}

let blocking = 0;
let warning = 0;
let info = 0;
const findings = [];

function addFinding(severity, domain, issue, detail, fix = '') {
  findings.push({ severity, domain, issue, detail, fix });
  if (severity === 'BLOCKING') blocking += 1;
  if (severity === 'WARNING') warning += 1;
  if (severity === 'INFO') info += 1;
  emitFinding(severity, domain, issue, detail, fix);
}

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║    PRODUCTION GOVERNANCE AUDIT — Pre-Phase 4 Posting          ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

console.log('▌ 1. SUPPLIER POSTING READINESS\n');
const suppliers = scalar(`SELECT COUNT(*) AS v FROM suppliers WHERE company_id=${COMPANY_ID}`);
const supplierTxns = scalar(`SELECT COUNT(*) AS v FROM supplier_transactions WHERE company_id=${COMPANY_ID}`);
const suppliersMissingGl = scalar(`SELECT COUNT(*) AS v FROM suppliers WHERE company_id=${COMPANY_ID} AND (gl_account_code IS NULL OR TRIM(gl_account_code) = '')`);
const orphanSupplierTxns = scalar(`
  SELECT COUNT(*) AS v
  FROM supplier_transactions st
  WHERE st.company_id=${COMPANY_ID}
    AND (st.supplier_code IS NULL OR st.supplier_code NOT IN (
      SELECT s.code FROM suppliers s WHERE s.company_id=${COMPANY_ID}
    ))
`);

console.log(`   Suppliers: ${suppliers}`);
console.log(`   Supplier Transactions: ${supplierTxns}`);

if (suppliersMissingGl > 0) {
  addFinding('BLOCKING', 'Suppliers', 'Missing GL Accounts', `${suppliersMissingGl} supplier(s) lack gl_account_code`, 'Assign valid supplier control accounts before posting.');
}
if (orphanSupplierTxns > 0) {
  addFinding('BLOCKING', 'Suppliers', 'Orphan Supplier Transactions', `${orphanSupplierTxns} transaction(s) reference missing/blank supplier_code`, 'Fix supplier_code mapping or remove invalid rows.');
}

console.log('\n▌ 2. INVENTORY POSTING READINESS\n');
const inventoryMovements = scalar(`SELECT COUNT(*) AS v FROM inventory_movements WHERE company_id=${COMPANY_ID}`);
const badQty = scalar(`SELECT COUNT(*) AS v FROM inventory_movements WHERE company_id=${COMPANY_ID} AND (quantity IS NULL OR quantity <= 0)`);
const badPrice = scalar(`SELECT COUNT(*) AS v FROM inventory_movements WHERE company_id=${COMPANY_ID} AND (unit_price IS NULL OR unit_price < 0)`);
const badItem = scalar(`SELECT COUNT(*) AS v FROM inventory_movements WHERE company_id=${COMPANY_ID} AND (item_code IS NULL OR TRIM(item_code) = '')`);
const invalidMovementType = scalar(`
  SELECT COUNT(*) AS v
  FROM inventory_movements
  WHERE company_id=${COMPANY_ID}
    AND movement_type NOT IN ('GRN','ISSUE','RETURN_SUPPLIER','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT_IN','ADJUSTMENT_OUT')
`);

console.log(`   Inventory Movements: ${inventoryMovements}`);

if (badQty > 0) {
  addFinding('BLOCKING', 'Inventory', 'Invalid Quantities', `${badQty} movement(s) have quantity <= 0 or NULL`, 'Correct quantities before posting valuation entries.');
}
if (badPrice > 0) {
  addFinding('BLOCKING', 'Inventory', 'Invalid Unit Prices', `${badPrice} movement(s) have unit_price < 0 or NULL`, 'Backfill/correct valuation basis.');
}
if (badItem > 0) {
  addFinding('BLOCKING', 'Inventory', 'Missing Item Codes', `${badItem} movement(s) missing item_code`, 'Map all movements to valid inventory item codes.');
}
if (invalidMovementType > 0) {
  addFinding('BLOCKING', 'Inventory', 'Invalid Movement Types', `${invalidMovementType} movement(s) have non-postable movement_type`, 'Restrict movement_type to posting enum set.');
}

console.log('\n▌ 3. TREASURY POSTING READINESS\n');
const cashTxns = scalar(`SELECT COUNT(*) AS v FROM cash_transactions WHERE company_id=${COMPANY_ID}`);
const badCash = scalar(`
  SELECT COUNT(*) AS v
  FROM cash_transactions
  WHERE company_id=${COMPANY_ID}
    AND (
      amount IS NULL
      OR amount <= 0
      OR direction IS NULL
      OR TRIM(direction) = ''
      OR transaction_date IS NULL
    )
`);

console.log(`   Cash Transactions: ${cashTxns}`);

if (badCash > 0) {
  addFinding('WARNING', 'Treasury', 'Incomplete Cash Data', `${badCash} cash transaction(s) have missing/invalid posting fields`, 'Complete amount/direction/date before posting run.');
}

console.log('\n▌ 4. CROSS-DOMAIN INTEGRITY\n');
const futureDatedInv = scalar(`SELECT COUNT(*) AS v FROM inventory_movements WHERE company_id=${COMPANY_ID} AND movement_date > date('now')`);
const orphanLinks = scalar(`
  SELECT COUNT(*) AS v
  FROM source_documents sd
  LEFT JOIN business_events be
    ON be.id = sd.event_id
   AND be.company_id = sd.company_id
  WHERE sd.company_id = ${COMPANY_ID}
    AND sd.event_id IS NOT NULL
    AND be.id IS NULL
`);

if (futureDatedInv > 0) {
  addFinding('WARNING', 'CrossDomain', 'Future-Dated Inventory', `${futureDatedInv} movement(s) dated in future`, 'Correct transaction dates.');
}
if (orphanLinks > 0) {
  addFinding('BLOCKING', 'CrossDomain', 'Orphan Source Documents', `${orphanLinks} source_document row(s) have no matching business_event`, 'Clean orphan bridge data before posting.');
}
if (futureDatedInv === 0 && orphanLinks === 0) {
  addFinding('INFO', 'CrossDomain', 'Referential Integrity', 'No cross-domain orphan/future-date issues detected.');
}

console.log('\n▌ 5. EQUIPMENT POSTING TREATMENT\n');
const equipmentRows = scalar(`SELECT COUNT(*) AS v FROM work_order_equipment WHERE company_id=${COMPANY_ID}`);
if (equipmentRows > 0) {
  addFinding('INFO', 'Equipment', 'Equipment Activity Detected', `${equipmentRows} work_order_equipment row(s) present`, 'Ensure CAPEX/OPEX posting treatment is configured before equipment posting rollout.');
} else {
  addFinding('INFO', 'Equipment', 'No Equipment Load', 'No equipment-linked work orders in current scope.');
}

console.log('\n▌ 6. TRANSACTION VOLUME\n');
const totalPostableEvents = suppliers + supplierTxns + inventoryMovements + cashTxns;
console.log(`   📊 Total Postable Events: ${totalPostableEvents}\n`);

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║                       AUDIT DECISION                           ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');
console.log(`   🔴 BLOCKING: ${blocking} | 🟡 WARNING: ${warning} | 🔵 INFO: ${info}`);

const decision = blocking > 0 ? 'NO-GO' : warning > 0 ? 'CONDITIONAL GO' : 'GO';
const successRate = blocking > 0 ? '0%' : `${Math.max(0, 100 - warning * 5)}%`;

console.log(`\n   ✅ PHASE 4 POSTING: ${decision}`);
if (decision === 'NO-GO') {
  console.log(`\n   ❌ BLOCKED — Resolve ${blocking} critical issue(s)`);
} else if (decision === 'CONDITIONAL GO') {
  console.log(`\n   ⚠️  CONDITIONAL — Address ${warning} warning(s) before cutover`);
} else {
  console.log('\n   ✅ CLEARED — Ready for Phase 4');
}
console.log(`\n   📈 Success Rate: ${successRate}\n`);

const report = {
  timestamp: new Date().toISOString(),
  company_id: COMPANY_ID,
  database: DB_NAME,
  decision,
  summary: {
    blocking,
    warning,
    info,
    success_rate: successRate,
    total_postable_events: totalPostableEvents,
  },
  volumes: {
    suppliers,
    supplier_transactions: supplierTxns,
    inventory_movements: inventoryMovements,
    cash_transactions: cashTxns,
  },
  checks: {
    suppliers_missing_gl: suppliersMissingGl,
    orphan_supplier_transactions: orphanSupplierTxns,
    inventory_bad_qty: badQty,
    inventory_bad_price: badPrice,
    inventory_bad_item: badItem,
    inventory_invalid_movement_type: invalidMovementType,
    treasury_incomplete_rows: badCash,
    crossdomain_future_inventory_dates: futureDatedInv,
    crossdomain_orphan_source_documents: orphanLinks,
    equipment_rows: equipmentRows,
  },
  findings,
};

fs.mkdirSync('reports', { recursive: true });
const reportPath = 'reports/PRODUCTION_GOVERNANCE_AUDIT_2026-05-09.json';
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`✅ Report: ${reportPath}\n`);

process.exit(decision === 'NO-GO' ? 1 : 0);
