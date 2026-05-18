# Real Business Flow Analysis — From Excel Data to GL

## CRITICAL DISCOVERY: The Gap Between Code and Reality

### What the Code Assumes (Event-Sourced Architecture)
```
    Business Event (event source) 
         ↓
    business_events table (immutable record)
         ↓
    Journal Entry (GL posting record)
         ↓
    journal_entry_lines (GL detail, balanced)
```

### What Actually Exists in Production Database
```
    Excel Raw Data (historical, pre-computed balances)
         ↓
    inventory_movements table (654 rows) — **Source of Truth for inventory state**
    supplier_transactions table (274 rows) — **Source of Truth for supplier balances**
    cash_transactions table (69 rows) — **Source of Truth for cash balance**
         ↓ [BROKEN LINK — No business_events linking]
         ↓
    journal_entry_lines table (1,848 lines, balanced) — **GL detail with no audit trail**
         ↓ [ORPHANED — No source_event_id pointing back]
```

---

## The Real Business Flow (From Excel Analysis)

### Treasury/Cash Transactions (خزينة)
**Source**: `خزينة نواة المستقبل 2025-2026.xlsx` → Sheet `البيان`

**Actual Structure** (from row 10 sample):
```javascript
{
  transaction_date: 45985,  // Excel serial → 2026-01-15
  status: "م",  // صرف = money out
  document_number: 83003,
  recipient_name: "عمرو السمالوسي",  // Recipient
  narration: "عمرو السمالوسي/دفعة من حساب الميكنة",  // Description
  season_service: null,
  notes: "مستخلص اعمال رقم(2)",
  supplier_code: 20100033,  // May be linked to supplier invoice
  center_code: null,  // Cost center
  debit: 18000,  // Money in (استلام)
  credit: 0,  // Money out (صرف)
  running_balance: 9981130,  // **RUNNING BALANCE — pre-computed**
  
  // ** Key Point **: Balance is ALREADY CALCULATED in Excel
  // This is a copy of real business cash book
}
```

**Business Logic**:
- Transactions are **chronologically ordered**
- Each transaction has a **running balance** (computed in Excel)
- If the transaction is a **payment to supplier** (supplier_code present), it also posts to:
  - Debit: Cash account
  - Credit: Accounts Payable (supplier account)
- If the transaction is a **pure cash in/out** (no supplier), it posts to:
  - Debit: Cash
  - Credit: Revenue (money in) OR Expense (money out)

---

### Supplier Transactions (الموردين والعملاء)
**Source**: `الموردين والعملاء نواة المستقبل2025-2026.xlsx` → Sheet `البيان`

**Structure**: (274 rows from Excel import)
```javascript
{
  transaction_date: 45985,  // Excel serial
  supplier_code: 20100033,  // FK to suppliers
  transaction_type: "invoice",  // or "payment"
  document_number: "INV-001",
  amount: 50000,  // Invoice amount OR payment amount
  narration: "فاتورة شراء أسمدة",  // Description
  
  // **RUNNING BALANCE** — accumulated balance per supplier
  balance_with_checks: 150000,  // Payable balance
  balance_no_checks: 150000,  // Alternative balance calc
  
  // Posting Logic:
  // IF invoice:
  //   Debit: Inventory (or Expense)
  //   Credit: Accounts Payable
  // IF payment:
  //   Debit: Accounts Payable
  //   Credit: Cash
}
```

---

### Inventory Movements (مخازن)
**Source**: `مخازن نواة المستقبل2025-2026.xlsx` → Sheet `البيانات`

**Structure**: (700 rows from Excel)
```javascript
{
  movement_date: 45985,
  item_code: 1010189,  // FK to items
  warehouse: "اسمدة",  // Warehouse name
  movement_type: "اضافة",  // or "صرف" (add or withdraw)
  quantity: 100,
  unit_price: 50,
  value: 5000,  // quantity × unit_price
  
  // **RUNNING BALANCE** — per item per warehouse
  balance_qty: 250,  // Current quantity in warehouse
  balance_value: 12500,  // Current value (qty × unit_price)
  
  // Posting Logic:
  // IF add (اضافة):
  //   Debit: Inventory account
  //   Credit: Accounts Payable (if from supplier) OR Expense (if adjustment)
  // IF withdraw (صرف):
  //   Debit: Cost of Goods Sold / Expense
  //   Credit: Inventory account
}
```

---

## The Real Architecture (Not Event-Sourced, But Ledger-Based)

### Three Parallel Running Ledgers
Each table maintains a **running balance** that is the source of truth:

1. **`cash_transactions`** → Cash running balance (SUM = GL cash account balance)
2. **`supplier_transactions`** → Supplier payables (SUM = GL accounts payable balance)
3. **`inventory_movements`** → Inventory stock balances (SUM = GL inventory account balance)

### GL is a Derivative, Not a Source
The `journal_entry_lines` table is **derived from** these three ledgers, not a separate source:

```
Real World Transactions
    ↓
Excel Workbooks (manual entry + calculations)
    ↓
Three Operational Ledgers
  • cash_transactions (running_balance)
  • supplier_transactions (balance_with_checks)
  • inventory_movements (balance_qty, balance_value)
    ↓
GL Journal Entries (for reporting / compliance)
  • journal_entry_lines (debit/credit postings)
```

---

## Why `business_events` is Empty

The Excel data was imported **before business_events table existed**. The import flow was:

```
Excel → D1 (via migrate/import.js)
  ├─ ✅ Suppliers table (10 rows)
  ├─ ✅ Items table (61 rows)
  ├─ ✅ Inventory movements (700 rows) + running balances
  ├─ ✅ Supplier transactions (313 rows) + running balances
  ├─ ✅ Cash transactions (69 rows) + running balance
  └─ ❌ NO business_events created
```

Later, GL code was added expecting `business_events → journal_entries`, but:
- The operational data (cash, suppliers, inventory) was **never converted** to events
- The GL entries were created **independently**, not linked to events
- Result: **Orphaned GL with no audit trail back to source**

---

## The Correct Fix: Matching Code to Reality

### Option 1: "Ledger-Based GL" (Honest to Reality)
**Adapt the code to match the real architecture:**

1. **Keep the three operational ledgers as-is** (they ARE the source of truth)
2. **GL remains derivative** but **linked to source**:
   ```sql
   -- journal_entry_lines should have:
   ADD COLUMN source_ledger TEXT  -- 'cash' | 'supplier' | 'inventory'
   ADD COLUMN source_record_id INTEGER  -- FK to cash_transactions, supplier_transactions, or inventory_movements
   ```

3. **Posting logic**: When importing new transactions:
   ```
   INSERT INTO cash_transactions (...)
   INSERT INTO journal_entry_lines (source_ledger='cash', source_record_id=cash_tx.id, ...)
   ```

4. **No business_events needed** — the operational tables ARE the events.

### Option 2: "Event-Sourced GL" (Theoretical Purity)
**Refactor to match intended architecture:**

1. **Create business_events for all historical data**:
   ```sql
   -- For each cash_transaction:
   INSERT INTO business_events (source_module='cash', source_id=ct.id, event_type='cash_transaction', ...)
   
   -- For each supplier_transaction:
   INSERT INTO business_events (source_module='supplier', source_id=st.id, event_type='supplier_transaction', ...)
   
   -- For each inventory_movement:
   INSERT INTO business_events (source_module='inventory', source_id=im.id, event_type='inventory_movement', ...)
   ```

2. **Link journal_entries to business_events**:
   ```sql
   UPDATE journal_entries SET business_event_id = (
     SELECT be.id FROM business_events be 
     WHERE be.source_id = journal_entries.ref_id AND be.source_module = journal_entries.source_module
   )
   ```

3. **Going forward**: All posts must go through business_events

---

## Recommendation for Production

### **Choose Option 1: Ledger-Based GL** (70% less risk)

**Reasoning**:
1. **Excel data already has running balances** — proves ledger-based model works
2. **Less disruption** — don't refactor working code
3. **Clearer semantics** — operational tables stay operational, GL stays reporting
4. **Easier audit trail** — direct link from GL line to source transaction (cash/supplier/inventory)
5. **Better performance** — no need to recompute balances from events

**Implementation**:
```sql
-- Step 1: Add source tracking to journal_entry_lines
ALTER TABLE journal_entry_lines 
ADD COLUMN source_ledger TEXT CHECK (source_ledger IN ('cash', 'supplier', 'inventory', 'manual', 'adjustment'));
ALTER TABLE journal_entry_lines 
ADD COLUMN source_record_id INTEGER;

-- Step 2: Backfill existing entries (best guess based on account type)
UPDATE journal_entry_lines 
SET source_ledger = 'cash'
WHERE account_code IN (SELECT account_code FROM chart_of_accounts WHERE account_type = 'Asset' AND account_name LIKE '%نقد%');

-- Step 3: New posting logic (in finance_core.ts)
// When posting inventory movement:
const je = createJournalEntry(...)
const line = createJournalEntryLine(..., source_ledger: 'inventory', source_record_id: im.id)
```

---

## Final Implementation Plan

### Phase 1: Backfill Source Tracking (Safe)
1. Add `source_ledger` + `source_record_id` columns to `journal_entry_lines`
2. Backfill by matching amounts and dates to source transactions
3. Document any mismatches

### Phase 2: Fix Future Posting (Prevention)
1. Modify posting logic in `finance_core.ts` to always include source tracking
2. Update `resolveX()` functions to return source_ledger + source_record_id
3. Validate that every GL line has a source

### Phase 3: Audit & QA (Validation)
1. Verify no orphan GL lines without sources
2. Verify running balances match GL account balances
3. Test new posting flows (inventory, supplier, cash)

---

## Risk Assessment

**Option 1 (Ledger-Based) Risk**: LOW ✅
- Minimal schema changes
- No data deletion or transformation
- Can be rolled back
- Matches reality

**Option 2 (Event-Sourced) Risk**: MEDIUM ⚠️
- Large data transformation
- Need to create 1,000+ business_events
- Risk of mismatching events to GL lines
- Refactor working code

**Recommendation**: **Option 1 (Ledger-Based)** → Ship fast, audit later.

