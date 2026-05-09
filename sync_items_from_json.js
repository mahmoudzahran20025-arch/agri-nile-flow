/**
 * sync_items_from_json.js
 * ─────────────────────────────────────────────────────────────────────────────
 * JSON-first sync: treats مخازن_نواة_المستقبل_2025-2026_كامل.json as the SOLE
 * authoritative item catalog.  Generates two SQL files:
 *
 *   sync_items_upsert.sql    → INSERT-or-UPDATE every item in the JSON.
 *                              Safe to re-run any time (idempotent).
 *                              Preserves category_id / track_lots / reorder_threshold.
 *
 *   sync_items_deactivate.sql → Soft-delete (is_active=0) every item currently
 *                              in the DB that is NO LONGER in the JSON and has
 *                              NO inventory movements.  Items that have ever
 *                              moved are never touched (accounting safety).
 *
 * Usage:
 *   node sync_items_from_json.js            # generate both SQL files + summary
 *   node sync_items_from_json.js --dry-run  # print summary only, no files
 *
 * Apply (remote D1):
 *   npx wrangler d1 execute agri-nile-db --remote --file=sync_items_upsert.sql
 *   npx wrangler d1 execute agri-nile-db --remote --file=sync_items_deactivate.sql
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';
const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const JSON_FILE   = 'مخازن_نواة_المستقبل_2025-2026_كامل.json';
const COMPANY_ID  = 1;
const DRY_RUN     = process.argv.includes('--dry-run');

// ── Posting-group map (warehouse type → prod + inv posting group codes) ───────
const POSTING_MAP = {
  'اسمدة':          { prod: 'FERT',    inv: 'FERT-WH' },
  'مبيدات':         { prod: 'CHEM',    inv: 'CHEM-WH' },
  'تقاوي وبذور':    { prod: 'SEED',    inv: 'SEED-WH' },
  'زيوت ووقود':     { prod: 'FERT',    inv: 'FERT-WH' },
  'شبكات ري':       { prod: 'EQUIP',   inv: 'MAIN-WH' },
  'عدد وادوات':     { prod: 'EQUIP',   inv: 'MAIN-WH' },
  'قطع غيار':       { prod: 'EQUIP',   inv: 'MAIN-WH' },
  'تعبئة وتغليف':   { prod: 'FERT',    inv: 'FERT-WH' },
  'متنوعات':        { prod: 'EQUIP',   inv: 'MAIN-WH' },
  'اصول ثابتة':     { prod: 'EQUIP',   inv: 'MAIN-WH' },
  'انتاج تام':      { prod: 'HARVEST', inv: 'MAIN-WH' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(str) {
  // SQLite string literal: replace single-quote with ''
  return String(str ?? '').replace(/'/g, "''");
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Load JSON ─────────────────────────────────────────────────────────────────
console.log('Loading JSON …');
const data  = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
const items = data['الأكواد_المرجعية']['الأصناف']['البيانات'];
console.log(`  Items in JSON: ${items.length}`);

// Deduplicate by code (keep last occurrence if duplicate codes exist)
const jsonMap = new Map();
for (const item of items) {
  const code = Number(item['كود_الصنف']);
  if (!code || isNaN(code)) continue;
  jsonMap.set(code, {
    code,
    name:      String(item['الصنف']       || '').trim(),
    unit:      String(item['الوحدة']       || 'وحدة').trim(),
    warehouse: String(item['نوع_المخزن']   || '').trim(),
  });
}
console.log(`  Unique codes:  ${jsonMap.size}`);

// ── Build upsert SQL ──────────────────────────────────────────────────────────
const upsertLines = [];

upsertLines.push('-- ============================================================');
upsertLines.push('-- sync_items_upsert.sql');
upsertLines.push(`-- Generated: ${new Date().toISOString()}`);
upsertLines.push(`-- Source:    ${JSON_FILE}`);
upsertLines.push(`-- Items:     ${jsonMap.size}`);
upsertLines.push('-- Safe to re-run (idempotent INSERT … ON CONFLICT DO UPDATE).');
upsertLines.push('-- Preserves: category_id, track_lots, reorder_threshold.');
upsertLines.push('-- ============================================================');
upsertLines.push('');

let upsertCount = 0;
for (const [, item] of jsonMap) {
  const pg = POSTING_MAP[item.warehouse] ?? { prod: 'EQUIP', inv: 'MAIN-WH' };
  upsertLines.push(
    `INSERT INTO items (code, company_id, name, unit, warehouse, is_active, prod_posting_group_code, inv_posting_group_code)` +
    ` VALUES (${item.code}, ${COMPANY_ID}, '${esc(item.name)}', '${esc(item.unit)}', '${esc(item.warehouse)}', 1, '${pg.prod}', '${pg.inv}')` +
    ` ON CONFLICT(code, company_id) DO UPDATE SET` +
    `   name = excluded.name,` +
    `   unit = excluded.unit,` +
    `   warehouse = excluded.warehouse,` +
    `   is_active = 1,` +
    `   prod_posting_group_code = excluded.prod_posting_group_code,` +
    `   inv_posting_group_code  = excluded.inv_posting_group_code;`
  );
  upsertCount++;
}

upsertLines.push('');
upsertLines.push(`-- ${upsertCount} statements generated.`);

// ── Build deactivate SQL ──────────────────────────────────────────────────────
//
// Strategy: set is_active=0 for items currently active in the DB whose code
// does NOT appear in the JSON AND which have NEVER had an inventory movement.
// Items with movements are protected (accounting trail must stay intact).
//
// We build the NOT IN list from the JSON codes.  SQLite handles 4000+ values
// in NOT IN fine.  D1 handles files up to 10 MB.
//
const allCodes = [...jsonMap.keys()].join(', ');

const deactivateLines = [];
deactivateLines.push('-- ============================================================');
deactivateLines.push('-- sync_items_deactivate.sql');
deactivateLines.push(`-- Generated: ${new Date().toISOString()}`);
deactivateLines.push('-- Soft-deletes items removed from the JSON that have no');
deactivateLines.push('-- inventory movements (safe to reactivate any time).');
deactivateLines.push('-- ============================================================');
deactivateLines.push('');
deactivateLines.push(
  `UPDATE items\n` +
  `SET    is_active = 0\n` +
  `WHERE  company_id = ${COMPANY_ID}\n` +
  `  AND  is_active  = 1\n` +
  `  AND  code NOT IN (${allCodes})\n` +
  `  AND  code NOT IN (\n` +
  `         SELECT DISTINCT item_code\n` +
  `         FROM   inventory_movements\n` +
  `         WHERE  company_id = ${COMPANY_ID}\n` +
  `       );`
);
deactivateLines.push('');
deactivateLines.push(
  `-- INFORMATIONAL (run separately to preview what will be deactivated):\n` +
  `-- SELECT code, name, warehouse FROM items\n` +
  `-- WHERE company_id = ${COMPANY_ID} AND is_active = 1\n` +
  `--   AND code NOT IN (${allCodes.slice(0, 120)} ...)\n` +
  `--   AND code NOT IN (SELECT DISTINCT item_code FROM inventory_movements WHERE company_id=${COMPANY_ID});`
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('');
console.log('══════════════════════════════════════════════════════════');
console.log('  SYNC PLAN SUMMARY');
console.log('══════════════════════════════════════════════════════════');
console.log(`  Upsert statements:    ${upsertCount}  (INSERT new + UPDATE changed)`);
console.log(`  Deactivate query:     1  (soft-delete items removed from JSON,`);
console.log(`                            skips items with inventory movements)`);
console.log('');

// Warehouse breakdown
const warehouseCount = {};
for (const [, item] of jsonMap) {
  warehouseCount[item.warehouse] = (warehouseCount[item.warehouse] ?? 0) + 1;
}
console.log('  Items per warehouse:');
for (const [wh, cnt] of Object.entries(warehouseCount).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${wh.padEnd(20)} ${cnt}`);
}
console.log('');

// Posting group breakdown
const pgCount = {};
for (const [, item] of jsonMap) {
  const pg = POSTING_MAP[item.warehouse]?.prod ?? 'EQUIP';
  pgCount[pg] = (pgCount[pg] ?? 0) + 1;
}
console.log('  Items per posting group:');
for (const [pg, cnt] of Object.entries(pgCount).sort((a, b) => b[1] - a[1])) {
  const inv = Object.values(POSTING_MAP).find(m => m.prod === pg)?.inv ?? '?';
  console.log(`    ${pg.padEnd(10)} → ${inv.padEnd(10)} ${cnt} items`);
}
console.log('');

if (DRY_RUN) {
  console.log('  DRY RUN: no files written.');
} else {
  const UPSERT_FILE     = 'sync_items_upsert.sql';
  const DEACTIVATE_FILE = 'sync_items_deactivate.sql';

  fs.writeFileSync(UPSERT_FILE,     upsertLines.join('\n'),     'utf8');
  fs.writeFileSync(DEACTIVATE_FILE, deactivateLines.join('\n'), 'utf8');

  const upsertSizeKB = Math.round(fs.statSync(UPSERT_FILE).size / 1024);
  console.log(`  ✓ ${UPSERT_FILE} (${upsertSizeKB} KB)`);
  console.log(`  ✓ ${DEACTIVATE_FILE}`);
  console.log('');
  console.log('  Apply to remote D1:');
  console.log(`    npx wrangler d1 execute agri-nile-db --remote --file=${UPSERT_FILE}`);
  console.log(`    npx wrangler d1 execute agri-nile-db --remote --file=${DEACTIVATE_FILE}`);
}

console.log('══════════════════════════════════════════════════════════');
