// Phase 1: Excel Data Analysis Script
// Analyzes all 4 Excel files and produces a comprehensive inventory

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\mahmo\\Contacts\\CLAUDE_CO WORK MY WORK\\agri-nile-flow';

const FILES = {
  suppliers: path.join(BASE, 'الموردين والعملاء نواة المستقبل2025-2026.xlsx'),
  treasury: path.join(BASE, 'خزينة نواة المستقبل 2025-2026.xlsx'),
  inventory: path.join(BASE, 'مخازن نواة المستقبل2025-2026.xlsx'),
  coa: path.join(BASE, 'شجرة نواة المستقبل (1).xlsx'),
};

function safeRead(filePath) {
  try {
    return XLSX.readFile(filePath, { cellDates: true, cellNF: true, cellText: false });
  } catch (e) {
    console.error(`ERROR reading ${filePath}: ${e.message}`);
    return null;
  }
}

function analyzeSheet(wb, sheetName, maxSampleRows = 3) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return { rows: 0, columns: [], samples: [] };

  const data = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
  const rawData = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });

  const columns = data.length > 0 ? Object.keys(data[0]) : [];
  const samples = data.slice(0, maxSampleRows);

  // Detect non-empty rows (some sheets have header rows mid-file)
  const nonEmpty = data.filter(r => Object.values(r).some(v => v !== null && v !== ''));

  // Column type inference
  const colTypes = {};
  columns.forEach(col => {
    const vals = rawData.slice(0, 20).map(r => r[col]).filter(v => v !== null && v !== '');
    if (vals.length === 0) { colTypes[col] = 'empty'; return; }
    const numericCount = vals.filter(v => typeof v === 'number').length;
    if (numericCount / vals.length > 0.7) colTypes[col] = 'numeric';
    else colTypes[col] = 'text';
  });

  return {
    totalRows: data.length,
    nonEmptyRows: nonEmpty.length,
    columns,
    colTypes,
    samples: samples.slice(0, maxSampleRows)
  };
}

function analyzeFile(label, filePath) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`ANALYZING: ${label}`);
  console.log(`Path: ${filePath}`);
  console.log('='.repeat(60));

  const wb = safeRead(filePath);
  if (!wb) return null;

  const result = { label, filePath, sheets: {} };

  console.log(`Sheets (${wb.SheetNames.length}): ${wb.SheetNames.join(' | ')}`);

  wb.SheetNames.forEach(sn => {
    const info = analyzeSheet(wb, sn);
    result.sheets[sn] = info;
    console.log(`\n  [${sn}]`);
    console.log(`    Total rows: ${info.totalRows} | Non-empty: ${info.nonEmptyRows}`);
    console.log(`    Columns (${info.columns.length}): ${info.columns.join(', ')}`);
    if (info.samples.length > 0) {
      console.log(`    Sample row 1:`, JSON.stringify(info.samples[0]));
    }
  });

  return result;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
const inventory = {};

for (const [key, filePath] of Object.entries(FILES)) {
  inventory[key] = analyzeFile(key, filePath);
}

// ─── SAVE JSON ───────────────────────────────────────────────────────────────
fs.writeFileSync(path.join(BASE, 'excel_inventory.json'), JSON.stringify(inventory, null, 2));
console.log('\n\nSaved excel_inventory.json');

// ─── SUMMARY ─────────────────────────────────────────────────────────────────
console.log('\n\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));
for (const [key, info] of Object.entries(inventory)) {
  if (!info) { console.log(`  ${key}: FAILED TO READ`); continue; }
  const totalRows = Object.values(info.sheets).reduce((s, sh) => s + sh.nonEmptyRows, 0);
  const sheetCount = Object.keys(info.sheets).length;
  console.log(`  ${key}: ${sheetCount} sheets, ~${totalRows} non-empty rows`);
  Object.entries(info.sheets).forEach(([sn, sh]) => {
    console.log(`    [${sn}]: ${sh.nonEmptyRows} rows, ${sh.columns.length} cols`);
  });
}
