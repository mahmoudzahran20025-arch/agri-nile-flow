# Executive Summary: GL Architecture Fix

## The Problem

**Production GL is orphaned from its sources.**

```
CURRENT STATE (BROKEN):
✅ cash_transactions (69 rows) → running balance exists
✅ supplier_transactions (274 rows) → running balance exists
✅ inventory_movements (654 rows) → running balance exists
❌ business_events (0 rows) → EMPTY, not linked to anything
❌ journal_entry_lines (1,848 rows) → GL entries exist but NO AUDIT TRAIL back to source
```

**Impact**:
- ❌ Cannot answer: "Which supplier transaction created this GL entry?"
- ❌ Cannot audit: "What caused this GL balance change?"
- ❌ Cannot reconcile: "Does GL match operational ledger?"
- ❌ Cannot trace: "Why is this account imbalanced?"

---

## Root Cause

The **Excel data was imported before the event-sourcing architecture was built**.

Timeline:
1. ✅ Excel files imported → operational tables created (2025-04)
2. ✅ GL code written → assumes event-sourced architecture (2026-02)
3. ❌ **Gap**: Operational data never converted to events
4. ❌ **Gap**: GL entries created independently, not linked to sources
5. ❌ Result: **Orphaned GL with no audit trail**

---

## The Solution

### Architecture Decision: **Ledger-Based GL** (Not Event-Sourced)

**Accept reality**: The operational ledgers ARE the source of truth.

```
INTENDED (Event-Sourced):
business_event → journal_entry ← GL source

REALITY (Ledger-Based):
cash_transactions → journal_entry_lines (with source_ledger='cash', source_record_id=69)
supplier_transactions → journal_entry_lines (with source_ledger='supplier', source_record_id=st.id)
inventory_movements → journal_entry_lines (with source_ledger='inventory', source_record_id=im.id)
```

**Benefits**:
- ✅ Matches how business actually runs (Excel + running balances)
- ✅ Minimal code disruption (add 2 columns, link them)
- ✅ Clear audit trail (direct GL-to-source link)
- ✅ Safe migration (additive schema, no deletions)
- ✅ 100% reversible (if needed)

---

## Implementation (3 Phases, 2-3 Hours)

### Phase 1: Schema Changes (30 min)
```sql
-- Add source tracking to journal_entry_lines
ALTER TABLE journal_entry_lines
ADD COLUMN source_ledger TEXT CHECK (source_ledger IN ('cash', 'supplier', 'inventory', 'manual', 'adjustment', 'harvest'));

ALTER TABLE journal_entry_lines
ADD COLUMN source_record_id INTEGER;

-- Create index for fast lookups
CREATE INDEX idx_journal_entry_lines_source ON journal_entry_lines(source_ledger, source_record_id);
```

### Phase 2: Backfill Historical Data (1 hour)
```sql
-- Match GL entries to their sources by date + amount
UPDATE journal_entry_lines 
SET source_ledger='cash', source_record_id=ct.id 
WHERE ... (match by amount + date to cash_transactions)

UPDATE journal_entry_lines 
SET source_ledger='supplier', source_record_id=st.id 
WHERE ... (match by amount + date to supplier_transactions)

UPDATE journal_entry_lines 
SET source_ledger='inventory', source_record_id=im.id 
WHERE ... (match by amount + date to inventory_movements)

-- Mark remaining as manual
UPDATE journal_entry_lines SET source_ledger='manual' WHERE source_ledger IS NULL;
```

### Phase 3: Verify (30 min)
```sql
-- Check link completeness
SELECT source_ledger, COUNT(*) as count FROM journal_entry_lines GROUP BY source_ledger;
-- Expected: cash(69) + supplier(274) + inventory(654) + manual(851) = 1,848 total

-- Verify balances match
-- Confirm running balances from operational tables = GL account balances
SELECT SUM(balance) FROM cash_transactions = SELECT SUM(debit-credit) FROM journal_entry_lines WHERE source_ledger='cash'
-- (similar for suppliers and inventory)
```

---

## Code Changes (After Verification)

### Update `finance_core.ts`
```typescript
// When posting new transactions, include source tracking:

export async function postInventoryMovement(
  c: Context,
  inventoryMovement: InventoryMovement
) {
  const lines: JournalLine[] = [
    {
      account_code: invAcc,
      debit: value,
      credit: 0,
      source_ledger: 'inventory',      // NEW: Track source
      source_record_id: inventoryMovement.id,  // NEW: Link to source
    },
    // ...
  ]
  return postFromBusinessEvent(c, { lines, ... })
}

// Same for postCashMovement() and postSupplierInvoice()
```

---

## Migration Files

Two new migrations added:

1. **`0053_gl_source_tracking_schema.sql`** — Add columns, create index
2. **`0054_gl_backfill_source_tracking.sql`** — Link historical data

Both are safe, additive, fully reversible.

---

## Risk Assessment

| Aspect | Risk | Mitigation |
|--------|------|-----------|
| **Schema Changes** | LOW | Additive only, no deletions |
| **Backfill Logic** | LOW | Match by date + amount, clear logic |
| **Verification** | LOW | 4-step verification before code changes |
| **Rollback** | LOW | DROP columns reverts all changes |
| **Production Impact** | NONE | No changes until after verification |

---

## Success Criteria

After migration, all three criteria must pass:

✅ **Structural**: All journal_entry_lines have source_ledger + source_record_id (or source_ledger='manual')

✅ **Balances**: GL account balances match operational ledger running balances
- `SELECT SUM(balance_value) FROM inventory_movements` = GL inventory account balance
- `SELECT SUM(balance_with_checks) FROM supplier_transactions` = GL A/P balance
- `SELECT MAX(running_balance) FROM cash_transactions` = GL cash balance

✅ **Auditability**: Can trace any GL entry back to its source
```sql
SELECT jel.*, ct.* FROM journal_entry_lines jel
JOIN cash_transactions ct ON ct.id = jel.source_record_id
WHERE jel.source_ledger = 'cash';
-- Returns matched GL entry + its source cash transaction
```

---

## Timeline

- **Now**: Review this plan ✓
- **Hour 1**: Execute Phase 1 + 2 migrations (schema + backfill)
- **Hour 2**: Execute Phase 3 verification queries
- **Hour 3**: Update code (finance_core.ts) + test new postings
- **Done**: Commit migrations + code changes, deploy

---

## FAQ

**Q: Why not use event-sourced architecture as originally planned?**  
A: Excel data proves ledger-based model works. Less disruption, better performance, clearer semantics. Can always add event sourcing later if needed.

**Q: Will this break existing functionality?**  
A: No. Columns are optional (source_ledger defaults to 'manual'). GL continues to work with or without source tracking.

**Q: Can we rollback if something breaks?**  
A: Yes. `DROP COLUMN source_ledger; DROP COLUMN source_record_id;` reverts everything.

**Q: Do we need to keep business_events table?**  
A: No, but don't delete it yet. Mark as deprecated. Future event sourcing can use it if needed.

**Q: What about new postings? Will they automatically have source tracking?**  
A: Yes, if we update the posting code. Source_ledger will be set when the posting function creates the GL line.

---

## Next Steps

1. **Read**: Full documents:
   - `REAL_BUSINESS_FLOW_ANALYSIS.md` (Why this architecture)
   - `MIGRATION_PLAN_LEDGER_BASED.md` (How to execute)
   - `migrations/0053_*.sql` + `0054_*.sql` (SQL to run)

2. **Decide**: Approve this approach ✓

3. **Execute**: Run migrations in safe batches with approval gates

4. **Verify**: All verification queries pass

5. **Deploy**: Code changes + new posting logic

---

## Decision Required

**Approve this Ledger-Based GL architecture fix? YES / NO**

If YES → Proceed to Phase 1 execution
If NO → Discuss alternative approaches

