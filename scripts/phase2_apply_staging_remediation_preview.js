const fs = require('fs');
const path = require('path');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function asText(v) {
  if (v == null) return '';
  return String(v).trim();
}

function isDigits(v) {
  return /^\d+$/.test(asText(v));
}

function main() {
  const root = process.cwd();
  const srcDir = path.join(root, 'staging', 'canonical');
  const outDir = path.join(root, 'staging', 'canonical_clean');
  ensureDir(outDir);

  const index = readJson(path.join(srcDir, '_index.json'));
  const byEntity = Object.fromEntries(index.outputs.map((o) => [o.entity, o.file.split('/').pop()]));

  const coa = readJson(path.join(srcDir, byEntity.coa_accounts));
  const suppliers = readJson(path.join(srcDir, byEntity.supplier_party_codes));
  const supplierTx = readJson(path.join(srcDir, byEntity.supplier_transactions_raw));
  const cashTx = readJson(path.join(srcDir, byEntity.cash_transactions_raw));
  const items = readJson(path.join(srcDir, byEntity.inventory_items_master));
  const inv = readJson(path.join(srcDir, byEntity.inventory_movements_raw));

  const coaSet = new Set(coa.rows.map((r) => asText(r.source_code)).filter(Boolean));

  let supplierCenterNormalized = 0;
  const supplierRows = supplierTx.rows.map((r) => {
    const row = { ...r };
    if (row.center_code && !isDigits(row.center_code)) {
      row.center_code_raw = row.center_code;
      row.center_code = null;
      supplierCenterNormalized += 1;
    }
    if (row.account_code && !coaSet.has(asText(row.account_code))) {
      row.source_dimension_code = row.account_code;
      row.account_code = null;
    }
    return row;
  });

  const cashRows = cashTx.rows.map((r) => {
    const row = { ...r };
    if (row.expense_code && !coaSet.has(asText(row.expense_code))) {
      row.source_dimension_code = row.expense_code;
      row.expense_code = null;
    }
    return row;
  });

  let droppedSparseInv = 0;
  const invRows = inv.rows.filter((r) => {
    const drop = !r.movement_date && !r.item_name && !r.warehouse;
    if (drop) droppedSparseInv += 1;
    return !drop;
  });

  const seen = new Set();
  const dupNotes = [];
  const itemRows = [];
  for (const r of items.rows) {
    const key = asText(r.item_code);
    if (!key) continue;
    if (seen.has(key)) {
      dupNotes.push({ item_code: key, duplicate_item_name: r.item_name });
      continue;
    }
    seen.add(key);
    itemRows.push(r);
  }

  const outputs = [
    { domain: 'coa', entity: 'coa_accounts', name: 'coa__coa_accounts.json', data: { ...coa, rowCount: coa.rows.length, rows: coa.rows } },
    { domain: 'suppliers_master', entity: 'supplier_party_codes', name: 'suppliers_master__supplier_party_codes.json', data: { ...suppliers, rowCount: suppliers.rows.length, rows: suppliers.rows } },
    { domain: 'suppliers_master', entity: 'supplier_transactions_raw', name: 'suppliers_master__supplier_transactions_raw.json', data: { ...supplierTx, rowCount: supplierRows.length, rows: supplierRows } },
    { domain: 'treasury', entity: 'cash_transactions_raw', name: 'treasury__cash_transactions_raw.json', data: { ...cashTx, rowCount: cashRows.length, rows: cashRows } },
    { domain: 'inventory', entity: 'inventory_items_master', name: 'inventory__inventory_items_master.json', data: { ...items, rowCount: itemRows.length, rows: itemRows } },
    { domain: 'inventory', entity: 'inventory_movements_raw', name: 'inventory__inventory_movements_raw.json', data: { ...inv, rowCount: invRows.length, rows: invRows } }
  ];

  for (const o of outputs) {
    writeJson(path.join(outDir, o.name), o.data);
  }

  const outIndex = {
    generatedAt: new Date().toISOString(),
    source: 'staging/canonical',
    outputs: outputs.map((o) => ({
      domain: o.domain,
      entity: o.entity,
      file: `staging/canonical_clean/${o.name}`,
      rowCount: o.data.rows.length
    }))
  };
  writeJson(path.join(outDir, '_index.json'), outIndex);

  const report = {
    generatedAt: new Date().toISOString(),
    changes: {
      supplierCenterNormalized,
      droppedSparseInventoryRows: droppedSparseInv,
      deduplicatedInventoryItemRows: dupNotes.length,
      dedupNotes: dupNotes.slice(0, 20)
    }
  };

  const reportPath = path.join(root, 'reports', 'phase2_remediation_preview_report.json');
  writeJson(reportPath, report);

  console.log(`Wrote ${path.join(outDir, '_index.json')}`);
  console.log(`Wrote ${reportPath}`);
}

main();
