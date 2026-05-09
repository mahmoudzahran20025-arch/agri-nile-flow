const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const COMPANY_ID = 1;
const OUT_DIR = path.join(ROOT, 'sql', 'generated_phase3');
const STAGING_DIR = path.join(ROOT, 'staging', 'canonical_clean');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(STAGING_DIR, name), 'utf8'));
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function sqlString(value) {
  if (value == null || value === '') return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  if (value == null || value === '') return 'NULL';
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : 'NULL';
}

function dateOnly(value) {
  if (value == null || value === '') return 'NULL';
  return sqlString(String(value).slice(0, 10));
}

function inferParentCode(code, validCodes) {
  const s = String(code);
  if (s.length <= 1) return null;
  for (let end = s.length - 1; end >= 1; end -= 1) {
    const candidate = s.slice(0, end);
    if (validCodes.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

function inferAccountType(code) {
  const s = String(code);
  if (s.startsWith('1')) return 'asset';
  if (s.startsWith('2')) return 'liability';
  if (s.startsWith('3')) return 'equity';
  if (s.startsWith('4') || s.startsWith('7')) return 'revenue';
  if (s.startsWith('5') || s.startsWith('6')) return 'expense';
  return 'expense';
}

function inferNormalBalance(accountType) {
  return accountType === 'asset' || accountType === 'expense' ? 'debit' : 'credit';
}

function inferIsHeader(level) {
  return Number(level) < 5 ? 1 : 0;
}

function writeFile(name, lines) {
  fs.writeFileSync(path.join(OUT_DIR, name), lines.join('\n') + '\n', 'utf8');
}

function buildCoaLoader() {
  const rows = readJson('coa__coa_accounts.json').rows;
  const validCodes = new Set(rows.map((row) => String(row.source_code)));
  const orderedRows = [...rows].sort((left, right) => {
    const leftCode = String(left.source_code);
    const rightCode = String(right.source_code);
    return leftCode.length - rightCode.length || leftCode.localeCompare(rightCode);
  });
  const lines = [];
  lines.push('-- Generated Phase 3 COA loader from canonical_clean');
  lines.push('DELETE FROM coa_account_intents WHERE company_id = 1;');
  lines.push('DELETE FROM chart_of_accounts WHERE company_id = 1;');
  for (const row of orderedRows) {
    const code = String(row.source_code);
    const level = Number(row.source_level);
    const parentCode = inferParentCode(code, validCodes);
    const accountType = inferAccountType(code);
    const normalBalance = inferNormalBalance(accountType);
    const isHeader = inferIsHeader(level);
    lines.push(
      `INSERT INTO chart_of_accounts (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active, notes, mapping, mapping_detailed, updated_at) VALUES (` +
      `${COMPANY_ID}, ${sqlString(code)}, ${sqlString(row.source_name)}, ${sqlString(accountType)}, ${sqlString(normalBalance)}, ${sqlString(parentCode)}, ${sqlNumber(level)}, ${isHeader}, 1, NULL, ${sqlString(row.mapping_group)}, ${sqlString(row.mapping_detail)}, datetime('now'));`
    );
  }
  writeFile('01_load_coa.sql', lines);
  return { file: 'sql/generated_phase3/01_load_coa.sql', rows: rows.length };
}

function buildSupplierLoader() {
  const supplierRows = readJson('suppliers_master__supplier_party_codes.json').rows;
  const txRows = readJson('suppliers_master__supplier_transactions_raw.json').rows;
  const lines = [];
  lines.push('-- Generated Phase 3 supplier loader from canonical_clean');
  lines.push('DELETE FROM suppliers WHERE company_id = 1;');
  lines.push('DELETE FROM supplier_transactions WHERE company_id = 1;');
  for (const row of supplierRows) {
    lines.push(
      `INSERT INTO suppliers (code, company_id, name, activity, notes, is_active, bus_posting_group_code) VALUES (` +
      `${sqlNumber(row.party_code)}, ${COMPANY_ID}, ${sqlString(row.party_name)}, ${sqlString(row.activity)}, NULL, 1, NULL);`
    );
  }
  for (const row of txRows) {
    const transactionDate = String(row.txn_date || '').slice(0, 10);
    const year = transactionDate ? Number(transactionDate.slice(0, 4)) : null;
    const month = transactionDate ? Number(transactionDate.slice(5, 7)) : null;
    lines.push(
      `INSERT INTO supplier_transactions (` +
      `company_id, supplier_code, account_code, center_code, sub_code, transaction_date, entry_type, document_number, amount, credit, debit, year, month, notes, status, journal_entry_id, description` +
      `) VALUES (` +
      `${COMPANY_ID}, ${sqlNumber(row.supplier_code)}, ${sqlNumber(row.account_code)}, ${sqlNumber(row.center_code)}, ${sqlNumber(row.sub_code)}, ${sqlString(transactionDate)}, ${sqlString(row.txn_type)}, ${sqlNumber(row.document_no)}, ${sqlNumber(row.amount)}, ${sqlNumber(row.credit)}, ${sqlNumber(row.debit)}, ${sqlNumber(year)}, ${sqlNumber(month)}, ${sqlString(row.notes)}, 'posted', NULL, ${sqlString(row.source_dimension_code || null)}` +
      `);`
    );
  }
  writeFile('02_load_suppliers.sql', lines);
  return { file: 'sql/generated_phase3/02_load_suppliers.sql', suppliers: supplierRows.length, transactions: txRows.length };
}

function buildTreasuryLoader() {
  const rows = readJson('treasury__cash_transactions_raw.json').rows;
  const lines = [];
  lines.push('-- Generated Phase 3 treasury loader from canonical_clean');
  lines.push('DELETE FROM cash_transactions WHERE company_id = 1;');
  for (const row of rows) {
    const transactionDate = String(row.txn_date || '').slice(0, 10);
    const year = transactionDate ? Number(transactionDate.slice(0, 4)) : null;
    const month = transactionDate ? Number(transactionDate.slice(5, 7)) : null;
    lines.push(
      `INSERT INTO cash_transactions (` +
      `company_id, supplier_code, center_code, expense_code, sub_code, transaction_date, direction, document_number, narration, amount, debit, credit, year, month, notes, status, journal_entry_id` +
      `) VALUES (` +
      `${COMPANY_ID}, ${sqlNumber(row.supplier_code)}, ${sqlNumber(row.center_code)}, ${sqlNumber(row.expense_code)}, ${sqlNumber(row.sub_code)}, ${sqlString(transactionDate)}, ${sqlString(row.txn_state)}, ${sqlNumber(row.document_no)}, ${sqlString(row.notes)}, ${sqlNumber(row.amount)}, ${sqlNumber(row.debit)}, ${sqlNumber(row.credit)}, ${sqlNumber(year)}, ${sqlNumber(month)}, ${sqlString(row.notes)}, 'posted', NULL` +
      `);`
    );
  }
  writeFile('03_load_treasury.sql', lines);
  return { file: 'sql/generated_phase3/03_load_treasury.sql', rows: rows.length };
}

function warehouseToMovementType(warehouse, qtyIn, qtyOut) {
  if ((Number(qtyIn) || 0) > 0) return 'GRN';
  if ((Number(qtyOut) || 0) > 0) return 'ISSUE';
  return 'GRN';
}

function buildInventoryLoaders() {
  const itemRows = readJson('inventory__inventory_items_master.json').rows;
  const moveRows = readJson('inventory__inventory_movements_raw.json').rows;
  const itemLines = [];
  const moveLines = [];
  itemLines.push('-- Generated Phase 3 items loader from canonical_clean');
  itemLines.push('DELETE FROM items WHERE company_id = 1;');
  for (const row of itemRows) {
    itemLines.push(
      `INSERT INTO items (code, company_id, name, unit, warehouse, reorder_threshold, is_active, track_lots, costing_method) VALUES (` +
      `${sqlNumber(row.item_code)}, ${COMPANY_ID}, ${sqlString(row.item_name)}, ${sqlString(row.unit || 'وحدة')}, NULL, 0, 1, 0, 'moving_average'` +
      `) ON CONFLICT(code, company_id) DO UPDATE SET name=excluded.name, unit=excluded.unit, is_active=1;`
    );
  }
  moveLines.push('-- Generated Phase 3 inventory movement loader from canonical_clean');
  moveLines.push('DELETE FROM inventory_movements WHERE company_id = 1;');
  for (const row of moveRows) {
    const movementDate = String(row.movement_date || '').slice(0, 10);
    const year = movementDate ? Number(movementDate.slice(0, 4)) : null;
    const month = movementDate ? Number(movementDate.slice(5, 7)) : null;
    const qtyIn = Number(row.qty_in) || 0;
    const qtyOut = Number(row.qty_out) || 0;
    const quantity = qtyIn > 0 ? qtyIn : qtyOut;
    const unitPrice = quantity > 0 ? ((Number(row.value_in) || Number(row.value_out) || 0) / quantity) : null;
    moveLines.push(
      `INSERT INTO inventory_movements (` +
      `company_id, item_code, center_code, sub_code, movement_date, warehouse, movement_type, quantity, unit_price, qty_in, qty_out, value_in, value_out, year, month, notes, status, journal_entry_id, gl_posting_status` +
      `) VALUES (` +
      `${COMPANY_ID}, ${sqlNumber(row.item_code)}, ${sqlNumber(row.center_code)}, ${sqlNumber(row.sub_code)}, ${sqlString(movementDate)}, ${sqlString(row.warehouse)}, ${sqlString(warehouseToMovementType(row.warehouse, qtyIn, qtyOut))}, ${sqlNumber(quantity)}, ${sqlNumber(unitPrice)}, ${sqlNumber(qtyIn)}, ${sqlNumber(qtyOut)}, ${sqlNumber(row.value_in)}, ${sqlNumber(row.value_out)}, ${sqlNumber(year)}, ${sqlNumber(month)}, NULL, 'posted', NULL, 'pending'` +
      `);`
    );
  }
  writeFile('04_load_items.sql', itemLines);
  writeFile('05_load_inventory_movements.sql', moveLines);
  return {
    itemsFile: 'sql/generated_phase3/04_load_items.sql',
    items: itemRows.length,
    movementsFile: 'sql/generated_phase3/05_load_inventory_movements.sql',
    movements: moveRows.length,
  };
}

function main() {
  ensureDir(OUT_DIR);
  const manifest = {
    generatedAt: new Date().toISOString(),
    outputs: [
      buildCoaLoader(),
      buildSupplierLoader(),
      buildTreasuryLoader(),
      buildInventoryLoaders(),
    ],
  };
  fs.writeFileSync(path.join(OUT_DIR, '_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Wrote ${path.join(OUT_DIR, '_manifest.json')}`);
}

main();
