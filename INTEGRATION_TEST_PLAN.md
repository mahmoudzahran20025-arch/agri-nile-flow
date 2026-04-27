# 🧪 خطة اختبار التكامل - المخزون والموردين

**التاريخ**: 27 أبريل 2026  
**الهدف**: ضمان تكامل المخزون والموردين مع النظام الجديد قبل البيانات الحقيقية  
**المدة المتوقعة**: 2-3 ساعات  
**المنفذ**: Kiro AI

---

## ✅ **مراجعة شغل الـ Agent**

### **النتائج:**

| المؤشر | القيمة | الحالة |
|--------|--------|--------|
| **Clean Slate** | ✅ | 0 journal entries |
| **Posting Engine** | ✅ | Enabled (is_enabled = 1) |
| **Business Posting Groups** | ✅ | 4 groups (LOCAL, IMPORT, CUSTOMER, GOVT) |
| **Product Posting Groups** | ✅ | 5 groups (FERT, SEED, CHEM, EQUIP, HARVEST) |
| **Inventory Posting Groups** | ✅ | 3 groups (MAIN-WH, FERT-WH, SEED-WH) |
| **General Posting Setup** | ✅ | 12 rows (matrix complete) |
| **Inventory Posting Setup** | ✅ | 9 rows (matrix complete) |

### **التقييم**: 🌟🌟🌟🌟🌟 **Excellent Work!**

---

## 🎯 **الخطة: 3 مراحل اختبار**

```
Phase 1: Test Suppliers Integration (30 دقيقة)
    ↓
Phase 2: Test Inventory Integration (45 دقيقة)
    ↓
Phase 3: End-to-End Transaction Flow (45 دقيقة)
```

---

## 📦 **Phase 1: Test Suppliers Integration**

### **الهدف**: التأكد من تكامل الموردين مع الـ Posting Engine

### **Test Case 1.1: Create Test Suppliers**

```javascript
// Create 3 test suppliers with different BPGs

const testSuppliers = [
  {
    code: 'TEST-SUP-001',
    name: 'مورد محلي تجريبي',
    type: 'supplier',
    bus_posting_group_code: 'LOCAL',  // ← ربط بالـ BPG
    contact_person: 'أحمد محمد',
    phone: '01012345678',
    email: 'test1@example.com'
  },
  {
    code: 'TEST-SUP-002',
    name: 'مورد مستورد تجريبي',
    type: 'supplier',
    bus_posting_group_code: 'IMPORT',  // ← ربط بالـ BPG
    contact_person: 'محمد علي',
    phone: '01098765432',
    email: 'test2@example.com'
  },
  {
    code: 'TEST-CUS-001',
    name: 'عميل تجريبي',
    type: 'customer',
    bus_posting_group_code: 'CUSTOMER',  // ← ربط بالـ BPG
    contact_person: 'سارة أحمد',
    phone: '01055555555',
    email: 'test3@example.com'
  }
];

// Execute via API
for (const supplier of testSuppliers) {
  const response = await fetch('https://agri-nile-flow.workers.dev/api/suppliers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(supplier)
  });
  
  console.log(`Created: ${supplier.name} - Status: ${response.status}`);
}
```

### **Expected Result**:
```
✅ 3 suppliers created
✅ Each has bus_posting_group_code assigned
✅ No errors
```

### **Verification Query**:
```sql
SELECT code, name, type, bus_posting_group_code 
FROM suppliers 
WHERE code LIKE 'TEST-%' 
ORDER BY code;
```

---

### **Test Case 1.2: Create Supplier Invoice (Test Posting Engine)**

```javascript
// Create a supplier invoice to test posting engine

const testInvoice = {
  supplier_code: 'TEST-SUP-001',  // LOCAL supplier
  invoice_number: 'INV-TEST-001',
  invoice_date: '2026-04-27',
  due_date: '2026-05-27',
  amount: 10000,
  description: 'فاتورة اختبار - أسمدة',
  items: [
    {
      item_code: 'TEST-ITEM-001',  // سننشئه في Phase 2
      quantity: 100,
      unit_price: 100,
      ppg_code: 'FERT'  // ← Product Posting Group
    }
  ]
};

// Execute
const response = await fetch('https://agri-nile-flow.workers.dev/api/suppliers/invoices', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(testInvoice)
});

console.log('Invoice created:', response.status);
```

### **Expected Result**:
```
✅ Invoice created
✅ Journal entry auto-created by posting engine
✅ Accounts used: LOCAL × FERT matrix
   - DR: purchases_account (140701)
   - CR: accounts_payable (2110)
✅ Entry balanced (DR = CR)
```

### **Verification Query**:
```sql
-- Check journal entry was created
SELECT 
  je.id,
  je.entry_date,
  je.description,
  je.ref_type,
  jel.account_code,
  jel.debit,
  jel.credit
FROM journal_entries je
JOIN journal_entry_lines jel ON je.id = jel.entry_id
WHERE je.description LIKE '%TEST%'
ORDER BY je.id, jel.id;

-- Verify balance
SELECT 
  entry_id,
  SUM(debit) as total_debit,
  SUM(credit) as total_credit,
  ABS(SUM(debit) - SUM(credit)) as difference
FROM journal_entry_lines
WHERE entry_id IN (SELECT id FROM journal_entries WHERE description LIKE '%TEST%')
GROUP BY entry_id;
```

---

### **Test Case 1.3: Supplier Payment**

```javascript
// Create a payment to test cash transaction flow

const testPayment = {
  supplier_code: 'TEST-SUP-001',
  payment_date: '2026-04-27',
  amount: 5000,
  payment_method: 'bank_transfer',
  bank_account_id: 1,  // Assuming bank account exists
  reference: 'PAY-TEST-001',
  description: 'دفعة اختبار للمورد'
};

// Execute
const response = await fetch('https://agri-nile-flow.workers.dev/api/suppliers/payments', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(testPayment)
});

console.log('Payment created:', response.status);
```

### **Expected Result**:
```
✅ Payment created
✅ Journal entry auto-created
✅ Accounts used:
   - DR: accounts_payable (2110)
   - CR: bank_account (from bank_accounts table)
✅ Entry balanced
```

---

## 📦 **Phase 2: Test Inventory Integration**

### **الهدف**: التأكد من تكامل المخزون مع الـ Posting Engine

### **Test Case 2.1: Create Test Items**

```javascript
// Create 5 test items with different PPGs

const testItems = [
  {
    code: 'TEST-ITEM-001',
    name: 'سماد تجريبي',
    name_ar: 'سماد تجريبي',
    name_en: 'Test Fertilizer',
    category: 'fertilizer',
    unit: 'كجم',
    prod_posting_group_code: 'FERT',  // ← Product Posting Group
    unit_cost: 100,
    unit_price: 150
  },
  {
    code: 'TEST-ITEM-002',
    name: 'بذور تجريبية',
    name_ar: 'بذور تجريبية',
    name_en: 'Test Seeds',
    category: 'seed',
    unit: 'كجم',
    prod_posting_group_code: 'SEED',  // ← Product Posting Group
    unit_cost: 50,
    unit_price: 80
  },
  {
    code: 'TEST-ITEM-003',
    name: 'مبيد تجريبي',
    name_ar: 'مبيد تجريبي',
    name_en: 'Test Chemical',
    category: 'chemical',
    unit: 'لتر',
    prod_posting_group_code: 'CHEM',  // ← Product Posting Group
    unit_cost: 200,
    unit_price: 300
  },
  {
    code: 'TEST-ITEM-004',
    name: 'معدة تجريبية',
    name_ar: 'معدة تجريبية',
    name_en: 'Test Equipment',
    category: 'equipment',
    unit: 'قطعة',
    prod_posting_group_code: 'EQUIP',  // ← Product Posting Group
    unit_cost: 5000,
    unit_price: 7000
  },
  {
    code: 'TEST-ITEM-005',
    name: 'محصول تجريبي',
    name_ar: 'محصول تجريبي',
    name_en: 'Test Harvest',
    category: 'harvest',
    unit: 'كجم',
    prod_posting_group_code: 'HARVEST',  // ← Product Posting Group
    unit_cost: 30,
    unit_price: 50
  }
];

// Execute
for (const item of testItems) {
  const response = await fetch('https://agri-nile-flow.workers.dev/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item)
  });
  
  console.log(`Created: ${item.name} - Status: ${response.status}`);
}
```

### **Expected Result**:
```
✅ 5 items created
✅ Each has prod_posting_group_code assigned
✅ No errors
```

### **Verification Query**:
```sql
SELECT code, name, category, unit, prod_posting_group_code 
FROM items 
WHERE code LIKE 'TEST-%' 
ORDER BY code;
```

---

### **Test Case 2.2: Create Test Warehouses**

```javascript
// Create 2 test warehouses with different IPGs

const testWarehouses = [
  {
    code: 'TEST-WH-001',
    name: 'مخزن تجريبي رئيسي',
    name_ar: 'مخزن تجريبي رئيسي',
    name_en: 'Test Main Warehouse',
    location: 'القاهرة',
    inv_posting_group_code: 'MAIN-WH',  // ← Inventory Posting Group
    is_active: true
  },
  {
    code: 'TEST-WH-002',
    name: 'مخزن تجريبي للأسمدة',
    name_ar: 'مخزن تجريبي للأسمدة',
    name_en: 'Test Fertilizer Warehouse',
    location: 'الجيزة',
    inv_posting_group_code: 'FERT-WH',  // ← Inventory Posting Group
    is_active: true
  }
];

// Execute
for (const warehouse of testWarehouses) {
  const response = await fetch('https://agri-nile-flow.workers.dev/api/warehouses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(warehouse)
  });
  
  console.log(`Created: ${warehouse.name} - Status: ${response.status}`);
}
```

### **Expected Result**:
```
✅ 2 warehouses created
✅ Each has inv_posting_group_code assigned
✅ No errors
```

---

### **Test Case 2.3: Inventory Movement IN (Receipt)**

```javascript
// Test inventory increase (receipt from supplier)

const testReceipt = {
  warehouse_code: 'TEST-WH-001',  // MAIN-WH
  item_code: 'TEST-ITEM-001',     // FERT
  quantity: 100,
  unit_cost: 100,
  movement_type: 'in',
  movement_date: '2026-04-27',
  reference: 'REC-TEST-001',
  description: 'استلام اختبار - أسمدة',
  supplier_code: 'TEST-SUP-001'
};

// Execute
const response = await fetch('https://agri-nile-flow.workers.dev/api/inventory/movements', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(testReceipt)
});

console.log('Receipt created:', response.status);
```

### **Expected Result**:
```
✅ Movement created
✅ Journal entry auto-created by posting engine
✅ Accounts used: MAIN-WH × FERT matrix
   - DR: inventory_account (140701)
   - CR: purchases_account (140701) or AP
✅ Entry balanced
✅ Inventory balance updated
```

### **Verification Query**:
```sql
-- Check inventory movement
SELECT * FROM inventory_movements 
WHERE reference = 'REC-TEST-001';

-- Check journal entry
SELECT 
  je.id,
  je.description,
  jel.account_code,
  jel.debit,
  jel.credit
FROM journal_entries je
JOIN journal_entry_lines jel ON je.id = jel.entry_id
WHERE je.description LIKE '%REC-TEST%';

-- Check inventory balance
SELECT 
  item_code,
  warehouse_code,
  SUM(CASE WHEN movement_type = 'in' THEN quantity ELSE -quantity END) as balance
FROM inventory_movements
WHERE item_code = 'TEST-ITEM-001'
GROUP BY item_code, warehouse_code;
```

---

### **Test Case 2.4: Inventory Movement OUT (Issue)**

```javascript
// Test inventory decrease (issue to production/sale)

const testIssue = {
  warehouse_code: 'TEST-WH-001',
  item_code: 'TEST-ITEM-001',
  quantity: 30,
  movement_type: 'out',
  movement_date: '2026-04-27',
  reference: 'ISS-TEST-001',
  description: 'صرف اختبار - أسمدة',
  cost_center: 'FARM-001'
};

// Execute
const response = await fetch('https://agri-nile-flow.workers.dev/api/inventory/movements', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(testIssue)
});

console.log('Issue created:', response.status);
```

### **Expected Result**:
```
✅ Movement created
✅ Journal entry auto-created
✅ Accounts used:
   - DR: cogs_account (45010001)
   - CR: inventory_account (140701)
✅ Entry balanced
✅ Inventory balance updated (100 - 30 = 70)
```

---

## 📦 **Phase 3: End-to-End Transaction Flow**

### **الهدف**: اختبار السيناريو الكامل من الشراء للبيع

### **Test Case 3.1: Complete Purchase-to-Sale Cycle**

```javascript
// Scenario: شراء أسمدة من مورد → استلام في المخزن → بيع لعميل

// Step 1: Purchase Order (optional - if implemented)
// Step 2: Supplier Invoice
const invoice = {
  supplier_code: 'TEST-SUP-001',
  invoice_number: 'INV-CYCLE-001',
  invoice_date: '2026-04-27',
  amount: 20000,
  items: [
    {
      item_code: 'TEST-ITEM-001',
      quantity: 200,
      unit_price: 100
    }
  ]
};

// Step 3: Inventory Receipt
const receipt = {
  warehouse_code: 'TEST-WH-002',  // FERT-WH
  item_code: 'TEST-ITEM-001',
  quantity: 200,
  unit_cost: 100,
  movement_type: 'in',
  reference: 'REC-CYCLE-001',
  supplier_code: 'TEST-SUP-001'
};

// Step 4: Customer Sale (if implemented)
const sale = {
  customer_code: 'TEST-CUS-001',
  sale_date: '2026-04-28',
  items: [
    {
      item_code: 'TEST-ITEM-001',
      quantity: 50,
      unit_price: 150
    }
  ]
};

// Step 5: Inventory Issue (for sale)
const issue = {
  warehouse_code: 'TEST-WH-002',
  item_code: 'TEST-ITEM-001',
  quantity: 50,
  movement_type: 'out',
  reference: 'ISS-CYCLE-001',
  customer_code: 'TEST-CUS-001'
};

// Execute all steps
// ... (implementation)
```

### **Expected Result**:
```
✅ All transactions created
✅ All journal entries auto-created
✅ Inventory balance correct: 200 - 50 = 150
✅ Trial balance balanced
✅ P&L shows:
   - Revenue: 7,500 (50 × 150)
   - COGS: 5,000 (50 × 100)
   - Gross Profit: 2,500
```

---

### **Test Case 3.2: Multi-Warehouse Transfer**

```javascript
// Test transfer between warehouses

const transfer = {
  from_warehouse: 'TEST-WH-002',  // FERT-WH
  to_warehouse: 'TEST-WH-001',    // MAIN-WH
  item_code: 'TEST-ITEM-001',
  quantity: 20,
  transfer_date: '2026-04-27',
  reference: 'TRF-TEST-001',
  description: 'نقل اختبار بين المخازن'
};

// Execute
const response = await fetch('https://agri-nile-flow.workers.dev/api/inventory/transfers', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(transfer)
});
```

### **Expected Result**:
```
✅ Transfer created
✅ 2 movements created (OUT from FERT-WH, IN to MAIN-WH)
✅ Journal entries created (if applicable)
✅ Balances updated:
   - FERT-WH: 150 - 20 = 130
   - MAIN-WH: 0 + 20 = 20
```

---

## 📊 **Final Verification Checklist**

### **Data Integrity:**
- [ ] All journal entries balanced (DR = CR)
- [ ] No orphan journal_entry_lines
- [ ] All inventory movements have corresponding journal entries
- [ ] All supplier transactions have corresponding journal entries

### **Posting Groups:**
- [ ] All test suppliers have BPG assigned
- [ ] All test items have PPG assigned
- [ ] All test warehouses have IPG assigned
- [ ] Posting engine uses correct accounts based on groups

### **Account Resolution:**
- [ ] LOCAL × FERT uses correct accounts
- [ ] IMPORT × SEED uses correct accounts
- [ ] MAIN-WH × FERT uses correct inventory account
- [ ] Catch-all (NULL × NULL) works for unassigned entities

### **Financial Reports:**
- [ ] Trial Balance balanced
- [ ] Income Statement shows revenue and COGS
- [ ] Balance Sheet shows inventory and AP balances
- [ ] Ledger shows correct account movements

---

## 🧹 **Cleanup After Testing**

```sql
-- Delete all test data
BEGIN TRANSACTION;

-- Delete journal entries
DELETE FROM journal_entry_lines 
WHERE entry_id IN (
  SELECT id FROM journal_entries 
  WHERE description LIKE '%TEST%' OR description LIKE '%CYCLE%'
);

DELETE FROM journal_entries 
WHERE description LIKE '%TEST%' OR description LIKE '%CYCLE%';

-- Delete inventory movements
DELETE FROM inventory_movements 
WHERE reference LIKE '%TEST%' OR reference LIKE '%CYCLE%';

-- Delete suppliers
DELETE FROM suppliers WHERE code LIKE 'TEST-%';

-- Delete items
DELETE FROM items WHERE code LIKE 'TEST-%';

-- Delete warehouses
DELETE FROM warehouses WHERE code LIKE 'TEST-%';

-- Verify clean
SELECT 
  (SELECT COUNT(*) FROM journal_entries WHERE description LIKE '%TEST%') as test_entries,
  (SELECT COUNT(*) FROM suppliers WHERE code LIKE 'TEST-%') as test_suppliers,
  (SELECT COUNT(*) FROM items WHERE code LIKE 'TEST-%') as test_items;
-- Expected: ALL = 0

COMMIT;
```

---

## 📝 **Test Results Template**

```json
{
  "test_date": "2026-04-27",
  "tester": "Kiro AI",
  "phase_1_suppliers": {
    "test_1_1_create_suppliers": "PASS/FAIL",
    "test_1_2_supplier_invoice": "PASS/FAIL",
    "test_1_3_supplier_payment": "PASS/FAIL",
    "notes": "..."
  },
  "phase_2_inventory": {
    "test_2_1_create_items": "PASS/FAIL",
    "test_2_2_create_warehouses": "PASS/FAIL",
    "test_2_3_inventory_in": "PASS/FAIL",
    "test_2_4_inventory_out": "PASS/FAIL",
    "notes": "..."
  },
  "phase_3_end_to_end": {
    "test_3_1_purchase_to_sale": "PASS/FAIL",
    "test_3_2_warehouse_transfer": "PASS/FAIL",
    "notes": "..."
  },
  "final_verification": {
    "data_integrity": "PASS/FAIL",
    "posting_groups": "PASS/FAIL",
    "account_resolution": "PASS/FAIL",
    "financial_reports": "PASS/FAIL"
  },
  "overall_status": "PASS/FAIL",
  "ready_for_production": true/false
}
```

---

## 🚀 **Next Steps After Testing**

### **If All Tests PASS:**
1. ✅ Cleanup test data
2. ✅ Document any issues found and fixed
3. ✅ Proceed to real data entry from Excel
4. ✅ Start with suppliers (29 suppliers)
5. ✅ Then items (4,839 items)
6. ✅ Then transactions (50,000 transactions)

### **If Any Test FAILS:**
1. ❌ Document the failure
2. 🔧 Fix the issue
3. 🔄 Re-run the failed test
4. ✅ Proceed only when all tests pass

---

**Created by**: Kiro AI  
**Date**: 2026-04-27  
**Status**: READY FOR EXECUTION
