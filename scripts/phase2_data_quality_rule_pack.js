const fs = require('fs');
const path = require('path');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function toRows(stagingDir, fileName) {
  const p = path.join(stagingDir, fileName);
  return readJson(p).rows || [];
}

function isEmpty(v) {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

function asText(v) {
  if (v == null) return '';
  return String(v).trim();
}

function parseArabicNumber(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v).trim();
  if (!t) return null;
  const normalized = t.replace(/,/g, '').replace(/\s+/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function isIsoDateLike(v) {
  if (isEmpty(v)) return false;
  const t = asText(v);
  if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}(\s+\d{1,2}:\d{2}(:\d{2})?)?$/.test(t)) return true;
  if (/^\d{1,2}[-\/]\d{1,2}[-\/]\d{4}(\s+\d{1,2}:\d{2}(:\d{2})?)?$/.test(t)) return true;
  const d = new Date(t);
  return !Number.isNaN(d.getTime());
}

function countMissing(rows, fields) {
  const out = {};
  for (const f of fields) out[f] = 0;
  for (const r of rows) {
    for (const f of fields) {
      if (isEmpty(r[f])) out[f] += 1;
    }
  }
  return out;
}

function duplicateCount(rows, keyFields) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFields.map((f) => asText(r[f])).join('|');
    if (!k.replace(/\|/g, '')) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  let dupRows = 0;
  for (const c of m.values()) {
    if (c > 1) dupRows += c;
  }
  return { duplicateRows: dupRows, duplicateKeys: [...m.entries()].filter(([, c]) => c > 1).length };
}

function codeFormatCount(rows, fields) {
  const issues = {};
  for (const f of fields) issues[f] = 0;
  const re = /^\d+$/;
  for (const r of rows) {
    for (const f of fields) {
      const v = asText(r[f]);
      if (!v) continue;
      if (!re.test(v)) issues[f] += 1;
    }
  }
  return issues;
}

function numericParseIssues(rows, fields) {
  const issues = {};
  for (const f of fields) issues[f] = 0;
  for (const r of rows) {
    for (const f of fields) {
      const v = r[f];
      if (isEmpty(v)) continue;
      if (parseArabicNumber(v) == null) issues[f] += 1;
    }
  }
  return issues;
}

function dateParseIssues(rows, field) {
  let c = 0;
  for (const r of rows) {
    if (!isIsoDateLike(r[field])) c += 1;
  }
  return c;
}

function relationMissingCount(rows, field, validSet) {
  let c = 0;
  for (const r of rows) {
    const v = asText(r[field]);
    if (!v) continue;
    if (!validSet.has(v)) c += 1;
  }
  return c;
}

function main() {
  const root = process.cwd();
  const inputDirArg = process.argv[2] || 'staging/canonical';
  const outputPathArg = process.argv[3] || 'reports/phase2_data_quality_report.json';
  const stagingDir = path.join(root, inputDirArg);

  const idx = readJson(path.join(stagingDir, '_index.json'));
  const byEntity = Object.fromEntries(idx.outputs.map((o) => [o.entity, o.file.split('/').pop()]));

  const coa = toRows(stagingDir, byEntity.coa_accounts);
  const suppliers = toRows(stagingDir, byEntity.supplier_party_codes);
  const supplierTx = toRows(stagingDir, byEntity.supplier_transactions_raw);
  const cashTx = toRows(stagingDir, byEntity.cash_transactions_raw);
  const items = toRows(stagingDir, byEntity.inventory_items_master);
  const invMov = toRows(stagingDir, byEntity.inventory_movements_raw);

  const coaSet = new Set(coa.map((r) => asText(r.source_code)).filter(Boolean));
  const supplierSet = new Set(suppliers.map((r) => asText(r.party_code)).filter(Boolean));
  const itemSet = new Set(items.map((r) => asText(r.item_code)).filter(Boolean));

  const checks = [];

  checks.push({
    name: 'mandatory_nulls',
    details: {
      coa_accounts: countMissing(coa, ['source_code', 'source_name', 'source_level']),
      supplier_transactions_raw: countMissing(supplierTx, ['txn_date', 'txn_type', 'amount']),
      cash_transactions_raw: countMissing(cashTx, ['txn_date', 'txn_state', 'amount']),
      inventory_items_master: countMissing(items, ['item_code', 'item_name']),
      inventory_movements_raw: countMissing(invMov, ['movement_date', 'item_name', 'warehouse'])
    }
  });

  checks.push({
    name: 'duplicate_keys',
    details: {
      coa_accounts: duplicateCount(coa, ['source_code']),
      supplier_party_codes: duplicateCount(suppliers, ['party_code']),
      inventory_items_master: duplicateCount(items, ['item_code'])
    }
  });

  checks.push({
    name: 'code_format_digits_only',
    details: {
      coa_accounts: codeFormatCount(coa, ['source_code']),
      supplier_party_codes: codeFormatCount(suppliers, ['party_code']),
      inventory_items_master: codeFormatCount(items, ['item_code']),
      supplier_transactions_raw: codeFormatCount(supplierTx, ['supplier_code', 'center_code', 'account_code']),
      cash_transactions_raw: codeFormatCount(cashTx, ['supplier_code', 'center_code', 'expense_code']),
      inventory_movements_raw: codeFormatCount(invMov, ['item_code', 'center_code'])
    }
  });

  checks.push({
    name: 'amount_date_parsing',
    details: {
      supplier_transactions_raw: {
        dateIssues: dateParseIssues(supplierTx, 'txn_date'),
        amountIssues: numericParseIssues(supplierTx, ['amount', 'debit', 'credit'])
      },
      cash_transactions_raw: {
        dateIssues: dateParseIssues(cashTx, 'txn_date'),
        amountIssues: numericParseIssues(cashTx, ['amount', 'debit', 'credit'])
      },
      inventory_movements_raw: {
        dateIssues: dateParseIssues(invMov, 'movement_date'),
        amountIssues: numericParseIssues(invMov, ['qty_in', 'qty_out', 'value_in', 'value_out'])
      }
    }
  });

  checks.push({
    name: 'relation_prechecks',
    details: {
      supplier_transactions_raw: {
        supplierCodeNotInMaster: relationMissingCount(supplierTx, 'supplier_code', supplierSet),
        accountCodeNotInCoA: relationMissingCount(supplierTx, 'account_code', coaSet)
      },
      cash_transactions_raw: {
        supplierCodeNotInMaster: relationMissingCount(cashTx, 'supplier_code', supplierSet),
        expenseCodeNotInCoA: relationMissingCount(cashTx, 'expense_code', coaSet)
      },
      inventory_movements_raw: {
        itemCodeNotInItemsMaster: relationMissingCount(invMov, 'item_code', itemSet)
      }
    }
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    totalRows: {
      coa_accounts: coa.length,
      supplier_party_codes: suppliers.length,
      supplier_transactions_raw: supplierTx.length,
      cash_transactions_raw: cashTx.length,
      inventory_items_master: items.length,
      inventory_movements_raw: invMov.length
    },
    checks
  };

  const outDir = path.join(root, 'reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(root, outputPathArg);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`Wrote ${outPath}`);
}

main();
