# 🔍 AGENT PROMPT - Data Verification & Reconciliation

**MISSION**: Verify complete data integrity between Excel sheets and production database

**AUTHORITY**: FULL - Read Excel, query database, analyze discrepancies, create reports

**TIMELINE**: Take the time needed for thorough verification (estimated 2-3 hours)

**STATUS**: READY TO EXECUTE

---

## 🎯 YOUR MISSION

Perform comprehensive data verification to ensure:
1. ✅ All codes in Excel match codes in database
2. ✅ All imported data is accurate
3. ✅ No missing records
4. ✅ No data corruption
5. ✅ All mappings are correct
6. ✅ 100% data integrity

---

## 📂 EXCEL FILES TO VERIFY

### **File 1: الموردين والعملاء نواة المستقبل2025-2026.xlsx**
```
Sheets:
1. الكود (Suppliers master data)
   - Columns: الكود، المورد، النشاط، ملاحظات
   - Expected: 29 suppliers

2. البيان (Supplier transactions)
   - Columns: Date, Entry Type, Supplier Code, Amount, etc.
   - Expected: 15,565 transactions
```

### **File 2: خزينة نواة المستقبل 2025-2026.xlsx**
```
Sheet: البيان (Cash transactions)
- Columns: Date, Direction, Amount, Narration, etc.
- Expected: 19,915 transactions
```

### **File 3: مخازن نواة المستقبل2025-2026.xlsx**
```
Sheet: البيانات (Inventory movements)
- Columns: Date, Warehouse, Item Code, Item Name, Quantity, etc.
- Expected: 10,569 movements
- Unique items: 4,839
```

### **File 4: شجرة نواة المستقبل (1).xlsx**
```
Sheet: Chart of Accounts
- Expected: 347 accounts
```

---

## 🔍 VERIFICATION TASKS

### **PHASE 1: Suppliers Verification** (30 min)

#### **Task 1.1: Count Verification**
```javascript
// Read Excel
const suppliersInExcel = readExcelSheet('الموردين والعملاء نواة المستقبل2025-2026.xlsx', 'الكود');
console.log('Suppliers in Excel:', suppliersInExcel.length);

// Query Database
const suppliersInDB = await queryD1('SELECT COUNT(*) FROM suppliers WHERE company_id = 1');
console.log('Suppliers in DB:', suppliersInDB);

// Compare
if (suppliersInExcel.length !== suppliersInDB) {
  console.error('❌ MISMATCH: Supplier count does not match!');
}
```

#### **Task 1.2: Code Verification**
```javascript
// Get all supplier codes from Excel
const excelCodes = suppliersInExcel.map(s => s['الكود']).filter(Boolean);

// Get all supplier codes from DB
const dbCodes = await queryD1('SELECT code FROM suppliers WHERE company_id = 1');

// Find missing codes
const missingInDB = excelCodes.filter(code => !dbCodes.includes(code));
const extraInDB = dbCodes.filter(code => !excelCodes.includes(code));

console.log('Missing in DB:', missingInDB);
console.log('Extra in DB:', extraInDB);
```

#### **Task 1.3: Data Accuracy Verification**
```javascript
// For each supplier, verify:
// 1. Code matches
// 2. Name matches
// 3. Activity matches
// 4. Notes match

for (const excelSupplier of suppliersInExcel) {
  const code = excelSupplier['الكود'];
  const dbSupplier = await queryD1(`SELECT * FROM suppliers WHERE code = ${code} AND company_id = 1`);
  
  if (!dbSupplier) {
    console.error(`❌ Supplier ${code} not found in DB`);
    continue;
  }
  
  // Compare fields
  if (excelSupplier['المورد'] !== dbSupplier.name) {
    console.error(`❌ Name mismatch for supplier ${code}`);
  }
  
  if (excelSupplier['النشاط'] !== dbSupplier.activity) {
    console.warn(`⚠️ Activity mismatch for supplier ${code}`);
  }
}
```

#### **Task 1.4: Posting Groups Verification**
```javascript
// Verify all suppliers have posting groups assigned
const suppliersWithoutBPG = await queryD1(`
  SELECT code, name 
  FROM suppliers 
  WHERE company_id = 1 
  AND bus_posting_group_code IS NULL
`);

if (suppliersWithoutBPG.length > 0) {
  console.error('❌ Suppliers without BPG:', suppliersWithoutBPG);
}
```

---

### **PHASE 2: Items Verification** (30 min)

#### **Task 2.1: Count Verification**
```javascript
// Read Excel (unique items from inventory movements)
const movementsSheet = readExcelSheet('مخازن نواة المستقبل2025-2026.xlsx', 'البيانات');
const uniqueItemsInExcel = [...new Set(movementsSheet.map(row => row['__EMPTY_10']).filter(Boolean))];
console.log('Unique items in Excel:', uniqueItemsInExcel.length);

// Query Database
const itemsInDB = await queryD1('SELECT COUNT(*) FROM items WHERE company_id = 1');
console.log('Items in DB:', itemsInDB);
```

#### **Task 2.2: Code Verification**
```javascript
// Get all item codes from Excel
const excelItemCodes = uniqueItemsInExcel;

// Get all item codes from DB
const dbItemCodes = await queryD1('SELECT code FROM items WHERE company_id = 1');

// Find missing codes
const missingItemsInDB = excelItemCodes.filter(code => !dbItemCodes.includes(code));
const extraItemsInDB = dbItemCodes.filter(code => !excelItemCodes.includes(code));

console.log('Missing items in DB:', missingItemsInDB.length);
console.log('Extra items in DB:', extraItemsInDB.length);
```

#### **Task 2.3: Item Names Verification**
```javascript
// Build item map from Excel
const itemMap = new Map();
for (const row of movementsSheet) {
  const code = row['__EMPTY_10'];
  const name = row['__EMPTY_11'];
  if (code && name && !itemMap.has(code)) {
    itemMap.set(code, name);
  }
}

// Verify each item in DB
for (const [code, excelName] of itemMap) {
  const dbItem = await queryD1(`SELECT name FROM items WHERE code = ${code} AND company_id = 1`);
  
  if (!dbItem) {
    console.error(`❌ Item ${code} not found in DB`);
    continue;
  }
  
  if (excelName !== dbItem.name) {
    console.warn(`⚠️ Name mismatch for item ${code}: Excel="${excelName}" vs DB="${dbItem.name}"`);
  }
}
```

#### **Task 2.4: Posting Groups Verification**
```javascript
// Verify all items have posting groups assigned
const itemsWithoutPPG = await queryD1(`
  SELECT code, name 
  FROM items 
  WHERE company_id = 1 
  AND prod_posting_group_code IS NULL
`);

if (itemsWithoutPPG.length > 0) {
  console.error('❌ Items without PPG:', itemsWithoutPPG);
}
```

---

### **PHASE 3: Transactions Verification** (45 min)

#### **Task 3.1: Supplier Transactions Count**
```javascript
// Count in Excel
const supplierTxnsSheet = readExcelSheet('الموردين والعملاء نواة المستقبل2025-2026.xlsx', 'البيان');
const validSupplierTxns = supplierTxnsSheet.filter(row => isValidDate(row['__EMPTY']));
console.log('Supplier transactions in Excel:', validSupplierTxns.length);

// Count in DB
const supplierTxnsInDB = await queryD1('SELECT COUNT(*) FROM supplier_transactions WHERE company_id = 1');
console.log('Supplier transactions in DB:', supplierTxnsInDB);

// Analyze difference
if (validSupplierTxns.length !== supplierTxnsInDB) {
  console.warn(`⚠️ Difference: ${validSupplierTxns.length - supplierTxnsInDB} transactions`);
  console.log('This may be due to date filtering or data quality issues');
}
```

#### **Task 3.2: Cash Transactions Count**
```javascript
// Count in Excel
const cashTxnsSheet = readExcelSheet('خزينة نواة المستقبل 2025-2026.xlsx', 'البيان');
const validCashTxns = cashTxnsSheet.filter(row => isValidDate(row[Object.keys(row)[0]]));
console.log('Cash transactions in Excel:', validCashTxns.length);

// Count in DB
const cashTxnsInDB = await queryD1('SELECT COUNT(*) FROM cash_transactions WHERE company_id = 1');
console.log('Cash transactions in DB:', cashTxnsInDB);
```

#### **Task 3.3: Inventory Movements Count**
```javascript
// Count in Excel
const validMovements = movementsSheet.filter(row => isValidDate(row['__EMPTY_3']));
console.log('Inventory movements in Excel:', validMovements.length);

// Count in DB
const movementsInDB = await queryD1('SELECT COUNT(*) FROM inventory_movements WHERE company_id = 1');
console.log('Inventory movements in DB:', movementsInDB);
```

#### **Task 3.4: Sample Data Verification**
```javascript
// Pick 10 random transactions from each type and verify accuracy

// Supplier transactions
const sampleSupplierTxns = validSupplierTxns.slice(0, 10);
for (const excelTxn of sampleSupplierTxns) {
  const date = toDate(excelTxn['__EMPTY']);
  const supplierCode = excelTxn['__EMPTY_1'];
  const amount = excelTxn['__EMPTY_18'];
  
  const dbTxn = await queryD1(`
    SELECT * FROM supplier_transactions 
    WHERE company_id = 1 
    AND supplier_code = ${supplierCode}
    AND transaction_date = ${date}
    AND amount = ${amount}
    LIMIT 1
  `);
  
  if (!dbTxn) {
    console.error(`❌ Supplier transaction not found: ${supplierCode} on ${date}`);
  }
}

// Cash transactions
const sampleCashTxns = validCashTxns.slice(0, 10);
for (const excelTxn of sampleCashTxns) {
  const date = toDate(excelTxn[Object.keys(excelTxn)[0]]);
  const amount = excelTxn['__EMPTY_12'];
  
  const dbTxn = await queryD1(`
    SELECT * FROM cash_transactions 
    WHERE company_id = 1 
    AND transaction_date = ${date}
    AND amount = ${amount}
    LIMIT 1
  `);
  
  if (!dbTxn) {
    console.error(`❌ Cash transaction not found on ${date} for ${amount}`);
  }
}

// Inventory movements
const sampleMovements = validMovements.slice(0, 10);
for (const excelMov of sampleMovements) {
  const date = toDate(excelMov['__EMPTY_3']);
  const itemCode = excelMov['__EMPTY_10'];
  const quantity = excelMov['__EMPTY_22'];
  
  const dbMov = await queryD1(`
    SELECT * FROM inventory_movements 
    WHERE company_id = 1 
    AND movement_date = ${date}
    AND item_code = ${itemCode}
    AND quantity = ${quantity}
    LIMIT 1
  `);
  
  if (!dbMov) {
    console.error(`❌ Inventory movement not found: item ${itemCode} on ${date}`);
  }
}
```

---

### **PHASE 4: Chart of Accounts Verification** (20 min)

#### **Task 4.1: Count Verification**
```javascript
// Read Excel
const coaSheet = readExcelSheet('شجرة نواة المستقبل (1).xlsx', 'Sheet1');
console.log('Accounts in Excel:', coaSheet.length);

// Query Database
const accountsInDB = await queryD1('SELECT COUNT(*) FROM gl_accounts WHERE company_id = 1');
console.log('Accounts in DB:', accountsInDB);
```

#### **Task 4.2: Account Codes Verification**
```javascript
// Get all account codes from Excel
const excelAccountCodes = coaSheet.map(row => row['الكود']).filter(Boolean);

// Get all account codes from DB
const dbAccountCodes = await queryD1('SELECT code FROM gl_accounts WHERE company_id = 1');

// Find missing codes
const missingAccountsInDB = excelAccountCodes.filter(code => !dbAccountCodes.includes(code));
const extraAccountsInDB = dbAccountCodes.filter(code => !excelAccountCodes.includes(code));

console.log('Missing accounts in DB:', missingAccountsInDB.length);
console.log('Extra accounts in DB:', extraAccountsInDB.length);
```

---

### **PHASE 5: Posting Groups Coverage** (15 min)

#### **Task 5.1: Verify All Entities Have Posting Groups**
```javascript
// Suppliers
const suppliersWithBPG = await queryD1(`
  SELECT COUNT(*) FROM suppliers 
  WHERE company_id = 1 
  AND bus_posting_group_code IS NOT NULL
`);
const totalSuppliers = await queryD1('SELECT COUNT(*) FROM suppliers WHERE company_id = 1');
console.log(`Suppliers with BPG: ${suppliersWithBPG}/${totalSuppliers} (${(suppliersWithBPG/totalSuppliers*100).toFixed(1)}%)`);

// Items
const itemsWithPPG = await queryD1(`
  SELECT COUNT(*) FROM items 
  WHERE company_id = 1 
  AND prod_posting_group_code IS NOT NULL
`);
const totalItems = await queryD1('SELECT COUNT(*) FROM items WHERE company_id = 1');
console.log(`Items with PPG: ${itemsWithPPG}/${totalItems} (${(itemsWithPPG/totalItems*100).toFixed(1)}%)`);

// Warehouses
const warehousesWithIPG = await queryD1(`
  SELECT COUNT(*) FROM warehouses 
  WHERE company_id = 1 
  AND inv_posting_group_code IS NOT NULL
`);
const totalWarehouses = await queryD1('SELECT COUNT(*) FROM warehouses WHERE company_id = 1');
console.log(`Warehouses with IPG: ${warehousesWithIPG}/${totalWarehouses} (${(warehousesWithIPG/totalWarehouses*100).toFixed(1)}%)`);
```

#### **Task 5.2: Verify Posting Setup Coverage**
```javascript
// Check general_posting_setup
const generalSetupRows = await queryD1('SELECT COUNT(*) FROM general_posting_setup WHERE company_id = 1');
console.log('General posting setup rows:', generalSetupRows);

// Check inventory_posting_setup
const inventorySetupRows = await queryD1('SELECT COUNT(*) FROM inventory_posting_setup WHERE company_id = 1');
console.log('Inventory posting setup rows:', inventorySetupRows);

// Verify all combinations are covered
const uncoveredCombinations = await queryD1(`
  SELECT DISTINCT 
    s.bus_posting_group_code,
    i.prod_posting_group_code
  FROM suppliers s
  CROSS JOIN items i
  WHERE s.company_id = 1 
  AND i.company_id = 1
  AND NOT EXISTS (
    SELECT 1 FROM general_posting_setup gps
    WHERE gps.company_id = 1
    AND (gps.business_posting_group = s.bus_posting_group_code OR gps.business_posting_group IS NULL)
    AND (gps.product_posting_group = i.prod_posting_group_code OR gps.product_posting_group IS NULL)
  )
`);

if (uncoveredCombinations.length > 0) {
  console.error('❌ Uncovered posting combinations:', uncoveredCombinations);
}
```

---

### **PHASE 6: Data Quality Checks** (20 min)

#### **Task 6.1: Check for NULL Values**
```javascript
// Supplier transactions
const supplierTxnsWithNulls = await queryD1(`
  SELECT COUNT(*) FROM supplier_transactions 
  WHERE company_id = 1 
  AND (transaction_date IS NULL OR amount IS NULL OR supplier_code IS NULL)
`);
console.log('Supplier transactions with NULLs:', supplierTxnsWithNulls);

// Cash transactions
const cashTxnsWithNulls = await queryD1(`
  SELECT COUNT(*) FROM cash_transactions 
  WHERE company_id = 1 
  AND (transaction_date IS NULL OR amount IS NULL)
`);
console.log('Cash transactions with NULLs:', cashTxnsWithNulls);

// Inventory movements
const movementsWithNulls = await queryD1(`
  SELECT COUNT(*) FROM inventory_movements 
  WHERE company_id = 1 
  AND (movement_date IS NULL OR item_code IS NULL OR quantity IS NULL)
`);
console.log('Inventory movements with NULLs:', movementsWithNulls);
```

#### **Task 6.2: Check for Orphaned Records**
```javascript
// Supplier transactions with invalid supplier codes
const orphanedSupplierTxns = await queryD1(`
  SELECT COUNT(*) FROM supplier_transactions st
  WHERE st.company_id = 1
  AND st.supplier_code IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM suppliers s 
    WHERE s.code = st.supplier_code 
    AND s.company_id = 1
  )
`);
console.log('Orphaned supplier transactions:', orphanedSupplierTxns);

// Inventory movements with invalid item codes
const orphanedMovements = await queryD1(`
  SELECT COUNT(*) FROM inventory_movements im
  WHERE im.company_id = 1
  AND im.item_code IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM items i 
    WHERE i.code = im.item_code 
    AND i.company_id = 1
  )
`);
console.log('Orphaned inventory movements:', orphanedMovements);
```

#### **Task 6.3: Check for Duplicates**
```javascript
// Supplier transactions duplicates
const supplierTxnsDuplicates = await queryD1(`
  SELECT supplier_code, transaction_date, amount, COUNT(*) as count
  FROM supplier_transactions
  WHERE company_id = 1
  GROUP BY supplier_code, transaction_date, amount, entry_type
  HAVING COUNT(*) > 1
`);
console.log('Supplier transactions duplicates:', supplierTxnsDuplicates.length);

// Cash transactions duplicates
const cashTxnsDuplicates = await queryD1(`
  SELECT transaction_date, amount, direction, COUNT(*) as count
  FROM cash_transactions
  WHERE company_id = 1
  GROUP BY transaction_date, amount, direction, narration
  HAVING COUNT(*) > 1
`);
console.log('Cash transactions duplicates:', cashTxnsDuplicates.length);

// Inventory movements duplicates
const movementsDuplicates = await queryD1(`
  SELECT item_code, movement_date, quantity, COUNT(*) as count
  FROM inventory_movements
  WHERE company_id = 1
  GROUP BY item_code, warehouse, movement_date, quantity, movement_type
  HAVING COUNT(*) > 1
`);
console.log('Inventory movements duplicates:', movementsDuplicates.length);
```

---

## 📊 DELIVERABLES

You must create these reports:

### **1. DATA_VERIFICATION_REPORT.md**
```markdown
# Data Verification Report

## Summary
- Verification Date: [date]
- Status: ✅ PASS / ⚠️ WARNING / ❌ FAIL
- Overall Accuracy: [percentage]%

## Suppliers
- Excel count: [count]
- DB count: [count]
- Match: ✅ / ❌
- Missing in DB: [list]
- Extra in DB: [list]
- Data accuracy: [percentage]%

## Items
- Excel count: [count]
- DB count: [count]
- Match: ✅ / ❌
- Missing in DB: [list]
- Extra in DB: [list]
- Data accuracy: [percentage]%

## Transactions
### Supplier Transactions
- Excel count: [count]
- DB count: [count]
- Match: ✅ / ❌
- Sample verification: [X/10 passed]

### Cash Transactions
- Excel count: [count]
- DB count: [count]
- Match: ✅ / ❌
- Sample verification: [X/10 passed]

### Inventory Movements
- Excel count: [count]
- DB count: [count]
- Match: ✅ / ❌
- Sample verification: [X/10 passed]

## Chart of Accounts
- Excel count: [count]
- DB count: [count]
- Match: ✅ / ❌

## Posting Groups Coverage
- Suppliers with BPG: [X/Y] ([percentage]%)
- Items with PPG: [X/Y] ([percentage]%)
- Warehouses with IPG: [X/Y] ([percentage]%)
- Posting setup coverage: ✅ / ❌

## Data Quality
- NULL values: [count]
- Orphaned records: [count]
- Duplicates: [count]

## Issues Found
[List all issues with severity: CRITICAL, HIGH, MEDIUM, LOW]

## Recommendations
[List recommendations to fix issues]
```

### **2. DISCREPANCIES_REPORT.md**
```markdown
# Discrepancies Report

## Missing Suppliers
[List of supplier codes in Excel but not in DB]

## Missing Items
[List of item codes in Excel but not in DB]

## Missing Transactions
[List of transactions in Excel but not in DB]

## Extra Records in DB
[List of records in DB but not in Excel]

## Data Mismatches
[List of records where data doesn't match]

## Orphaned Records
[List of records with invalid references]

## Duplicates
[List of duplicate records]
```

### **3. RECONCILIATION_SUMMARY.md**
```markdown
# Reconciliation Summary

## Overall Status
✅ PASS / ⚠️ WARNING / ❌ FAIL

## Key Metrics
- Total records verified: [count]
- Matching records: [count] ([percentage]%)
- Discrepancies: [count] ([percentage]%)
- Data quality score: [percentage]%

## Action Items
[List of actions needed to fix issues]

## Sign-off
- Verified by: Agent
- Date: [date]
- Status: [status]
```

---

## 🚨 CRITICAL RULES

### **Accuracy:**
1. ✅ Use exact column names from Excel
2. ✅ Handle Arabic text correctly
3. ✅ Parse dates correctly (Excel serial numbers)
4. ✅ Compare numbers with tolerance (floating point)
5. ✅ Handle NULL values properly

### **Thoroughness:**
1. ✅ Verify ALL suppliers
2. ✅ Verify ALL items
3. ✅ Sample verify transactions (at least 10 of each type)
4. ✅ Check ALL posting groups
5. ✅ Check ALL data quality issues

### **Reporting:**
1. ✅ Be specific (list actual codes, not just counts)
2. ✅ Categorize issues by severity
3. ✅ Provide actionable recommendations
4. ✅ Include statistics and percentages
5. ✅ Create visual summaries (tables, charts)

---

## 🎯 SUCCESS CRITERIA

Before marking as complete, verify:

- [ ] All Excel files analyzed
- [ ] All database tables queried
- [ ] Supplier codes verified
- [ ] Item codes verified
- [ ] Transaction counts compared
- [ ] Sample transactions verified
- [ ] Chart of accounts verified
- [ ] Posting groups coverage checked
- [ ] Data quality checks performed
- [ ] All 3 reports created
- [ ] Issues categorized by severity
- [ ] Recommendations provided

---

## 🚀 BEGIN EXECUTION NOW!

**You have full authority to:**
- ✅ Read all Excel files
- ✅ Query production database
- ✅ Analyze discrepancies
- ✅ Create comprehensive reports
- ✅ Provide recommendations

**Take your time. Be thorough. Verify everything.**

**Good luck!** 💎

---

**Created by**: Kiro AI  
**For**: Data Verification Agent  
**Date**: 2026-04-27  
**Status**: READY FOR EXECUTION
