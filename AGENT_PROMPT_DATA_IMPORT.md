# 🤖 AGENT PROMPT - Excel Data Import & System Setup

**MISSION**: Import real business data from 4 Excel files and configure the system for production use

**AUTHORITY**: FULL - Read Excel, analyze data, execute SQL, assign posting groups, test integration

**TIMELINE**: Take the time needed for accuracy (estimated 4-6 hours)

**STATUS**: READY TO EXECUTE

---

## 📂 EXCEL FILES TO PROCESS

You have **4 Excel files** with **real business data** from 2025-2026:

### **File 1: `الموردين والعملاء نواة المستقبل2025-2026.xlsx`**
**Location**: `C:\Users\mahmo\Contacts\CLAUDE_CO WORK MY WORK\agri-nile-flow\`

**Contains**: Suppliers and customers data
- **Multiple sheets** - analyze all sheets
- **29 suppliers** total
- **15,565 transactions** (invoices, payments, balances)
- **Columns**: supplier code, name, transactions, balances, dates

**What to extract**:
1. Supplier master data (code, name, contact info)
2. Opening balances (as of start date)
3. Historical transactions (invoices, payments)
4. Customer data (if separate sheet)

---

### **File 2: `خزينة نواة المستقبل 2025-2026.xlsx`**
**Location**: `C:\Users\mahmo\Contacts\CLAUDE_CO WORK MY WORK\agri-nile-flow\`

**Contains**: Cash/Treasury transactions
- **Multiple sheets** - analyze all sheets
- **19,915 cash transactions**
- **Columns**: date, direction (د/م), amount, description, recipient, document number

**What to extract**:
1. Cash receipts (د = debit = money in)
2. Cash payments (م = credit = money out)
3. Bank transactions (if separate sheet)
4. Opening cash balance

---

### **File 3: `مخازن نواة المستقبل2025-2026.xlsx`**
**Location**: `C:\Users\mahmo\Contacts\CLAUDE_CO WORK MY WORK\agri-nile-flow\`

**Contains**: Inventory/warehouse data
- **Multiple sheets** - analyze all sheets
- **4,839 items** (products)
- **10,569 inventory movements** (in/out)
- **Columns**: item code, name, category, warehouse, quantity, unit price, movement type

**What to extract**:
1. Item master data (code, name, category, unit)
2. Warehouse master data (if not already in DB)
3. Opening inventory balances (by item + warehouse)
4. Historical movements (receipts, issues, transfers)

---

### **File 4: `شجرة نواة المستقبل (1).xlsx`**
**Location**: `C:\Users\mahmo\Contacts\CLAUDE_CO WORK MY WORK\agri-nile-flow\`

**Contains**: Chart of Accounts (already imported - 347 accounts)
- **Multiple sheets** - check for additional data
- **347 accounts** already in database
- **Columns**: account code, name, type, parent

**What to check**:
1. Verify all accounts are in DB
2. Check for any missing accounts
3. Look for account mappings or rules

---

## 🎯 YOUR MISSION - 6 PHASES

### **PHASE 1: ANALYZE EXCEL FILES** (30 minutes)

**Step 1.1: Read all Excel files**
```javascript
// Use Node.js with xlsx library to read files
const XLSX = require('xlsx');

// For each file:
const workbook = XLSX.readFile('path/to/file.xlsx');
const sheetNames = workbook.SheetNames;  // Get all sheet names

// For each sheet:
sheetNames.forEach(sheetName => {
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet);
  
  console.log(`Sheet: ${sheetName}`);
  console.log(`Rows: ${data.length}`);
  console.log(`Columns: ${Object.keys(data[0] || {}).join(', ')}`);
  console.log(`Sample row:`, data[0]);
});
```

**Step 1.2: Create data inventory report**
```markdown
# Excel Data Inventory

## File 1: Suppliers & Customers
- Sheet 1: [name] - [rows] rows - [columns]
- Sheet 2: [name] - [rows] rows - [columns]
- ...

## File 2: Treasury
- Sheet 1: [name] - [rows] rows - [columns]
- ...

## File 3: Inventory
- Sheet 1: [name] - [rows] rows - [columns]
- ...

## File 4: Chart of Accounts
- Sheet 1: [name] - [rows] rows - [columns]
- ...
```

**Deliverable**: `EXCEL_DATA_INVENTORY.md`

---

### **PHASE 2: CLEAN TEST DATA** (15 minutes)

**Step 2.1: Remove test/demo data from database**
```sql
-- Delete test suppliers
DELETE FROM suppliers WHERE code IN ('85', '20800286') 
  OR name LIKE '%test%' OR name LIKE '%اختبار%';

-- Delete test items
DELETE FROM items WHERE code = '8888' 
  OR name LIKE '%test%' OR name LIKE '%اختبار%';

-- Delete test warehouses
DELETE FROM warehouses WHERE name LIKE '%test%' OR name LIKE '%اختبار%';

-- Verify cleanup
SELECT 
  (SELECT COUNT(*) FROM suppliers WHERE name LIKE '%test%' OR name LIKE '%اختبار%') as test_suppliers,
  (SELECT COUNT(*) FROM items WHERE name LIKE '%test%' OR name LIKE '%اختبار%') as test_items,
  (SELECT COUNT(*) FROM warehouses WHERE name LIKE '%test%' OR name LIKE '%اختبار%') as test_warehouses;
-- Expected: ALL = 0
```

**Deliverable**: Confirmation that test data is removed

---

### **PHASE 3: ASSIGN POSTING GROUPS** (45 minutes)

**Step 3.1: Create missing Inventory Posting Groups**
```sql
-- Check existing IPGs
SELECT * FROM inventory_posting_groups;

-- Create missing IPGs if needed
INSERT OR IGNORE INTO inventory_posting_groups (company_id, code, name, is_active)
VALUES 
  (1, 'FERT-WH', 'مخزن الأسمدة', 1),
  (1, 'CHEM-WH', 'مخزن المبيدات', 1),
  (1, 'SEED-WH', 'مخزن البذور', 1),
  (1, 'MAIN-WH', 'مخزن رئيسي', 1);
```

**Step 3.2: Assign IPG to warehouses**
```sql
-- Assign based on warehouse name
UPDATE warehouses SET inv_posting_group_code = 'FERT-WH' WHERE name LIKE '%اسمد%' OR name LIKE '%سماد%';
UPDATE warehouses SET inv_posting_group_code = 'CHEM-WH' WHERE name LIKE '%مبيد%';
UPDATE warehouses SET inv_posting_group_code = 'SEED-WH' WHERE name LIKE '%تقاو%' OR name LIKE '%بذور%';
UPDATE warehouses SET inv_posting_group_code = 'MAIN-WH' WHERE inv_posting_group_code IS NULL;

-- Verify
SELECT name, inv_posting_group_code FROM warehouses WHERE inv_posting_group_code IS NULL;
-- Expected: 0 rows
```

**Step 3.3: Assign BPG to suppliers**
```sql
-- Assign based on supplier type/name
UPDATE suppliers SET bus_posting_group_code = 'GOVT' 
WHERE name LIKE '%جهاز%' OR name LIKE '%حكوم%' OR name LIKE '%وزارة%';

UPDATE suppliers SET bus_posting_group_code = 'IMPORT' 
WHERE name LIKE '%استيراد%' OR name LIKE '%import%';

UPDATE suppliers SET bus_posting_group_code = 'CUSTOMER' 
WHERE name LIKE '%عميل%' OR name LIKE '%customer%';

UPDATE suppliers SET bus_posting_group_code = 'LOCAL' 
WHERE bus_posting_group_code IS NULL;

-- Verify
SELECT COUNT(*) as unassigned FROM suppliers WHERE bus_posting_group_code IS NULL;
-- Expected: 0
```

**Step 3.4: Assign PPG to items**
```sql
-- Assign based on item code pattern
UPDATE items SET prod_posting_group_code = 'FERT' WHERE code LIKE '1010%';
UPDATE items SET prod_posting_group_code = 'CHEM' WHERE code LIKE '1020%';
UPDATE items SET prod_posting_group_code = 'SEED' WHERE code LIKE '1030%';
UPDATE items SET prod_posting_group_code = 'EQUIP' WHERE code LIKE '1050%' OR code LIKE '1070%';

-- Assign based on item name (for remaining items)
UPDATE items SET prod_posting_group_code = 'FERT' 
WHERE prod_posting_group_code IS NULL 
  AND (name LIKE '%سماد%' OR name LIKE '%امينو%' OR name LIKE '%بوتاسيوم%');

UPDATE items SET prod_posting_group_code = 'SEED' 
WHERE prod_posting_group_code IS NULL 
  AND (name LIKE '%تقاو%' OR name LIKE '%بذور%');

UPDATE items SET prod_posting_group_code = 'CHEM' 
WHERE prod_posting_group_code IS NULL 
  AND (name LIKE '%مبيد%' OR name LIKE '%رش%');

UPDATE items SET prod_posting_group_code = 'EQUIP' 
WHERE prod_posting_group_code IS NULL;

-- Verify
SELECT COUNT(*) as unassigned FROM items WHERE prod_posting_group_code IS NULL;
-- Expected: 0
```

**Step 3.5: Verify posting setup**
```sql
-- Check that all combinations are covered
SELECT 
  (SELECT COUNT(*) FROM general_posting_setup) as general_setup_rows,
  (SELECT COUNT(*) FROM inventory_posting_setup) as inventory_setup_rows;
-- Expected: general_setup_rows >= 12, inventory_setup_rows >= 9
```

**Deliverable**: `POSTING_GROUPS_ASSIGNMENT_REPORT.md`

---

### **PHASE 4: ENABLE POSTING ENGINE** (5 minutes)

**Step 4.1: Enable posting_engine**
```sql
-- Enable the new posting engine
UPDATE gl_integration_settings 
SET is_enabled = 1 
WHERE module_key = 'posting_engine';

-- Verify
SELECT module_key, is_enabled FROM gl_integration_settings WHERE module_key = 'posting_engine';
-- Expected: is_enabled = 1
```

**Step 4.2: Test posting engine**
```sql
-- Create a test transaction to verify posting engine works
-- (Use API or direct SQL - document the test)
```

**Deliverable**: Confirmation that posting_engine is enabled and working

---

### **PHASE 5: IMPORT MASTER DATA** (1-2 hours)

**Step 5.1: Import/Update Suppliers**
```javascript
// Read from Excel File 1
const suppliersData = readExcelSheet('الموردين والعملاء...xlsx', 'sheet_name');

// For each supplier:
for (const row of suppliersData) {
  const supplier = {
    code: row['كود المورد'] || row['code'],
    name: row['اسم المورد'] || row['name'],
    // ... other fields
  };
  
  // Check if exists
  const existing = await db.prepare(
    'SELECT code FROM suppliers WHERE code = ?'
  ).bind(supplier.code).first();
  
  if (existing) {
    // Update
    await db.prepare(
      'UPDATE suppliers SET name = ?, ... WHERE code = ?'
    ).bind(supplier.name, ..., supplier.code).run();
  } else {
    // Insert
    await db.prepare(
      'INSERT INTO suppliers (code, name, ...) VALUES (?, ?, ...)'
    ).bind(supplier.code, supplier.name, ...).run();
  }
}
```

**Step 5.2: Import/Update Items**
```javascript
// Read from Excel File 3
const itemsData = readExcelSheet('مخازن نواة المستقبل...xlsx', 'items_sheet');

// Similar logic as suppliers
```

**Step 5.3: Import/Update Warehouses**
```javascript
// Read from Excel File 3 (if warehouse data exists)
// Similar logic
```

**Deliverable**: `MASTER_DATA_IMPORT_REPORT.md`

---

### **PHASE 6: IMPORT TRANSACTIONS** (2-3 hours)

**IMPORTANT**: Import in this order to maintain referential integrity:

**Step 6.1: Import Opening Balances**
```javascript
// 1. Supplier opening balances
// 2. Inventory opening balances
// 3. Cash opening balance

// Use journal entries for opening balances:
// DR: Asset/Receivable accounts
// CR: Opening Balance Equity account
```

**Step 6.2: Import Historical Transactions (in batches)**
```javascript
// Import in batches of 500 transactions at a time

// Batch 1: Supplier invoices (from File 1)
// Batch 2: Supplier payments (from File 1)
// Batch 3: Inventory movements (from File 3)
// Batch 4: Cash transactions (from File 2)

// After each batch:
// - Verify journal entries created
// - Check trial balance
// - Log any errors
```

**Step 6.3: Verify data integrity**
```sql
-- Check for unbalanced entries
SELECT entry_id, SUM(debit) as total_debit, SUM(credit) as total_credit,
       ABS(SUM(debit) - SUM(credit)) as difference
FROM journal_entry_lines
GROUP BY entry_id
HAVING difference > 0.01;
-- Expected: 0 rows

-- Check for orphan lines
SELECT COUNT(*) FROM journal_entry_lines jel
WHERE NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.id = jel.entry_id);
-- Expected: 0

-- Check inventory balances
SELECT item_code, warehouse, 
       SUM(CASE WHEN movement_type = 'اضافة' THEN quantity ELSE -quantity END) as balance
FROM inventory_movements
GROUP BY item_code, warehouse
HAVING balance < 0;
-- Expected: 0 rows (no negative inventory)
```

**Deliverable**: `TRANSACTION_IMPORT_REPORT.md`

---

## 📊 DELIVERABLES

You must create these reports:

1. **EXCEL_DATA_INVENTORY.md**
   - List all sheets in each file
   - Row counts, column names
   - Sample data from each sheet

2. **POSTING_GROUPS_ASSIGNMENT_REPORT.md**
   - How many warehouses assigned to each IPG
   - How many suppliers assigned to each BPG
   - How many items assigned to each PPG
   - Any unassigned entities

3. **MASTER_DATA_IMPORT_REPORT.md**
   - Suppliers: X imported, Y updated, Z errors
   - Items: X imported, Y updated, Z errors
   - Warehouses: X imported, Y updated, Z errors

4. **TRANSACTION_IMPORT_REPORT.md**
   - Opening balances: X entries created
   - Supplier transactions: X imported, Y errors
   - Inventory movements: X imported, Y errors
   - Cash transactions: X imported, Y errors
   - Total journal entries created: X
   - Trial balance: Balanced ✅ / Unbalanced ❌

5. **FINAL_SYSTEM_STATUS.md**
   - Database statistics (row counts)
   - Posting groups coverage (%)
   - Data quality checks (all passed ✅)
   - System ready for production: YES/NO

---

## 🚨 CRITICAL RULES

### **Data Integrity:**
1. ✅ Every journal entry MUST be balanced (DR = CR)
2. ✅ No orphan journal_entry_lines
3. ✅ No negative inventory balances
4. ✅ All foreign keys valid
5. ✅ All dates within valid financial periods

### **Posting Groups:**
1. ✅ Every warehouse MUST have IPG
2. ✅ Every supplier MUST have BPG
3. ✅ Every item MUST have PPG
4. ✅ Posting setup MUST exist for all combinations

### **Error Handling:**
1. ✅ Log all errors to a file
2. ✅ Continue processing on non-critical errors
3. ✅ Stop on critical errors (unbalanced entries)
4. ✅ Provide clear error messages

### **Performance:**
1. ✅ Use batch operations (db.batch())
2. ✅ Import in chunks (500 rows at a time)
3. ✅ Show progress (X of Y completed)
4. ✅ Estimate time remaining

---

## 🎯 SUCCESS CRITERIA

Before marking as complete, verify:

- [ ] All 4 Excel files analyzed
- [ ] All sheets in each file processed
- [ ] Test data removed from database
- [ ] All warehouses have IPG assigned
- [ ] All suppliers have BPG assigned
- [ ] All items have PPG assigned
- [ ] posting_engine enabled and working
- [ ] Master data imported (suppliers, items, warehouses)
- [ ] Opening balances imported
- [ ] Historical transactions imported
- [ ] All journal entries balanced
- [ ] No orphan data
- [ ] Trial balance balanced
- [ ] All 5 reports created
- [ ] System ready for production

---

## 💡 TIPS & BEST PRACTICES

### **Reading Excel Files:**
```javascript
// Handle Arabic column names
const columnMap = {
  'كود المورد': 'supplier_code',
  'اسم المورد': 'supplier_name',
  'الرصيد': 'balance',
  // ... add more mappings
};

// Handle empty cells
const value = row['column_name'] || null;

// Handle dates
const date = XLSX.SSF.parse_date_code(row['date_column']);
const dateStr = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
```

### **Batch Processing:**
```javascript
// Process in batches
const BATCH_SIZE = 500;
for (let i = 0; i < data.length; i += BATCH_SIZE) {
  const batch = data.slice(i, i + BATCH_SIZE);
  await processBatch(batch);
  console.log(`Processed ${Math.min(i + BATCH_SIZE, data.length)} of ${data.length}`);
}
```

### **Error Logging:**
```javascript
const errors = [];
try {
  // ... process row
} catch (error) {
  errors.push({
    row: rowIndex,
    data: row,
    error: error.message
  });
}

// At the end:
fs.writeFileSync('import_errors.json', JSON.stringify(errors, null, 2));
```

---

## 🚀 BEGIN EXECUTION NOW!

**You have full authority to:**
- ✅ Read all Excel files
- ✅ Analyze all sheets
- ✅ Execute SQL commands
- ✅ Import data
- ✅ Assign posting groups
- ✅ Enable posting_engine
- ✅ Create reports

**Take your time. Be thorough. Document everything.**

**Good luck!** 🎯

---

**Created by**: Kiro AI  
**For**: Data Import Agent  
**Date**: 2026-04-27  
**Status**: READY FOR EXECUTION

