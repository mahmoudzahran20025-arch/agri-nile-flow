#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const DB_NAME = 'agri-nile-flow-data-lake';
const COMPANY_ID = 1;
const ROOT = process.cwd();

const supplierJsonPath = path.join(ROOT, 'نواة_المستقبل_2025-2026.json');
const cashJsonPath = path.join(ROOT, 'خزينة_نواة_المستقبل_2025-2026.json');

function runD1Json(sql) {
  const compact = sql.replace(/\s+/g, ' ').trim();
  const escaped = compact.replace(/"/g, '\\"');
  const useFile = compact.length > 5000;
  let cmd = '';
  let tmpPath = null;

  if (useFile) {
    tmpPath = path.join(os.tmpdir(), `d1_batch_${Date.now()}_${Math.random().toString(36).slice(2)}.sql`);
    fs.writeFileSync(tmpPath, `${sql}\n`, 'utf8');
    cmd = `npx wrangler d1 execute ${DB_NAME} --remote --yes --json --file "${tmpPath}"`;
  } else {
    cmd = `npx wrangler d1 execute ${DB_NAME} --remote --yes --json --command "${escaped}"`;
  }
  let lastError = null;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
      const start = out.indexOf('[');
      const end = out.lastIndexOf(']');
      if (start < 0 || end < 0 || end < start) {
        throw new Error('Failed to parse D1 JSON output');
      }
      const parsed = JSON.parse(out.slice(start, end + 1));
      if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      return parsed;
    } catch (err) {
      const msg = String(err?.stdout || err?.message || err);
      const isTransient = /fetch failed|ETIMEDOUT|ECONNRESET|ENOTFOUND|network|temporarily unavailable/i.test(msg);
      if (!isTransient || attempt === 4) {
        if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        throw err;
      }
      lastError = err;
      console.warn(`Transient D1 error (attempt ${attempt}/4). Retrying...`);
    }
  }

  if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  throw lastError || new Error('Unknown D1 execution error');
}

function query(sql) {
  return runD1Json(sql)[0]?.results ?? [];
}

function scalar(sql, key) {
  const row = query(sql)[0] || {};
  return Number(row[key] || 0);
}

function esc(v) {
  return String(v).replace(/'/g, "''");
}

function toDate(v) {
  if (!v) return null;
  return String(v).slice(0, 10);
}

function toNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toText(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function inferUsageMode(description, expenseCategory) {
  const text = `${description || ''} ${expenseCategory || ''}`;
  if (/وقود/.test(text)) return 'fuel';
  if (/صيان|اصلاح/.test(text)) return 'maintenance';
  if (/ايجار|ميكنة|معدات/.test(text)) return 'rental';
  return null;
}

function inferEquipmentTypeId(equipmentText, expenseCategory) {
  const text = `${equipmentText || ''} ${expenseCategory || ''}`;
  if (/جرار/.test(text)) return 1;
  if (/طلمب/.test(text)) return 2;
  if (/حصاد/.test(text)) return 3;
  if (/غيار/.test(text)) return 4;
  if (/وقود/.test(text)) return 5;
  return null;
}

function loadJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function buildSupplierRows() {
  const json = loadJson(supplierJsonPath);
  const tx = json?.البيان_الرئيسي?.المعاملات || [];
  return tx.map((row) => {
    const description = toText(row['البيان']);
    const expenseCategory = toText(row['المصروف']);
    const equipment = toText(row['المعدة']);
    return {
      transactionDate: toDate(row['التاريخ']),
      entryType: toText(row['النوع']),
      supplierCode: toNumber(row['كود المورد']),
      documentNumber: toNumber(row['رقم المستند']),
      amount: toNumber(row['القيمه']) || 0,
      debit: toNumber(row['مدين']) || 0,
      credit: toNumber(row['دائن']) || 0,
      centerCode: toNumber(row['كود البيقوت']),
      expenseCategory,
      equipment,
      description,
      usageMode: inferUsageMode(description, expenseCategory),
      equipmentTypeId: inferEquipmentTypeId(equipment, expenseCategory),
    };
  }).filter((row) => row.transactionDate && row.entryType);
}

function buildCashRows() {
  const json = loadJson(cashJsonPath);
  const tx = json?.البيان_الرئيسي?.المعاملات || [];
  return tx.map((row) => ({
    transactionDate: toDate(row['التاريخ']),
    direction: toText(row['الحالة']),
    supplierCode: toNumber(row['كود المورد']),
    documentNumber: toNumber(row['رقم المستند']),
    amount: toNumber(row['القيمة']) || 0,
    debit: toNumber(row['مدين']) || 0,
    credit: toNumber(row['دائن']) || 0,
    centerCode: toNumber(row['كود المركز']),
    expenseCode: toNumber(row['كود المصروف']),
    narration: toText(row['البيان']),
  })).filter((row) => row.transactionDate && row.direction);
}

function sqlNum(v) {
  return v == null ? 'NULL' : String(v);
}

function sqlText(v) {
  return v == null ? 'NULL' : `'${esc(v)}'`;
}

function runBatch(statements, batchSize = 25) {
  let touched = 0;
  for (let i = 0; i < statements.length; i += batchSize) {
    const chunk = statements.slice(i, i + batchSize);
    const sql = chunk.join('\n');
    const results = runD1Json(sql);
    touched += results.reduce((sum, r) => sum + Number(r?.meta?.changes || 0), 0);
  }
  return touched;
}

function backfillSupplierDimensions(rows) {
  const occurrence = new Map();
  const statements = [];

  for (const row of rows) {
    const key = [
      row.transactionDate,
      row.entryType,
      row.supplierCode ?? 'NULL',
      row.documentNumber ?? 'NULL',
      row.amount.toFixed(3),
      row.debit.toFixed(3),
      row.credit.toFixed(3),
    ].join('|');

    const offset = occurrence.get(key) || 0;
    occurrence.set(key, offset + 1);

    const updateSql = `
      UPDATE supplier_transactions
      SET
        center_code = COALESCE(center_code, ${sqlNum(row.centerCode)}),
        expense_category = COALESCE(expense_category, ${sqlText(row.expenseCategory)}),
        equipment = COALESCE(equipment, ${sqlText(row.equipment)}),
        description = COALESCE(description, ${sqlText(row.description)}),
        equipment_usage_mode = COALESCE(equipment_usage_mode, ${sqlText(row.usageMode)}),
        equipment_type_id = COALESCE(equipment_type_id, ${sqlNum(row.equipmentTypeId)})
      WHERE id = (
        SELECT id
        FROM supplier_transactions
        WHERE company_id=${COMPANY_ID}
          AND transaction_date='${esc(row.transactionDate)}'
          AND entry_type='${esc(row.entryType)}'
          AND COALESCE(supplier_code, -1)=${row.supplierCode == null ? -1 : row.supplierCode}
          AND COALESCE(document_number, -1)=${row.documentNumber == null ? -1 : row.documentNumber}
          AND ABS(COALESCE(amount,0) - ${row.amount}) < 0.01
          AND ABS(COALESCE(debit,0) - ${row.debit}) < 0.01
          AND ABS(COALESCE(credit,0) - ${row.credit}) < 0.01
        ORDER BY id
        LIMIT 1 OFFSET ${offset}
      );
    `;

    statements.push(updateSql);
  }

  return runBatch(statements, 25);
}

function backfillCashDimensions(rows) {
  const occurrence = new Map();
  const statements = [];

  for (const row of rows) {
    const key = [
      row.transactionDate,
      row.direction,
      row.supplierCode ?? 'NULL',
      row.documentNumber ?? 'NULL',
      row.amount.toFixed(3),
      row.debit.toFixed(3),
      row.credit.toFixed(3),
    ].join('|');

    const offset = occurrence.get(key) || 0;
    occurrence.set(key, offset + 1);

    const updateSql = `
      UPDATE cash_transactions
      SET
        center_code = COALESCE(center_code, ${sqlNum(row.centerCode)}),
        expense_code = COALESCE(expense_code, ${sqlNum(row.expenseCode)}),
        narration = COALESCE(narration, ${sqlText(row.narration)})
      WHERE id = (
        SELECT id
        FROM cash_transactions
        WHERE company_id=${COMPANY_ID}
          AND transaction_date='${esc(row.transactionDate)}'
          AND direction='${esc(row.direction)}'
          AND COALESCE(supplier_code, -1)=${row.supplierCode == null ? -1 : row.supplierCode}
          AND COALESCE(document_number, -1)=${row.documentNumber == null ? -1 : row.documentNumber}
          AND ABS(COALESCE(amount,0) - ${row.amount}) < 0.01
          AND ABS(COALESCE(debit,0) - ${row.debit}) < 0.01
          AND ABS(COALESCE(credit,0) - ${row.credit}) < 0.01
        ORDER BY id
        LIMIT 1 OFFSET ${offset}
      );
    `;

    statements.push(updateSql);
  }

  return runBatch(statements, 25);
}

function repairSupplierJournalLinks() {
  const sql = `
    UPDATE supplier_transactions
    SET journal_entry_id = (
      SELECT je.id
      FROM journal_entries je
      WHERE je.company_id=supplier_transactions.company_id
        AND je.ref_type='supplier_transaction'
        AND je.ref_id=supplier_transactions.id
      LIMIT 1
    )
    WHERE company_id=${COMPANY_ID}
      AND EXISTS (
        SELECT 1
        FROM journal_entries je
        WHERE je.company_id=supplier_transactions.company_id
          AND je.ref_type='supplier_transaction'
          AND je.ref_id=supplier_transactions.id
      );

    UPDATE supplier_transactions
    SET journal_entry_id = NULL
    WHERE company_id=${COMPANY_ID}
      AND journal_entry_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM journal_entries je
        WHERE je.company_id=supplier_transactions.company_id
          AND je.ref_type='supplier_transaction'
          AND je.ref_id=supplier_transactions.id
          AND je.id=supplier_transactions.journal_entry_id
      );
  `;
  runD1Json(sql);
}

function propagateCentersToJournalLines() {
  const sql = `
    UPDATE journal_entry_lines
    SET center_code = (
      SELECT st.center_code
      FROM journal_entries je
      JOIN supplier_transactions st
        ON st.company_id=je.company_id AND st.id=je.ref_id
      WHERE je.id=journal_entry_lines.entry_id
        AND je.ref_type='supplier_transaction'
      LIMIT 1
    )
    WHERE company_id=${COMPANY_ID}
      AND center_code IS NULL
      AND entry_id IN (
        SELECT je.id
        FROM journal_entries je
        JOIN supplier_transactions st
          ON st.company_id=je.company_id AND st.id=je.ref_id
        WHERE je.company_id=${COMPANY_ID}
          AND je.ref_type='supplier_transaction'
          AND st.center_code IS NOT NULL
      );

    UPDATE journal_entry_lines
    SET center_code = (
      SELECT ct.center_code
      FROM journal_entries je
      JOIN cash_transactions ct
        ON ct.company_id=je.company_id AND ct.id=je.ref_id
      WHERE je.id=journal_entry_lines.entry_id
        AND je.ref_type='cash_transaction'
      LIMIT 1
    )
    WHERE company_id=${COMPANY_ID}
      AND center_code IS NULL
      AND entry_id IN (
        SELECT je.id
        FROM journal_entries je
        JOIN cash_transactions ct
          ON ct.company_id=je.company_id AND ct.id=je.ref_id
        WHERE je.company_id=${COMPANY_ID}
          AND je.ref_type='cash_transaction'
          AND ct.center_code IS NOT NULL
      );

    UPDATE journal_entry_lines
    SET center_code = (
      SELECT im.center_code
      FROM journal_entries je
      JOIN inventory_movements im
        ON im.company_id=je.company_id AND im.id=je.ref_id
      WHERE je.id=journal_entry_lines.entry_id
        AND je.ref_type='inventory_movement'
      LIMIT 1
    )
    WHERE company_id=${COMPANY_ID}
      AND center_code IS NULL
      AND entry_id IN (
        SELECT je.id
        FROM journal_entries je
        JOIN inventory_movements im
          ON im.company_id=je.company_id AND im.id=je.ref_id
        WHERE je.company_id=${COMPANY_ID}
          AND je.ref_type='inventory_movement'
          AND im.center_code IS NOT NULL
      );
  `;
  runD1Json(sql);
}

function printCoverage(label) {
  const supplier = query(`
    SELECT COUNT(*) total,
      SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) with_center,
      SUM(CASE WHEN expense_category IS NOT NULL THEN 1 ELSE 0 END) with_expense,
      SUM(CASE WHEN equipment IS NOT NULL THEN 1 ELSE 0 END) with_equipment,
      SUM(CASE WHEN equipment_type_id IS NOT NULL THEN 1 ELSE 0 END) with_equipment_type
    FROM supplier_transactions
    WHERE company_id=${COMPANY_ID}
  `)[0];

  const cash = query(`
    SELECT COUNT(*) total,
      SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) with_center,
      SUM(CASE WHEN expense_code IS NOT NULL THEN 1 ELSE 0 END) with_expense_code
    FROM cash_transactions
    WHERE company_id=${COMPANY_ID}
  `)[0];

  const lines = query(`
    SELECT je.ref_type, COUNT(*) total_lines,
      SUM(CASE WHEN jl.center_code IS NOT NULL THEN 1 ELSE 0 END) with_center
    FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id=jl.entry_id
    WHERE je.company_id=${COMPANY_ID}
    GROUP BY je.ref_type
    ORDER BY je.ref_type
  `);

  console.log(`\n[${label}]`);
  console.log('supplier_transactions:', supplier);
  console.log('cash_transactions:', cash);
  console.log('journal_entry_lines by ref_type:', lines);
}

function main() {
  if (!fs.existsSync(supplierJsonPath)) {
    throw new Error(`Missing source JSON: ${supplierJsonPath}`);
  }
  if (!fs.existsSync(cashJsonPath)) {
    throw new Error(`Missing source JSON: ${cashJsonPath}`);
  }

  console.log('Applying Source-of-Truth dimensional mapping layer...');
  printCoverage('BEFORE');

  const supplierRows = buildSupplierRows();
  const cashRows = buildCashRows();
  console.log(`Loaded source rows: supplier=${supplierRows.length}, cash=${cashRows.length}`);

  const supplierTouched = backfillSupplierDimensions(supplierRows);
  const cashTouched = backfillCashDimensions(cashRows);

  repairSupplierJournalLinks();
  propagateCentersToJournalLines();

  console.log(`Backfill updates touched: supplier=${supplierTouched}, cash=${cashTouched}`);
  printCoverage('AFTER');
  console.log('\nDone.');
}

main();
