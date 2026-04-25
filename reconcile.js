#!/usr/bin/env node
// Agri-Nile Flow — Excel vs D1 Reconciliation Script v2
// Uses --command directly instead of file to get clean JSON
const XLSX = require('xlsx');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const DB_NAME = 'agri-nile-flow-data-lake';
const CWD = path.resolve(__dirname);

function d1Query(sql) {
  try {
    // Use --command directly with escaped quotes
    const escapedSql = sql.replace(/"/g, '\\"');
    const out = execSync(
      `npx wrangler d1 execute ${DB_NAME} --remote --command="${escapedSql}" --json`,
      { cwd: CWD, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 }
    );
    const jsonMatch = out.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed[0]?.results || [];
  } catch (e) {
    const stdout = e.stdout || '';
    const jsonMatch = stdout.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0])[0]?.results || []; } catch(_) {}
    }
    console.error('  ⚠️ Query error, trying fallback...');
    return [];
  }
}

function toISO(v) {
  if (!v) return null;
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  const s = String(v).trim();
  const ddmm = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (ddmm) {
    const [,d,m,y] = ddmm;
    return `${y.length===2?'20'+y:y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  return null;
}

const findings = [];
function finding(type, module, msg, detail) {
  findings.push({ type, module, message: msg, detail });
}

console.log('═══════════════════════════════════════════════════');
console.log('  Agri-Nile Flow — Data Reconciliation Engine v2');
console.log('═══════════════════════════════════════════════════');

// ═══════════════════════════════════════════════════
// 1. SUPPLIERS
// ═══════════════════════════════════════════════════
console.log('\n🔍 [1/4] مطابقة الموردين...');
const supFile = path.resolve(__dirname, 'الموردين والعملاء نواة المستقبل2025-2026.xlsx');
const supWb = XLSX.readFile(supFile);

// 1a. Master list
const codeSheet = supWb.Sheets['الكود'];
const codeRows = codeSheet ? XLSX.utils.sheet_to_json(codeSheet, { header: 1 }).slice(1) : [];
const excelSup = codeRows.filter(r => r[0] && r[1]).map(r => ({
  code: Number(r[0]), name: String(r[1]).trim(), activity: r[2] ? String(r[2]).trim() : null
}));

const dbSup = d1Query('SELECT code, name, activity FROM suppliers WHERE company_id = 1 ORDER BY code');
console.log(`  Excel Suppliers: ${excelSup.length} | DB Suppliers: ${dbSup.length}`);

const dbSupCodes = new Set(dbSup.map(s => s.code));
const excelSupCodes = new Set(excelSup.map(s => s.code));

for (const s of excelSup) {
  if (!dbSupCodes.has(s.code)) finding('🔴 Missing in DB', 'suppliers', `مورد ${s.name} (${s.code})`, s);
}
for (const s of dbSup) {
  if (!excelSupCodes.has(s.code)) finding('🔵 Missing in Excel', 'suppliers', `مورد ${s.name} (${s.code}) موجود في DB فقط`, s);
}
for (const es of excelSup) {
  const ds = dbSup.find(d => d.code === es.code);
  if (ds && ds.name.trim() !== es.name.trim()) {
    finding('🟠 Data Mismatch', 'suppliers', `اسم مختلف للمورد ${es.code}`, { excel: es.name, db: ds.name });
  }
}

// 1b. Supplier Transactions — use aggregate comparison
console.log('\n  📄 حركات الموردين...');
const byanSheet = supWb.Sheets['البيان'];
const byanRows = byanSheet ? XLSX.utils.sheet_to_json(byanSheet, { header: 1 }).slice(3) : [];
const excelSupTx = byanRows.filter(r => r[2] && r[0] && r[19]).map(r => ({
  supplier_code: Number(r[2]),
  amount: Math.round((Number(r[19]) || 0) * 100) / 100
}));

const excelSupTxCount = excelSupTx.length;
const excelSupTxTotal = excelSupTx.reduce((s, r) => s + r.amount, 0);

const dbSupTxAgg = d1Query("SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM supplier_transactions WHERE company_id = 1");
const dbSupTxCount = dbSupTxAgg[0]?.cnt || 0;
const dbSupTxTotal = dbSupTxAgg[0]?.total || 0;

console.log(`  Excel Tx: ${excelSupTxCount} (total: ${Math.round(excelSupTxTotal).toLocaleString()})`);
console.log(`  DB Tx:    ${dbSupTxCount} (total: ${Math.round(dbSupTxTotal).toLocaleString()})`);

if (excelSupTxCount !== dbSupTxCount) {
  finding('🔴 Missing in DB', 'supplier_tx', `عدد الحركات مختلف: Excel=${excelSupTxCount} vs DB=${dbSupTxCount}`, { diff: excelSupTxCount - dbSupTxCount });
}
if (Math.abs(excelSupTxTotal - dbSupTxTotal) > 0.01) {
  finding('🟠 Data Mismatch', 'supplier_tx', `إجمالي المبالغ مختلف`, { excel: excelSupTxTotal, db: dbSupTxTotal, diff: Math.round((excelSupTxTotal - dbSupTxTotal)*100)/100 });
}

// Per-supplier totals
const excelPerSup = {};
for (const t of excelSupTx) {
  if (!excelPerSup[t.supplier_code]) excelPerSup[t.supplier_code] = { count: 0, total: 0 };
  excelPerSup[t.supplier_code].count++;
  excelPerSup[t.supplier_code].total += t.amount;
}

const dbPerSup = d1Query("SELECT supplier_code, COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM supplier_transactions WHERE company_id = 1 GROUP BY supplier_code");
const dbPerSupMap = {};
for (const r of dbPerSup) dbPerSupMap[r.supplier_code] = { count: r.cnt, total: r.total };

for (const [code, ev] of Object.entries(excelPerSup)) {
  const dv = dbPerSupMap[code];
  if (!dv) {
    finding('🔴 Missing in DB', 'supplier_tx', `كل حركات المورد ${code} مفقودة (${ev.count} حركة)`, ev);
  } else if (ev.count !== dv.count) {
    finding('🟠 Data Mismatch', 'supplier_tx', `عدد حركات المورد ${code}: Excel=${ev.count} vs DB=${dv.count}`, { diff: ev.count - dv.count });
  } else if (Math.abs(ev.total - dv.total) > 0.01) {
    finding('🟠 Data Mismatch', 'supplier_tx', `إجمالي المورد ${code}: Excel=${Math.round(ev.total)} vs DB=${Math.round(dv.total)}`, { diff: Math.round(ev.total - dv.total) });
  }
}

// ═══════════════════════════════════════════════════
// 2. TREASURY
// ═══════════════════════════════════════════════════
console.log('\n🔍 [2/4] مطابقة الخزينة...');
const trsFile = path.resolve(__dirname, 'خزينة نواة المستقبل 2025-2026.xlsx');
const trsWb = XLSX.readFile(trsFile);
const trsSheet = trsWb.Sheets['البيان'];
const trsRows = trsSheet ? XLSX.utils.sheet_to_json(trsSheet, { header: 1 }).slice(5) : [];

const excelCash = trsRows.filter(r => r[0] && (r[15] || r[16])).map(r => ({
  debit: Math.round((Number(r[15]) || 0) * 100) / 100,
  credit: Math.round((Number(r[16]) || 0) * 100) / 100,
}));

const excelCashCount = excelCash.length;
const excelDebitTotal = excelCash.reduce((s, r) => s + r.debit, 0);
const excelCreditTotal = excelCash.reduce((s, r) => s + r.credit, 0);

const dbCashAgg = d1Query("SELECT COUNT(*) as cnt, COALESCE(SUM(debit),0) as total_debit, COALESCE(SUM(credit),0) as total_credit FROM cash_transactions WHERE company_id = 1");
const dbCashCount = dbCashAgg[0]?.cnt || 0;
const dbDebitTotal = dbCashAgg[0]?.total_debit || 0;
const dbCreditTotal = dbCashAgg[0]?.total_credit || 0;

console.log(`  Excel: ${excelCashCount} حركة | DB: ${dbCashCount} حركة`);
console.log(`  Excel مدين: ${Math.round(excelDebitTotal).toLocaleString()} | دائن: ${Math.round(excelCreditTotal).toLocaleString()}`);
console.log(`  DB    مدين: ${Math.round(dbDebitTotal).toLocaleString()} | دائن: ${Math.round(dbCreditTotal).toLocaleString()}`);

if (excelCashCount !== dbCashCount) {
  finding('🔴 Missing in DB', 'treasury', `عدد حركات الخزينة: Excel=${excelCashCount} vs DB=${dbCashCount}`, { diff: excelCashCount - dbCashCount });
}
if (Math.abs(excelDebitTotal - dbDebitTotal) > 0.01) {
  finding('🟠 Data Mismatch', 'treasury', `إجمالي المدين مختلف`, { excel: Math.round(excelDebitTotal), db: Math.round(dbDebitTotal), diff: Math.round(excelDebitTotal - dbDebitTotal) });
}

// ═══════════════════════════════════════════════════
// 3. INVENTORY
// ═══════════════════════════════════════════════════
console.log('\n🔍 [3/4] مطابقة المخازن...');
const invFile = path.resolve(__dirname, 'مخازن نواة المستقبل2025-2026.xlsx');
const invWb = XLSX.readFile(invFile);
const invSheet = invWb.Sheets['البيانات'];
const invRows = invSheet ? XLSX.utils.sheet_to_json(invSheet, { header: 1 }).slice(3) : [];

const excelInv = invRows.filter(r => r[3] && r[4] && r[11] && (r[25] || r[26])).map(r => ({
  item_code: Number(r[11]),
  qty_in: Number(r[25]) || 0,
  qty_out: Number(r[26]) || 0,
  val_in: Number(r[28]) || 0,
  val_out: Number(r[29]) || 0,
}));

const excelInvCount = excelInv.length;
const excelQtyIn = excelInv.reduce((s, r) => s + r.qty_in, 0);
const excelQtyOut = excelInv.reduce((s, r) => s + r.qty_out, 0);
const excelValIn = excelInv.reduce((s, r) => s + r.val_in, 0);

const dbInvAgg = d1Query("SELECT COUNT(*) as cnt, COALESCE(SUM(qty_in),0) as qi, COALESCE(SUM(qty_out),0) as qo, COALESCE(SUM(value_in),0) as vi FROM inventory_movements WHERE company_id = 1");
const dbInvCount = dbInvAgg[0]?.cnt || 0;
const dbQtyIn = dbInvAgg[0]?.qi || 0;
const dbQtyOut = dbInvAgg[0]?.qo || 0;
const dbValIn = dbInvAgg[0]?.vi || 0;

console.log(`  Excel: ${excelInvCount} حركة | DB: ${dbInvCount} حركة`);
console.log(`  كمية وارد — Excel: ${Math.round(excelQtyIn).toLocaleString()} | DB: ${Math.round(dbQtyIn).toLocaleString()}`);
console.log(`  قيمة وارد — Excel: ${Math.round(excelValIn).toLocaleString()} | DB: ${Math.round(dbValIn).toLocaleString()}`);

if (excelInvCount !== dbInvCount) {
  finding('🔴 Missing in DB', 'inventory', `عدد الحركات: Excel=${excelInvCount} vs DB=${dbInvCount}`, { diff: excelInvCount - dbInvCount });
}
if (Math.abs(excelQtyIn - dbQtyIn) > 0.01) {
  finding('🟠 Data Mismatch', 'inventory', `كمية الوارد مختلفة`, { excel: Math.round(excelQtyIn), db: Math.round(dbQtyIn) });
}
if (Math.abs(excelValIn - dbValIn) > 0.01) {
  finding('🟠 Data Mismatch', 'inventory', `قيمة الوارد مختلفة`, { excel: Math.round(excelValIn), db: Math.round(dbValIn) });
}

// ═══════════════════════════════════════════════════
// 4. COA
// ═══════════════════════════════════════════════════
console.log('\n🔍 [4/4] مطابقة شجرة الحسابات...');
const coaFile = path.resolve(__dirname, 'شجرة نواة المستقبل (1).xlsx');
const coaWb = XLSX.readFile(coaFile);
const coaSheet = coaWb.Sheets[coaWb.SheetNames[0]];
const coaRows = XLSX.utils.sheet_to_json(coaSheet, { header: 1 }).slice(1);
const excelCOA = coaRows.filter(r => r[2] && r[3]).map(r => ({ code: String(r[2]).trim(), name: String(r[3]).trim() }));

const dbCOAAgg = d1Query("SELECT COUNT(*) as cnt FROM chart_of_accounts WHERE company_id = 1");
const dbCOACount = dbCOAAgg[0]?.cnt || 0;
console.log(`  Excel: ${excelCOA.length} حساب | DB: ${dbCOACount} حساب`);

if (excelCOA.length > dbCOACount) {
  finding('🔴 Missing in DB', 'coa', `حسابات ناقصة: Excel=${excelCOA.length} vs DB=${dbCOACount}`, { diff: excelCOA.length - dbCOACount });
} else if (dbCOACount > excelCOA.length) {
  finding('🔵 Missing in Excel', 'coa', `حسابات إضافية في DB: ${dbCOACount - excelCOA.length}`, {});
}

// ═══════════════════════════════════════════════════
// FINAL REPORT
// ═══════════════════════════════════════════════════
console.log('\n═══════════════════════════════════════════════════');
console.log('📋 RECONCILIATION FINDINGS SUMMARY');
console.log('═══════════════════════════════════════════════════');

const byType = {};
for (const f of findings) {
  if (!byType[f.type]) byType[f.type] = [];
  byType[f.type].push(f);
}

for (const [type, items] of Object.entries(byType)) {
  console.log(`\n${type} (${items.length}):`);
  for (const item of items) {
    console.log(`  → [${item.module}] ${item.message}`);
  }
}

console.log(`\nTotal Findings: ${findings.length}`);
fs.writeFileSync('reconciliation_report.json', JSON.stringify({ findings, summary: { total: findings.length, byType: Object.fromEntries(Object.entries(byType).map(([k,v]) => [k, v.length])) } }, null, 2), 'utf8');
console.log('✅ Full report saved to reconciliation_report.json');
