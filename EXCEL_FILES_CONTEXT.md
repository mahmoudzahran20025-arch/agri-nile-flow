# 📊 Excel Files - Additional Context for Agent

**Purpose**: Provide detailed context about the Excel files structure and data patterns

---

## 📂 FILE LOCATIONS

All files are in:
```
C:\Users\mahmo\Contacts\CLAUDE_CO WORK MY WORK\agri-nile-flow\
```

Files:
1. `الموردين والعملاء نواة المستقبل2025-2026.xlsx`
2. `خزينة نواة المستقبل 2025-2026.xlsx`
3. `مخازن نواة المستقبل2025-2026.xlsx`
4. `شجرة نواة المستقبل (1).xlsx`

---

## 🔍 KNOWN DATA PATTERNS

### **From Previous Analysis:**

#### **File 1: Suppliers & Customers**
- **29 suppliers** total
- **15,565 transactions**
- Likely contains:
  - Supplier master data sheet
  - Transactions sheet (invoices, payments)
  - Balances sheet (opening/closing balances)
  - Maybe customer data in separate sheet

#### **File 2: Treasury/Cash**
- **19,915 cash transactions**
- Columns likely include:
  - `التاريخ` (date)
  - `البيان` (description/narration)
  - `د` (debit - money in)
  - `م` (credit - money out)
  - `الرصيد` (balance)
  - `رقم المستند` (document number)
  - `اسم المستلم` (recipient name)

#### **File 3: Inventory/Warehouses**
- **4,839 items**
- **10,569 movements**
- Likely contains:
  - Items master data sheet
  - Inventory movements sheet
  - Stock balances sheet
  - Maybe warehouse master data

#### **File 4: Chart of Accounts**
- **347 accounts** (already imported)
- Structure:
  - Account code
  - Account name (Arabic)
  - Account type
  - Parent account

---

## 🎯 DATA MAPPING GUIDE

### **Suppliers Mapping:**
```javascript
// Excel columns → Database columns
{
  'كود المورد': 'code',
  'اسم المورد': 'name',
  'العنوان': 'address',
  'التليفون': 'phone',
  'الرصيد الافتتاحي': 'opening_balance',
  'النوع': 'type',  // 'supplier' or 'customer'
}
```

### **Items Mapping:**
```javascript
// Excel columns → Database columns
{
  'كود الصنف': 'code',
  'اسم الصنف': 'name',
  'الوحدة': 'unit',
  'الفئة': 'category',
  'سعر الشراء': 'unit_cost',
  'سعر البيع': 'unit_price',
  'الرصيد': 'opening_balance',
}
```

### **Inventory Movements Mapping:**
```javascript
// Excel columns → Database columns
{
  'التاريخ': 'movement_date',
  'كود الصنف': 'item_code',
  'اسم الصنف': 'item_name',
  'المخزن': 'warehouse',
  'نوع الحركة': 'movement_type',  // 'اضافة' or 'صرف'
  'الكمية': 'quantity',
  'السعر': 'unit_price',
  'القيمة': 'value',
  'البيان': 'notes',
}
```

### **Cash Transactions Mapping:**
```javascript
// Excel columns → Database columns
{
  'التاريخ': 'transaction_date',
  'البيان': 'narration',
  'د': 'debit',  // Money in
  'م': 'credit',  // Money out
  'الرصيد': 'running_balance',
  'رقم المستند': 'document_number',
  'اسم المستلم': 'recipient_name',
  'المركز': 'center_code',
}
```

---

## 🔢 BUSINESS RULES

### **Suppliers:**
1. **Code format**: Usually numeric (e.g., 20900151, 21400002)
2. **Types**: 
   - Suppliers (موردين)
   - Customers (عملاء)
   - Both (مورد وعميل)
3. **BPG Assignment**:
   - Government entities → 'GOVT'
   - Import companies → 'IMPORT'
   - Customers → 'CUSTOMER'
   - Others → 'LOCAL'

### **Items:**
1. **Code format**: Usually 7 digits (e.g., 1010189, 1030265)
2. **Code patterns**:
   - `1010xxx` = Fertilizers (أسمدة)
   - `1020xxx` = Chemicals/Pesticides (مبيدات)
   - `1030xxx` = Seeds (تقاوى/بذور)
   - `1050xxx` = Equipment (معدات)
   - `1070xxx` = Supplies (مستلزمات)
3. **PPG Assignment**:
   - Fertilizers → 'FERT'
   - Chemicals → 'CHEM'
   - Seeds → 'SEED'
   - Equipment → 'EQUIP'
   - Harvest → 'HARVEST'

### **Warehouses:**
1. **Names**: Arabic names (e.g., 'اسمدة', 'مبيدات', 'تقاوي وبذور')
2. **IPG Assignment**:
   - Fertilizer warehouse → 'FERT-WH'
   - Chemical warehouse → 'CHEM-WH'
   - Seed warehouse → 'SEED-WH'
   - Others → 'MAIN-WH'

### **Transactions:**
1. **Dates**: Format `YYYY-MM-DD` or Excel date serial
2. **Amounts**: Always positive numbers
3. **Direction**: 
   - 'د' (debit) = money in / inventory in
   - 'م' (credit) = money out / inventory out
4. **Balance**: Running balance after each transaction

---

## 🚨 DATA QUALITY CHECKS

### **Before Import:**
- [ ] Check for duplicate codes (suppliers, items)
- [ ] Check for missing required fields
- [ ] Check for invalid dates
- [ ] Check for negative amounts
- [ ] Check for invalid references (foreign keys)

### **After Import:**
- [ ] Verify row counts match Excel
- [ ] Verify total amounts match Excel
- [ ] Verify balances match Excel
- [ ] Check for orphan records
- [ ] Check for unbalanced journal entries

---

## 📝 SAMPLE DATA STRUCTURES

### **Supplier Transaction (from Excel):**
```javascript
{
  date: '2025-01-15',
  supplier_code: '20900151',
  supplier_name: 'جهاز مستقبل مصر',
  transaction_type: 'invoice',  // or 'payment'
  document_number: 'INV-2025-001',
  amount: 50000,
  description: 'فاتورة شراء أسمدة',
  balance: 150000  // Running balance
}
```

### **Inventory Movement (from Excel):**
```javascript
{
  date: '2025-01-15',
  item_code: '1010189',
  item_name: 'اى جى امينو',
  warehouse: 'اسمدة',
  movement_type: 'اضافة',  // or 'صرف'
  quantity: 100,
  unit_price: 50,
  value: 5000,
  notes: 'استلام من المورد',
  balance_qty: 250,  // Running balance
  balance_value: 12500
}
```

### **Cash Transaction (from Excel):**
```javascript
{
  date: '2025-01-15',
  direction: 'د',  // or 'م'
  amount: 10000,
  narration: 'ايراد بيع محصول',
  recipient_name: 'عميل نقدى',
  document_number: 123,
  balance: 50000  // Running balance
}
```

---

## 🎯 IMPORT STRATEGY

### **Phase 1: Master Data (Foundation)**
```
1. Suppliers (from File 1)
2. Items (from File 3)
3. Warehouses (from File 3 or existing in DB)
4. Verify all master data has posting groups assigned
```

### **Phase 2: Opening Balances (Starting Point)**
```
1. Supplier opening balances → journal entries
2. Inventory opening balances → journal entries
3. Cash opening balance → journal entry
4. Verify trial balance is balanced
```

### **Phase 3: Historical Transactions (Chronological)**
```
1. Sort all transactions by date (oldest first)
2. Import in batches of 500
3. After each batch:
   - Verify journal entries created
   - Check trial balance
   - Log any errors
4. Continue until all transactions imported
```

---

## 💡 TIPS FOR AGENT

### **Handling Multiple Sheets:**
```javascript
// Read all sheets
const workbook = XLSX.readFile(filePath);
const sheetNames = workbook.SheetNames;

console.log(`File has ${sheetNames.length} sheets:`);
sheetNames.forEach((name, index) => {
  const sheet = workbook.Sheets[name];
  const data = XLSX.utils.sheet_to_json(sheet);
  console.log(`  ${index + 1}. ${name} (${data.length} rows)`);
});

// Identify which sheet contains what data
// Look for keywords in sheet names or column headers
```

### **Handling Arabic Text:**
```javascript
// Excel may have encoding issues
// Use proper encoding when reading
const data = XLSX.utils.sheet_to_json(sheet, { 
  raw: false,  // Convert to strings
  defval: null  // Default value for empty cells
});

// Trim whitespace from Arabic text
const cleanText = text?.trim() || null;
```

### **Handling Dates:**
```javascript
// Excel stores dates as serial numbers
// Convert to proper date format
function excelDateToJS(serial) {
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  const date_info = new Date(utc_value * 1000);
  
  const year = date_info.getFullYear();
  const month = String(date_info.getMonth() + 1).padStart(2, '0');
  const day = String(date_info.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}
```

### **Progress Tracking:**
```javascript
// Show progress during import
let processed = 0;
const total = data.length;
const startTime = Date.now();

for (const row of data) {
  // ... process row
  processed++;
  
  if (processed % 100 === 0) {
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = processed / elapsed;
    const remaining = (total - processed) / rate;
    
    console.log(`Progress: ${processed}/${total} (${Math.round(processed/total*100)}%)`);
    console.log(`Estimated time remaining: ${Math.round(remaining)}s`);
  }
}
```

---

## 🚀 READY TO START

**Agent, you now have:**
- ✅ File locations
- ✅ Data patterns
- ✅ Mapping guides
- ✅ Business rules
- ✅ Quality checks
- ✅ Sample structures
- ✅ Import strategy
- ✅ Code examples

**Begin with PHASE 1: Analyze Excel files**

**Good luck!** 🎯

---

**Created by**: Kiro AI  
**Date**: 2026-04-27  
**Status**: READY FOR AGENT

