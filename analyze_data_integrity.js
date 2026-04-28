// ============================================================================
// Data Integrity Analysis Script
// Purpose: Analyze inventory discrepancies and account statement issues
// ============================================================================

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\mahmo\\Contacts\\CLAUDE_CO WORK MY WORK\\agri-nile-flow';

console.log('=== DATA INTEGRITY ANALYSIS ===\n');

// ============================================================================
// PART 1: INVENTORY ANALYSIS
// ============================================================================

console.log('📦 PART 1: INVENTORY ANALYSIS\n');

const invWb = XLSX.readFile(path.join(BASE, 'مخازن نواة المستقبل2025-2026.xlsx'), { cellDates: false });
const invSheet = invWb.Sheets['البيانات'];
const invRaw = XLSX.utils.sheet_to_json(invSheet, { raw: true, defval: null });

console.log(`Total rows in Excel: ${invRaw.length}`);

// Helper functions
function toDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && v > 40000 && v < 55000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().substring(0, 10);
  }
  return null;
}

function isValidDate(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number' && v > 40000 && v < 55000) return true;
  return false;
}

// Analyze inventory movements
const validMovements = invRaw.slice(2).filter(row => isValidDate(row['__EMPTY_3']));
console.log(`Valid movements (with date): ${validMovements.length}`);

// Group by item
const itemMovements = new Map();
for (const row of validMovements) {
  const itemCode = row['__EMPTY_10'];
  const itemName = row['__EMPTY_11'];
  const date = toDate(row['__EMPTY_3']);
  const warehouse = row['__EMPTY_4'];
  const quantity = parseFloat(row['__EMPTY_22']) || 0;
  const movementType = row['اضافة'] || 'اضافة';
  
  if (!itemCode) continue;
  
  if (!itemMovements.has(itemCode)) {
    itemMovements.set(itemCode, {
      code: itemCode,
      name: itemName,
      movements: [],
      totalIn: 0,
      totalOut: 0,
      balance: 0
    });
  }
  
  const item = itemMovements.get(itemCode);
  item.movements.push({
    date,
    warehouse,
    quantity,
    type: movementType
  });
  
  // Calculate balance (assuming اضافة = in, صرف = out)
  if (movementType.includes('اضافة') || movementType.includes('وارد')) {
    item.totalIn += quantity;
  } else {
    item.totalOut += quantity;
  }
}

// Calculate final balances
for (const [code, item] of itemMovements) {
  item.balance = item.totalIn - item.totalOut;
}

console.log(`\nUnique items: ${itemMovements.size}`);
console.log(`\nTop 10 items by movement count:`);

const sortedItems = Array.from(itemMovements.values())
  .sort((a, b) => b.movements.length - a.movements.length)
  .slice(0, 10);

for (const item of sortedItems) {
  console.log(`  ${item.code} - ${item.name}: ${item.movements.length} movements, Balance: ${item.balance.toFixed(2)}`);
}

// Check for negative balances
const negativeBalances = Array.from(itemMovements.values())
  .filter(item => item.balance < 0);

console.log(`\n❌ Items with NEGATIVE balance: ${negativeBalances.length}`);
if (negativeBalances.length > 0) {
  console.log('  (This indicates data quality issues!)');
  for (const item of negativeBalances.slice(0, 5)) {
    console.log(`  ${item.code} - ${item.name}: ${item.balance.toFixed(2)}`);
  }
}

// Check for duplicate movements
console.log(`\n🔍 Checking for duplicate movements...`);
const movementSignatures = new Map();
let duplicateCount = 0;

for (const [code, item] of itemMovements) {
  for (const mov of item.movements) {
    const signature = `${code}-${mov.date}-${mov.warehouse}-${mov.quantity}-${mov.type}`;
    if (movementSignatures.has(signature)) {
      duplicateCount++;
    } else {
      movementSignatures.set(signature, true);
    }
  }
}

console.log(`❌ Duplicate movements found: ${duplicateCount}`);

// ============================================================================
// PART 2: SUPPLIER TRANSACTIONS ANALYSIS
// ============================================================================

console.log('\n\n👥 PART 2: SUPPLIER TRANSACTIONS ANALYSIS\n');

const suppWb = XLSX.readFile(path.join(BASE, 'الموردين والعملاء نواة المستقبل2025-2026.xlsx'), { cellDates: false });
const suppTxSheet = suppWb.Sheets['البيان'];
const suppTxRaw = XLSX.utils.sheet_to_json(suppTxSheet, { raw: true, defval: null });

console.log(`Total supplier transaction rows: ${suppTxRaw.length}`);

const validSuppTx = suppTxRaw.filter(row => isValidDate(row['__EMPTY']));
console.log(`Valid supplier transactions: ${validSuppTx.length}`);

// Group by supplier
const supplierAccounts = new Map();

for (const row of validSuppTx) {
  const supplierCode = row['__EMPTY_1'];
  const date = toDate(row['__EMPTY']);
  const entryType = row['د'] || 'د';
  const amount = parseFloat(row['__EMPTY_18']) || 0;
  const debit = parseFloat(row['__EMPTY_19']) || 0;
  const credit = parseFloat(row['__EMPTY_20']) || 0;
  
  if (!supplierCode) continue;
  
  if (!supplierAccounts.has(supplierCode)) {
    supplierAccounts.set(supplierCode, {
      code: supplierCode,
      transactions: [],
      totalDebit: 0,
      totalCredit: 0,
      balance: 0
    });
  }
  
  const supplier = supplierAccounts.get(supplierCode);
  supplier.transactions.push({
    date,
    entryType,
    amount,
    debit,
    credit
  });
  
  supplier.totalDebit += debit;
  supplier.totalCredit += credit;
}

// Calculate balances
for (const [code, supplier] of supplierAccounts) {
  supplier.balance = supplier.totalCredit - supplier.totalDebit;
}

console.log(`\nUnique suppliers: ${supplierAccounts.size}`);
console.log(`\nTop 10 suppliers by transaction count:`);

const sortedSuppliers = Array.from(supplierAccounts.values())
  .sort((a, b) => b.transactions.length - a.transactions.length)
  .slice(0, 10);

for (const supplier of sortedSuppliers) {
  console.log(`  Supplier ${supplier.code}: ${supplier.transactions.length} transactions, Balance: ${supplier.balance.toFixed(2)}`);
}

// Check for negative balances (supplier owes us - unusual)
const negativeSupplierBalances = Array.from(supplierAccounts.values())
  .filter(s => s.balance < 0);

console.log(`\n⚠️ Suppliers with NEGATIVE balance (we owe them): ${negativeSupplierBalances.length}`);
for (const supplier of negativeSupplierBalances.slice(0, 5)) {
  console.log(`  Supplier ${supplier.code}: ${supplier.balance.toFixed(2)}`);
}

// Check for duplicate transactions
console.log(`\n🔍 Checking for duplicate supplier transactions...`);
const suppTxSignatures = new Map();
let suppDuplicateCount = 0;

for (const [code, supplier] of supplierAccounts) {
  for (const tx of supplier.transactions) {
    const signature = `${code}-${tx.date}-${tx.amount}-${tx.entryType}`;
    if (suppTxSignatures.has(signature)) {
      suppDuplicateCount++;
    } else {
      suppTxSignatures.set(signature, true);
    }
  }
}

console.log(`❌ Duplicate supplier transactions found: ${suppDuplicateCount}`);

// ============================================================================
// PART 3: CASH TRANSACTIONS ANALYSIS
// ============================================================================

console.log('\n\n💰 PART 3: CASH TRANSACTIONS ANALYSIS\n');

const cashWb = XLSX.readFile(path.join(BASE, 'خزينة نواة المستقبل 2025-2026.xlsx'), { cellDates: false });
const cashSheet = cashWb.Sheets['البيان'];
const cashRaw = XLSX.utils.sheet_to_json(cashSheet, { raw: true, defval: null });

console.log(`Total cash transaction rows: ${cashRaw.length}`);

const cashCols = cashRaw.length > 0 ? Object.keys(cashRaw[0]) : [];
const CASH_DATE = cashCols[0];

const validCashTx = cashRaw.filter(row => isValidDate(row[CASH_DATE]));
console.log(`Valid cash transactions: ${validCashTx.length}`);

let totalCashIn = 0;
let totalCashOut = 0;

for (const row of validCashTx) {
  const debit = parseFloat(row['__EMPTY_13']) || 0;
  const credit = parseFloat(row['__EMPTY_14']) || 0;
  
  totalCashIn += debit;
  totalCashOut += credit;
}

const cashBalance = totalCashIn - totalCashOut;

console.log(`\nTotal Cash In: ${totalCashIn.toFixed(2)}`);
console.log(`Total Cash Out: ${totalCashOut.toFixed(2)}`);
console.log(`Cash Balance: ${cashBalance.toFixed(2)}`);

// ============================================================================
// SUMMARY
// ============================================================================

console.log('\n\n📊 SUMMARY\n');

const report = {
  inventory: {
    totalMovements: validMovements.length,
    uniqueItems: itemMovements.size,
    negativeBalances: negativeBalances.length,
    duplicates: duplicateCount,
    status: negativeBalances.length === 0 && duplicateCount === 0 ? '✅ OK' : '❌ ISSUES FOUND'
  },
  suppliers: {
    totalTransactions: validSuppTx.length,
    uniqueSuppliers: supplierAccounts.size,
    negativeBalances: negativeSupplierBalances.length,
    duplicates: suppDuplicateCount,
    status: negativeSupplierBalances.length === 0 && suppDuplicateCount === 0 ? '✅ OK' : '❌ ISSUES FOUND'
  },
  cash: {
    totalTransactions: validCashTx.length,
    totalIn: totalCashIn,
    totalOut: totalCashOut,
    balance: cashBalance,
    status: cashBalance >= 0 ? '✅ OK' : '❌ NEGATIVE BALANCE'
  }
};

console.log('Inventory:', report.inventory.status);
console.log(`  - Total movements: ${report.inventory.totalMovements}`);
console.log(`  - Unique items: ${report.inventory.uniqueItems}`);
console.log(`  - Negative balances: ${report.inventory.negativeBalances}`);
console.log(`  - Duplicates: ${report.inventory.duplicates}`);

console.log('\nSuppliers:', report.suppliers.status);
console.log(`  - Total transactions: ${report.suppliers.totalTransactions}`);
console.log(`  - Unique suppliers: ${report.suppliers.uniqueSuppliers}`);
console.log(`  - Negative balances: ${report.suppliers.negativeBalances}`);
console.log(`  - Duplicates: ${report.suppliers.duplicates}`);

console.log('\nCash:', report.cash.status);
console.log(`  - Total transactions: ${report.cash.totalTransactions}`);
console.log(`  - Balance: ${report.cash.balance.toFixed(2)}`);

// Save report
fs.writeFileSync(
  path.join(BASE, 'data_integrity_report.json'),
  JSON.stringify(report, null, 2)
);

console.log('\n✅ Report saved to: data_integrity_report.json');
