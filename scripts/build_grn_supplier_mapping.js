#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const DB_NAME = 'agri-nile-flow-data-lake';
const COMPANY_ID = 1;
const SOURCE_FILE = path.join(
  process.cwd(),
  '\u0645\u062e\u0627\u0632\u0646_\u0646\u0648\u0627\u0629_\u0627\u0644\u0645\u0633\u062a\u0642\u0628\u0644_2025-2026_\u0643\u0627\u0645\u0644.json'
);

const K_ROOT_TX = '\u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a_\u0627\u0644\u0631\u0626\u064a\u0633\u064a\u0629';
const K_TX_ROWS = '\u0627\u0644\u0645\u0639\u0627\u0645\u0644\u0627\u062a';
const K_TYPE = '\u0627\u0644\u0646\u0648\u0639';
const V_ADD = '\u0627\u0636\u0627\u0641\u0629';
const K_DATE = '\u0627\u0644\u062a\u0627\u0631\u064a\u062e';
const K_ITEM = '\u0643\u0648\u062f \u0627\u0644\u0635\u0646\u0641';
const K_WAREHOUSE = '\u0627\u0644\u0645\u062e\u0632\u0646';
const K_QTY_IN = '\u0643\u0645\u064a\u0629 \u0627\u0644\u0648\u0627\u0631\u062f';
const K_QTY = '\u0627\u0644\u0643\u0645\u064a\u0629';
const K_VAL_IN = '\u0642\u064a\u0645\u0629 \u0627\u0644\u0648\u0627\u0631\u062f';
const K_SUPPLIER = '\u0643\u0648\u062f \u0627\u0644\u0645\u0648\u0631\u062f';
const K_DOC = '\u0631\u0642\u0645 \u0627\u0644\u0645\u0633\u062a\u0646\u062f';

function runWranglerJson(sql) {
  const compact = sql.replace(/\s+/g, ' ').trim().replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --yes --json --command "${compact}"`;
  const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const start = out.indexOf('[');
  const end = out.lastIndexOf(']');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Failed to parse Wrangler JSON output');
  }
  return JSON.parse(out.slice(start, end + 1));
}

function dOnly(v) {
  return String(v || '').slice(0, 10);
}

function n(v) {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function eqNum(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.0001;
}

function main() {
  const unresolved = runWranglerJson(`
    SELECT
      id,
      movement_date,
      movement_type,
      item_code,
      warehouse,
      qty_in,
      value_in,
      supplier_code
    FROM inventory_movements
    WHERE company_id = ${COMPANY_ID}
      AND status = 'posted'
      AND COALESCE(value_in, 0) > 0
      AND COALESCE(qty_in, 0) > 0
      AND (movement_type = 'اضافة' OR UPPER(movement_type) IN ('RECEIPT', 'GRN'))
      AND supplier_code IS NULL
    ORDER BY movement_date, id;
  `)[0]?.results || [];

  const sourceJson = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8').replace(/^\uFEFF/, ''));
  const rows = sourceJson?.[K_ROOT_TX]?.[K_TX_ROWS] || [];

  const sourceAdds = rows
    .filter((r) => String(r?.[K_TYPE] || '') === V_ADD)
    .map((r) => ({
      date: dOnly(r?.[K_DATE]),
      item: n(r?.[K_ITEM]),
      warehouse: String(r?.[K_WAREHOUSE] || ''),
      qty: n(r?.[K_QTY_IN] ?? r?.[K_QTY]),
      val: n(r?.[K_VAL_IN]),
      supplier: n(r?.[K_SUPPLIER]),
      doc: n(r?.[K_DOC]),
    }));

  const deterministic = [];
  const unresolvedStill = [];

  for (const u of unresolved) {
    const matches = sourceAdds.filter((s) =>
      s.date === dOnly(u.movement_date) &&
      s.item === n(u.item_code) &&
      s.warehouse === String(u.warehouse || '') &&
      eqNum(s.qty, u.qty_in) &&
      eqNum(s.val, u.value_in)
    );

    const suppliers = [...new Set(matches.map((m) => m.supplier).filter((x) => x !== null))];

    if (suppliers.length === 1) {
      deterministic.push({
        id: u.id,
        supplier_code: suppliers[0],
        movement_date: u.movement_date,
        item_code: u.item_code,
        warehouse: u.warehouse,
        qty_in: u.qty_in,
        value_in: u.value_in,
        source_matches: matches.length,
      });
    } else {
      unresolvedStill.push({
        id: u.id,
        movement_date: u.movement_date,
        item_code: u.item_code,
        warehouse: u.warehouse,
        qty_in: u.qty_in,
        value_in: u.value_in,
        source_rows: matches.length,
        supplier_candidates: suppliers,
      });
    }
  }

  const outDir = path.join(process.cwd(), 'reports', 'canonical_mapping');
  fs.mkdirSync(outDir, { recursive: true });

  const sql = [
    '-- Deterministic GRN supplier backfill from source inventory file',
    '-- Rule: exact match on movement_date + item_code + warehouse + qty_in + value_in',
    '-- Only one-supplier candidates are updated; ambiguous rows are skipped.',
    ...deterministic.map(
      (m) =>
        `UPDATE inventory_movements SET supplier_code = ${m.supplier_code} WHERE company_id = ${COMPANY_ID} AND id = ${m.id} AND supplier_code IS NULL;`
    ),
  ].join('\n') + '\n';

  fs.writeFileSync(path.join(outDir, 'grn_supplier_deterministic_backfill.sql'), sql, 'utf8');
  fs.writeFileSync(path.join(outDir, 'grn_supplier_mapping_deterministic.json'), JSON.stringify(deterministic, null, 2));
  fs.writeFileSync(path.join(outDir, 'grn_supplier_mapping_unresolved.json'), JSON.stringify(unresolvedStill, null, 2));

  console.log(
    JSON.stringify(
      {
        total_unresolved_grn: unresolved.length,
        deterministic_updates: deterministic.length,
        unresolved_after_safe_match: unresolvedStill.length,
        sql_file: 'reports/canonical_mapping/grn_supplier_deterministic_backfill.sql',
      },
      null,
      2
    )
  );
}

main();
