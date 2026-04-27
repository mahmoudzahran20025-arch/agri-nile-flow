// =============================================================================
// AGRI-NILE-FLOW: Comprehensive Data Import Script v2
// Phases 5 & 6: Master Data + Transactions
// Fixed: Excel serial date parsing, correct column mappings
// =============================================================================

const XLSX = require('xlsx');
const fs   = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\mahmo\\Contacts\\CLAUDE_CO WORK MY WORK\\agri-nile-flow';
const OUT  = path.join(BASE, 'import_sql');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const COMPANY_ID = 1;
const SEASON_ID  = 1;
const BATCH      = 100;

// ─── Utility Helpers ─────────────────────────────────────────────────────────

function esc(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function num(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  const n = parseFloat(String(v).replace(/[,\s\u060c]/g, ''));
  return isNaN(n) ? 'NULL' : n;
}

function int(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  const n = parseInt(String(v).replace(/[,\s\u060c]/g, ''), 10);
  return isNaN(n) ? 'NULL' : n;
}

function toDate(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (typeof v === 'number' && v > 40000 && v < 55000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return "'" + d.toISOString().substring(0, 10) + "'";
  }
  const s = String(v).trim().replace(/\//g, '-');
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return "'" + s.substring(0, 10) + "'";
  const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return "'" + m[3] + '-' + m[2].padStart(2,'0') + '-' + m[1].padStart(2,'0') + "'";
  return 'NULL';
}

function isValidDate(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number' && v > 40000 && v < 55000) return true;
  const s = String(v).trim();
  return /^\d{4}[\/\-]\d{2}[\/\-]\d{2}/.test(s) || /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(s);
}

function writeSql(prefix, rows, sqlFn) {
  let total = 0, batch = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    batch++;
    const chunk = rows.slice(i, i + BATCH);
    const stmts = chunk.map(sqlFn).filter(Boolean);
    if (stmts.length === 0) continue;
    const fname = path.join(OUT, prefix + '_batch' + String(batch).padStart(3,'0') + '.sql');
    fs.writeFileSync(fname, stmts.join('\n') + '\n');
    total += stmts.length;
  }
  return total;
}

const log = [];
function info(msg) { console.log(msg); log.push(msg); }

// ─── Clean import_sql dir ─────────────────────────────────────────────────────
fs.readdirSync(OUT).filter(f => f.endsWith('.sql')).forEach(f => fs.unlinkSync(path.join(OUT, f)));

// ─── PHASE 5A: Suppliers ─────────────────────────────────────────────────────

info('\n=== PHASE 5A: SUPPLIERS ===');

const suppWb    = XLSX.readFile(path.join(BASE, '\u0627\u0644\u0645\u0648\u0631\u062f\u064a\u0646 \u0648\u0627\u0644\u0639\u0645\u0644\u0627\u0621 \u0646\u0648\u0627\u0629 \u0627\u0644\u0645\u0633\u062a\u0642\u0628\u06442025-2026.xlsx'), { cellDates: false });
const suppSheet = suppWb.Sheets['\u0627\u0644\u0643\u0648\u062f'];
const suppRaw   = XLSX.utils.sheet_to_json(suppSheet, { raw: true, defval: null });

info('  Total rows: ' + suppRaw.length);
if (suppRaw.length > 0) info('  Columns: ' + Object.keys(suppRaw[0]).join(', '));

// Column names are Arabic - use the actual column keys from the sheet
const suppCols = suppRaw.length > 0 ? Object.keys(suppRaw[0]) : [];
const COL_SUPP_CODE = suppCols[0]; // الكود
const COL_SUPP_NAME = suppCols[1]; // المورد
const COL_SUPP_ACT  = suppCols[2]; // النشاط
const COL_SUPP_NOTE = suppCols[3]; // ملاحظات

info('  Code col: ' + COL_SUPP_CODE + ' | Name col: ' + COL_SUPP_NAME);

const suppCount = writeSql('05a_suppliers', suppRaw, row => {
  const code = int(row[COL_SUPP_CODE]);
  const name = row[COL_SUPP_NAME] ? String(row[COL_SUPP_NAME]).trim() : null;
  if (!code || !name) return null;
  const activity = row[COL_SUPP_ACT]  ? String(row[COL_SUPP_ACT]).trim()  : null;
  const notes    = row[COL_SUPP_NOTE] ? String(row[COL_SUPP_NOTE]).trim() : null;
  return 'UPDATE suppliers SET name=' + esc(name) + ', activity=' + esc(activity) + ', notes=' + esc(notes) + ', is_active=1 WHERE code=' + code + ' AND company_id=' + COMPANY_ID + ';\n' +
         'INSERT INTO suppliers (code, company_id, name, activity, notes, is_active, created_at) SELECT ' + code + ', ' + COMPANY_ID + ', ' + esc(name) + ', ' + esc(activity) + ', ' + esc(notes) + ', 1, datetime(\'now\') WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE code=' + code + ' AND company_id=' + COMPANY_ID + ');';
});
info('  Suppliers SQL: ' + suppCount + ' rows');

// ─── PHASE 5B: Items ─────────────────────────────────────────────────────────

info('\n=== PHASE 5B: ITEMS ===');

const invWb    = XLSX.readFile(path.join(BASE, '\u0645\u062e\u0627\u0632\u0646 \u0646\u0648\u0627\u0629 \u0627\u0644\u0645\u0633\u062a\u0642\u0628\u06442025-2026.xlsx'), { cellDates: false });
const movSheet = invWb.Sheets['\u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a'];
const movRaw   = XLSX.utils.sheet_to_json(movSheet, { raw: true, defval: null });

const itemMap = new Map();
for (let i = 2; i < movRaw.length; i++) {
  const row  = movRaw[i];
  const code = row['__EMPTY_10'];
  const name = row['__EMPTY_11'];
  if (!code || !name || isNaN(parseInt(String(code)))) continue;
  const icode = parseInt(String(code).trim());
  if (!itemMap.has(icode)) {
    itemMap.set(icode, {
      code: icode,
      name: String(name).trim(),
      unit: row['__EMPTY_12'] ? String(row['__EMPTY_12']).trim() : null,
      wh:   row['__EMPTY_4']  ? String(row['__EMPTY_4']).trim()  : null,
    });
  }
}

function ppgByCode(code) {
  const s = String(code);
  if (s.startsWith('1010')) return 'FERT';
  if (s.startsWith('1020')) return 'CHEM';
  if (s.startsWith('1030')) return 'SEED';
  if (s.startsWith('105') || s.startsWith('107')) return 'EQUIP';
  return 'FERT';
}

const uniqueItems = Array.from(itemMap.values());
info('  Unique items: ' + uniqueItems.length);

const itemCount = writeSql('05b_items', uniqueItems, item => {
  const ppg = ppgByCode(item.code);
  return 'INSERT OR REPLACE INTO items (code, company_id, name, unit, warehouse, is_active, prod_posting_group_code) VALUES (' + item.code + ', ' + COMPANY_ID + ', ' + esc(item.name) + ', ' + esc(item.unit) + ', ' + esc(item.wh) + ', 1, \'' + ppg + '\');';
});
info('  Items SQL: ' + itemCount + ' rows');

// ─── PHASE 6A: Inventory Movements ───────────────────────────────────────────

info('\n=== PHASE 6A: INVENTORY MOVEMENTS ===');

// Movement type column: the column literally named 'اضافة' in xlsx header row
const movCols = movRaw.length > 0 ? Object.keys(movRaw[0]) : [];
const MOV_TYPE_COL = movCols.find(c => c === '\u0627\u0636\u0627\u0641\u0629' || c.includes('\u0627\u0636')) || '\u0627\u0636\u0627\u0641\u0629';
info('  Movement type col: ' + MOV_TYPE_COL);

const movData = movRaw.slice(2).filter(row => isValidDate(row['__EMPTY_3']));
info('  Valid movement rows: ' + movData.length);

const movCount = writeSql('06a_inventory_movements', movData, row => {
  const dStr = toDate(row['__EMPTY_3']);
  if (dStr === 'NULL') return null;
  const wh = row['__EMPTY_4'] ? String(row['__EMPTY_4']).trim() : null;
  if (!wh) return null;
  const mtype = row[MOV_TYPE_COL] ? String(row[MOV_TYPE_COL]).trim() : '\u0627\u0636\u0627\u0641\u0629';
  return 'INSERT INTO inventory_movements (company_id, season_id, supplier_code, item_code, center_code, account_code, sub_code, movement_date, warehouse, movement_type, document_number, invoice_number, po_number, package_type, pack_capacity, pack_count, quantity, unit_price, qty_in, qty_out, balance_qty, value_in, value_out, balance_value, year, month, notes, status, created_at) VALUES (' +
    [COMPANY_ID, SEASON_ID,
     int(row['__EMPTY_8']), int(row['__EMPTY_10']),
     int(row['__EMPTY_18']), int(row['__EMPTY_16']), int(row['__EMPTY_20']),
     dStr, esc(wh), esc(mtype),
     int(row['__EMPTY_5']), int(row['__EMPTY_6']), int(row['__EMPTY_7']),
     esc(row['__EMPTY_13']), num(row['__EMPTY_14']), num(row['__EMPTY_15']),
     num(row['__EMPTY_22']), num(row['__EMPTY_23']),
     num(row['__EMPTY_24']), num(row['__EMPTY_25']), num(row['__EMPTY_26']),
     num(row['__EMPTY_27']), num(row['__EMPTY_28']), num(row['__EMPTY_29']),
     int(row['__EMPTY_1']), int(row['__EMPTY_2']),
     esc(row['__EMPTY_30']), "'posted'", "datetime('now')"
    ].join(', ') + ');';
});
info('  Inventory movements SQL: ' + movCount + ' rows');

// ─── PHASE 6B: Cash Transactions ─────────────────────────────────────────────

info('\n=== PHASE 6B: CASH TRANSACTIONS ===');

const trsWb  = XLSX.readFile(path.join(BASE, '\u062e\u0632\u064a\u0646\u0629 \u0646\u0648\u0627\u0629 \u0627\u0644\u0645\u0633\u062a\u0642\u0628\u0644 2025-2026.xlsx'), { cellDates: false });
const trsSh  = trsWb.Sheets['\u0627\u0644\u0628\u064a\u0627\u0646'];
const trsRaw = XLSX.utils.sheet_to_json(trsSh, { raw: true, defval: null });

const trsCols = trsRaw.length > 0 ? Object.keys(trsRaw[0]) : [];
const TRS_DATE = trsCols[0];  // 'د' = date column
const TRS_DIR  = trsCols[1];  // 'م' = direction column
info('  Treasury date col: ' + TRS_DATE + ' | dir col: ' + TRS_DIR);

const trsData = trsRaw.filter(row => isValidDate(row[TRS_DATE]));
info('  Valid cash transaction rows: ' + trsData.length);

const trsCount = writeSql('06b_cash_transactions', trsData, row => {
  const dStr = toDate(row[TRS_DATE]);
  if (dStr === 'NULL') return null;
  const dir = row[TRS_DIR] ? String(row[TRS_DIR]).trim() : '\u062f';
  const amt = num(row['__EMPTY_12']);
  if (amt === 'NULL') return null;
  return 'INSERT INTO cash_transactions (company_id, season_id, supplier_code, center_code, expense_code, sub_code, transaction_date, direction, document_number, recipient_name, narration, season_service, unit, quantity, unit_price, amount, debit, credit, running_balance, year, month, notes, status, created_at) VALUES (' +
    [COMPANY_ID, SEASON_ID,
     int(row['__EMPTY_5']), int(row['__EMPTY_6']), int(row['__EMPTY_7']), int(row['__EMPTY_8']),
     dStr, esc(dir), int(row['__EMPTY']),
     esc(row['__EMPTY_1']), esc(row['__EMPTY_2']), esc(row['__EMPTY_3']),
     esc(row['__EMPTY_9']), num(row['__EMPTY_10']), num(row['__EMPTY_11']),
     amt, num(row['__EMPTY_13']), num(row['__EMPTY_14']), num(row['__EMPTY_15']),
     int(row['__EMPTY_21']), int(row['__EMPTY_22']),
     esc(row['__EMPTY_4']), "'posted'", "datetime('now')"
    ].join(', ') + ');';
});
info('  Cash transactions SQL: ' + trsCount + ' rows');

// ─── PHASE 6C: Supplier Transactions ─────────────────────────────────────────

info('\n=== PHASE 6C: SUPPLIER TRANSACTIONS ===');

const suppTrSh  = suppWb.Sheets['\u0627\u0644\u0628\u064a\u0627\u0646'];
const suppTrRaw = XLSX.utils.sheet_to_json(suppTrSh, { raw: true, defval: null });

const stCols = suppTrRaw.length > 0 ? Object.keys(suppTrRaw[0]) : [];
const ST_DIR = stCols[1];  // 'د' = entry_type
info('  Supplier trans date col: __EMPTY | dir col: ' + ST_DIR);

// __EMPTY=date(serial), ST_DIR=entry_type
// __EMPTY_1=supplier_code, __EMPTY_3=expense_cat, __EMPTY_4=doc_type
// __EMPTY_7=equipment, __EMPTY_11=center_code
// __EMPTY_15=unit, __EMPTY_16=qty, __EMPTY_17=unit_price
// __EMPTY_18=amount, __EMPTY_19=debit, __EMPTY_20=credit
// __EMPTY_23=balance, __EMPTY_26=year, __EMPTY_27=month

const suppTrData = suppTrRaw.filter(row => isValidDate(row['__EMPTY']));
info('  Valid supplier transaction rows: ' + suppTrData.length);

const suppTrCount = writeSql('06c_supplier_transactions', suppTrData, row => {
  const dStr = toDate(row['__EMPTY']);
  if (dStr === 'NULL') return null;
  const entryType = row[ST_DIR] ? String(row[ST_DIR]).trim() : '\u062f';
  const amount    = num(row['__EMPTY_18']);
  if (amount === 'NULL') return null;
  return 'INSERT INTO supplier_transactions (company_id, season_id, supplier_code, center_code, transaction_date, entry_type, expense_category, equipment, document_type, unit, quantity, unit_price, amount, debit, credit, balance_with_checks, year, month, status, created_at) VALUES (' +
    [COMPANY_ID, SEASON_ID,
     int(row['__EMPTY_1']), int(row['__EMPTY_11']),
     dStr, esc(entryType),
     esc(row['__EMPTY_3']), esc(row['__EMPTY_7']), esc(row['__EMPTY_4']),
     esc(row['__EMPTY_15']), num(row['__EMPTY_16']), num(row['__EMPTY_17']),
     amount, num(row['__EMPTY_19']), num(row['__EMPTY_20']),
     num(row['__EMPTY_23']), int(row['__EMPTY_26']), int(row['__EMPTY_27']),
     "'posted'", "datetime('now')"
    ].join(', ') + ');';
});
info('  Supplier transactions SQL: ' + suppTrCount + ' rows');

// ─── Summary ─────────────────────────────────────────────────────────────────

info('\n=== GENERATION COMPLETE ===');

const sqlFiles = fs.readdirSync(OUT).filter(f => f.endsWith('.sql')).sort();
info('SQL files: ' + sqlFiles.length);
sqlFiles.forEach(f => {
  const content = fs.readFileSync(path.join(OUT, f), 'utf8');
  const stmts   = content.split('\n').filter(l => l.trim().startsWith('INSERT')).length;
  info('  ' + f + ': ' + stmts + ' rows');
});

const summary = {
  generated_at: new Date().toISOString(),
  phases: {
    suppliers: suppCount, items: itemCount,
    inventory_movements: movCount,
    cash_transactions: trsCount,
    supplier_transactions: suppTrCount,
    total: suppCount + itemCount + movCount + trsCount + suppTrCount,
  },
  sql_files: sqlFiles.length,
};
fs.writeFileSync(path.join(BASE, 'import_generation_summary.json'), JSON.stringify(summary, null, 2));
info('\nSaved: import_generation_summary.json');
