# Migration Plan: Ledger-Based GL Architecture

**Decision**: Implement **Option 1 — Ledger-Based GL** to match production reality.

**Status**: Ready for execution
**Risk Level**: LOW ✅
**Estimated Time**: 2-3 hours (safe batches)
**Reversibility**: 100% safe (DROP columns if needed)

---

## Phase 1: Schema Changes (30 minutes)

### Step 1.1: Add Source Tracking Columns
```sql
-- Add columns to track GL source in journal_entry_lines
ALTER TABLE journal_entry_lines 
ADD COLUMN source_ledger TEXT CHECK (source_ledger IN ('cash', 'supplier', 'inventory', 'manual', 'adjustment', 'harvest'));

ALTER TABLE journal_entry_lines 
ADD COLUMN source_record_id INTEGER;

-- Optional: index for fast lookups
CREATE INDEX idx_journal_entry_lines_source ON journal_entry_lines(source_ledger, source_record_id);
```

### Step 1.2: Verify Schema
```sql
PRAGMA table_info(journal_entry_lines);
-- Should show new columns: source_ledger, source_record_id
```

---

## Phase 2: Backfill Source Tracking (1 hour)

### Step 2.1: Link GL Lines to Cash Transactions
```sql
-- Strategy: Match by amount, date, and cash account code

-- First, get the cash account codes from posting_rules or chart_of_accounts
SELECT account_code FROM chart_of_accounts 
WHERE account_type = 'Asset' AND account_name LIKE '%نقد%' OR account_name LIKE '%Cash%'
LIMIT 5;

-- Assume we find: ['1010', '1020'] are cash/bank accounts

-- Match cash_transactions to journal_entry_lines by date + amount
UPDATE journal_entry_lines jel
SET source_ledger = 'cash', source_record_id = ct.id
FROM (
  SELECT ct.id, ct.transaction_date, ct.amount 
  FROM cash_transactions ct
) ct
WHERE jel.account_code IN ('1010', '1020')  -- cash/bank accounts
  AND DATE(jel.created_at) = DATE(ct.transaction_date)
  AND (jel.debit = ct.amount OR jel.credit = ct.amount)
  AND jel.source_ledger IS NULL;
```

**Expected Result**: ~69 lines linked (1 per cash transaction)

### Step 2.2: Link GL Lines to Supplier Transactions
```sql
-- Strategy: Match by supplier code + amount + date

UPDATE journal_entry_lines jel
SET source_ledger = 'supplier', source_record_id = st.id
FROM (
  SELECT st.id, st.supplier_code, st.transaction_date, st.amount
  FROM supplier_transactions st
) st
WHERE jel.account_code IN (
  SELECT account_code FROM posting_rules 
  WHERE rule_slot = 'accounts_payable'
)  -- A/P accounts
  AND DATE(jel.created_at) = DATE(st.transaction_date)
  AND jel.source_ledger IS NULL;
```

**Expected Result**: ~274 lines linked (1-2 per supplier transaction)

### Step 2.3: Link GL Lines to Inventory Movements
```sql
-- Strategy: Match by item + warehouse + date + value

UPDATE journal_entry_lines jel
SET source_ledger = 'inventory', source_record_id = im.id
FROM (
  SELECT im.id, im.item_code, im.warehouse, im.movement_date, im.value
  FROM inventory_movements im
) im
WHERE jel.account_code IN (
  SELECT account_code FROM posting_rules
  WHERE rule_slot IN ('inventory', 'cogs')
)
  AND DATE(jel.created_at) = DATE(im.movement_date)
  AND jel.source_ledger IS NULL;
```

**Expected Result**: ~654 lines linked (1 per inventory movement)

### Step 2.4: Mark Remaining as Manual
```sql
UPDATE journal_entry_lines
SET source_ledger = 'manual'
WHERE source_ledger IS NULL;

-- Verify count
SELECT COUNT(*) as orphan_count FROM journal_entry_lines WHERE source_record_id IS NULL AND source_ledger = 'manual';
```

---

## Phase 3: Verify Backfill (30 minutes)

### Step 3.1: Check Link Completeness
```sql
SELECT 
  source_ledger, 
  COUNT(*) as line_count,
  COUNT(DISTINCT source_record_id) as unique_sources
FROM journal_entry_lines
GROUP BY source_ledger
ORDER BY line_count DESC;

-- Expected output:
-- cash       | 69   | 69
-- supplier   | 274  | 137
-- inventory  | 654  | 654
-- manual     | 851  | 0
```

### Step 3.2: Verify Balances Match
```sql
-- Cash: Compare running balance from cash_transactions vs GL cash account
SELECT 
  'cash_transactions' as source,
  MAX(running_balance) as operational_balance
FROM cash_transactions
UNION ALL
SELECT 
  'GL cash account' as source,
  ROUND(SUM(debit - credit), 2) as gl_balance
FROM journal_entry_lines
WHERE source_ledger = 'cash' OR account_code = '1010';  -- Adjust account code

-- Should show same balance
```

### Step 3.3: Verify Supplier Balances
```sql
-- Supplier: Compare running balance from supplier_transactions vs GL A/P
SELECT 
  'supplier_transactions' as source,
  ROUND(SUM(balance_with_checks), 2) as operational_balance
FROM supplier_transactions
UNION ALL
SELECT 
  'GL A/P account' as source,
  ROUND(SUM(credit - debit), 2) as gl_balance
FROM journal_entry_lines
WHERE source_ledger = 'supplier' OR account_code IN (
  SELECT account_code FROM posting_rules WHERE rule_slot = 'accounts_payable'
);

-- Should show same balance
```

### Step 3.4: Verify Inventory Balances
```sql
-- Inventory: Compare running balance from inventory_movements vs GL inventory
SELECT 
  'inventory_movements' as source,
  ROUND(SUM(balance_value), 2) as operational_balance
FROM inventory_movements
UNION ALL
SELECT 
  'GL inventory account' as source,
  ROUND(SUM(debit - credit), 2) as gl_balance
FROM journal_entry_lines
WHERE source_ledger = 'inventory' OR account_code IN (
  SELECT account_code FROM posting_rules WHERE rule_slot = 'inventory'
);

-- Should show same balance
```

---

## Phase 4: Update Posting Logic (1 hour)

### Step 4.1: Modify `finance_core.ts`

Update the posting functions to include source tracking:

```typescript
// src/lib/finance_core.ts

interface PostingOptions {
  // ... existing fields ...
  source_ledger?: 'cash' | 'supplier' | 'inventory' | 'manual' | 'adjustment' | 'harvest'
  source_record_id?: number
}

// When posting inventory movement:
export async function postInventoryMovement(c: Context, inventoryMovement: InventoryMovement) {
  const lines: JournalLine[] = [
    {
      account_code: invAcc,
      debit: value,
      credit: 0,
      source_ledger: 'inventory',
      source_record_id: inventoryMovement.id,  // NEW: Link back to inventory_movements
    },
    {
      account_code: apAcc,
      debit: 0,
      credit: value,
      source_ledger: 'inventory',  // NEW
      source_record_id: inventoryMovement.id,  // NEW
    },
  ]
  
  return postFromBusinessEvent(c, {
    event_type: 'inventory_movement',
    lines,
    source_id: inventoryMovement.id,
    source_module: 'inventory',
  })
}

// When posting cash transaction:
export async function postCashMovement(c: Context, cashTx: CashTransaction) {
  const lines: JournalLine[] = [
    {
      account_code: cashAcc,
      debit: cashTx.amount,
      credit: 0,
      source_ledger: 'cash',
      source_record_id: cashTx.id,  // NEW: Link back to cash_transactions
    },
    {
      account_code: counterAcc,
      debit: 0,
      credit: cashTx.amount,
      source_ledger: 'cash',  // NEW
      source_record_id: cashTx.id,  // NEW
    },
  ]
  
  return postFromBusinessEvent(c, {
    event_type: 'cash_movement',
    lines,
    source_id: cashTx.id,
    source_module: 'cash',
  })
}
```

### Step 4.2: Modify Journal Entry Creation

```typescript
// src/lib/finance_core.ts or src/lib/posting_engine.ts

export function createJournalEntryLine(
  accountCode: string,
  debit: number,
  credit: number,
  description?: string,
  source_ledger?: string,
  source_record_id?: number
): JournalEntryLineInsert {
  return {
    account_code: accountCode,
    debit,
    credit,
    description: description || '',
    source_ledger: source_ledger || 'manual',
    source_record_id: source_record_id || null,
    created_at: new Date().toISOString(),
  }
}
```

---

## Phase 5: Deprecate business_events (Optional, 30 minutes)

**Note**: Don't delete `business_events` — just don't require it for new postings.

### Step 5.1: Document as Legacy
```sql
-- Add comment to business_events table
-- This table is reserved for future event sourcing
-- Current posting uses ledger-based GL with source_ledger tracking
```

### Step 5.2: Update API Documentation
```typescript
// src/api/gl.ts

/**
 * POST /gl/entries
 * 
 * Create a manual journal entry.
 * 
 * Source tracking:
 * - All entries are tracked to their source (operational ledger or manual)
 * - source_ledger IN ['cash', 'supplier', 'inventory', 'manual', 'adjustment']
 * - source_record_id links to source table (cash_transactions, supplier_transactions, etc.)
 * 
 * No business_events required. GL is ledger-based, not event-sourced.
 */
```

---

## Execution Checklist

### Pre-Migration
- [ ] Backup database (Cloudflare D1 automatic backups)
- [ ] Notify team: "GL schema migration starting"
- [ ] Read this plan end-to-end once more

### Phase 1: Schema (Do Now)
- [ ] Execute Step 1.1 (add columns)
- [ ] Execute Step 1.2 (verify schema)
- [ ] Commit migration: `0053_gl_source_tracking.sql`

### Phase 2: Backfill (Do Now)
- [ ] Execute Step 2.1 (link cash)
- [ ] Execute Step 2.2 (link suppliers)
- [ ] Execute Step 2.3 (link inventory)
- [ ] Execute Step 2.4 (mark remaining as manual)
- [ ] Commit migration: `0054_gl_backfill_source_tracking.sql`

### Phase 3: Verify (Do Now)
- [ ] Run Step 3.1–3.4 (verify all checks pass)
- [ ] If mismatches found: investigate and adjust
- [ ] Log results in `GL_SOURCE_TRACKING_RESULTS.txt`

### Phase 4: Code Changes (Do After Verification)
- [ ] Update `finance_core.ts` (add source_ledger param)
- [ ] Update `posting_engine.ts` (if using this pattern)
- [ ] Test: Post new inventory movement, verify source_ledger is set
- [ ] Test: Post new cash transaction, verify source_ledger is set
- [ ] Commit code: `chore: add GL source ledger tracking`

### Phase 5: Documentation (Do Last)
- [ ] Update API docs (source tracking info)
- [ ] Update `FINANCE_CORE_CLEAN_STATE.md` with new schema
- [ ] Deprecate `business_events` (don't delete, just document as legacy)

---

## Rollback Plan (If Issues)

If verification fails at any step:

```sql
-- Drop new columns (reverts schema)
ALTER TABLE journal_entry_lines DROP COLUMN source_ledger;
ALTER TABLE journal_entry_lines DROP COLUMN source_record_id;
DROP INDEX idx_journal_entry_lines_source;
```

GL will continue to work without source tracking. No data loss.

---

## Success Criteria

✅ **Phase 1**: Schema adds without errors  
✅ **Phase 2**: All backfill queries complete  
✅ **Phase 3**: All verification queries show matches  
✅ **Phase 4**: New postings include source_ledger  
✅ **Phase 5**: Documentation updated  

**Result**: Production GL is now auditable, traceable, and matches operational ledgers.

