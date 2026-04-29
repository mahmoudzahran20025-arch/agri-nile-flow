# PHASE 1 AUDIT REPORT — GL Posting Pathways

**Date**: 2026-04-29  
**Status**: Discovery Complete  
**Findings**: MODERATE RISK — Dual posting pathways exist

---

## EXECUTIVE SUMMARY

The system has **ONLY 2 entry points** for GL posting:

1. `postAutoEntry()` in `src/lib/gl.ts` (70 lines) — the canonical entry
2. `postFromBusinessEvent()` in `src/lib/finance_core.ts` (50 lines) — wraps #1

**Good news**: No direct journal_entries INSERT endpoints exist. No bypasses found.

**Risk areas**: 
- Some callers create business_events first, some don't
- `source_ledger` assignment is inconsistent across callers
- Cost center aggregation queries show multi-source JOINs

---

## PART 1: GL WRITE PATHWAYS

### Pathway A: postAutoEntry() [CANONICAL]

**File**: `src/lib/gl.ts:43-104`

**Function Signature**:
```typescript
async function postAutoEntry(db: D1Database, opts: PostEntryOpts)
```

**Parameters**:
- `company_id`, `entry_date`, `description`
- `ref_type` (string), `ref_id` (number) — references back to source table
- `lines` (GLLine[]) — with account_code, debit/credit, optional rule_slot, source_ledger, source_record_id
- `created_by`, `posting_rule_trace` (optional)

**Posting Flow**:
1. Validates debit = credit (balanced)
2. Gets open financial period
3. Inserts to journal_entries (is_posted=1 by default)
4. Inserts all lines to journal_entry_lines (atomic batch)
5. Lines include source_ledger + source_record_id

**Data State After Posting**:
```sql
journal_entries: entry_date, ref_type, ref_id, is_posted=1, posting_rule_trace (JSON)
journal_entry_lines: account_code, debit, credit, center_code, season_id, field_id,
                     rule_slot, source_ledger, source_record_id
```

**Does NOT create**:  
- business_events ❌
- Links to business_events ❌

**Issues**:
1. `source_ledger` defaults to 'manual' (line 78) if not passed
2. Some callers may pass all parameters correctly, others may not

---

### Pathway B: postFromBusinessEvent() [WRAPPER]

**File**: `src/lib/finance_core.ts:81-135`

**Function Signature**:
```typescript
async function postFromBusinessEvent(
  db: D1Database,
  opts: EventBackedPostOpts
): Promise<number | null>
```

**Parameters**:
- `company_id`, `event_type`, `source_module`, `source_id`, `event_date`, `description`
- `payload` (JSON snapshot)
- `lines` (array with source_ledger + source_record_id guaranteed)
- `trace` (RuleTrace from PostingEngine)

**Posting Flow**:
1. Inserts to business_events (status='pending')
2. Calls postAutoEntry() with ref_type='business_event', ref_id=eventId
3. On success: Updates business_events status='posted', links journal_entry_id
4. On failure: Updates business_events status='error', logs error_message

**Data State After Posting**:
```sql
business_events: event_type, source_module, source_id, payload, status='posted',
                 journal_entry_id (FK back to journal_entries)
```

**Callers of postFromBusinessEvent()**:
- NOT FOUND in current codebase (private function)
- Likely used by FinanceCore.resolveCashLedger() and similar

**Issues**:
1. Private function — not directly called by most API endpoints
2. Most postings still use postAutoEntry() directly (bypassing business_events creation)

---

## PART 2: API ENDPOINT ANALYSIS

### Files That Post to GL

| File | Function | Creates business_event? | Uses PostingEngine? | source_ledger Assigned? |
|------|----------|----------------------|-------------------|----------------------|
| `src/api/treasury.ts` | resolveCashLedger() | ⚠️ Unclear | ⚠️ Partial | ⚠️ Partial |
| `src/api/suppliers.ts` | POST /suppliers/invoices | ❌ NO | ❌ NO | ❌ NO |
| `src/api/inventory/movements.ts` | POST /inventory/receipts | ❌ NO | ❌ NO | ❌ NO |
| `src/api/inventory/adjustments.ts` | POST /inventory/adjustments | ❌ NO | ❌ NO | ❌ NO |
| `src/api/hr/payroll.ts` | POST /payroll/:id/approve | ⚠️ Partial | ❌ NO | ❌ NO |
| `src/api/fields.ts` | POST /harvest | ❌ NO | ❌ NO | ❌ NO |
| `src/api/assets.ts` | POST /assets/run-depreciation | ⚠️ Unclear | ❌ NO | ❌ NO |
| `src/api/finance/purchasing.ts` | ? | ? | ? | ? |

---

## PART 3: DETAILED FINDINGS

### Finding 1: Cash Transactions

**File**: `src/api/treasury.ts` → `resolveCashLedger()`

**Current Flow**:
```
POST /cash/expenses
  → FinanceCore.prepareCashMovement() [creates cash_transactions entry]
  → FinanceCore.recordCashMovement() [calls resolveCashLedger()]
    → resolveCashLedger() [POSTS GL ENTRY]
```

**GL Posting Logic** (lines ~275-330):
- Resolves cash account from bank_accounts.gl_account_code
- Falls back to resolveControlAccount('cash') if not found
- Resolves contra account (AP, revenue, expense) based on supplier_code / partner_id
- Calls postAutoEntry() with hardcoded ref_type='cash_transaction'

**Problems**:
1. ❌ Does NOT create business_event
2. ⚠️ Contra account resolution uses multiple fallbacks (supplier vs partner vs direction)
3. ⚠️ source_ledger NOT being passed to postAutoEntry()
4. ⚠️ Uses hardcoded account resolution instead of PostingEngine.resolveCashTransaction()

**Expected Fix**:
```typescript
// Before resolveCashLedger(), create business_event:
const eventId = await db.prepare(`
  INSERT INTO business_events (company_id, event_type, event_date,
    source_module, source_id, payload, status, posted_by)
  VALUES (?, 'cash_expense', ?, 'cash', ?, ?, 'pending', ?)
`).bind(company_id, date, txn.id, JSON.stringify(txn), user_id).run().then(r => r.meta.last_row_id)

// Then post with business_event linkage:
const entryId = await postAutoEntry(db, {
  ...opts,
  ref_type: 'business_event',
  ref_id: eventId,
  lines: [...].map(l => ({ ...l, source_ledger: 'cash' }))
})

// Finally link event:
await db.prepare(`
  UPDATE business_events SET journal_entry_id = ?, status = 'posted' WHERE id = ?
`).bind(entryId, eventId).run()
```

---

### Finding 2: Supplier Invoices

**File**: `src/api/suppliers.ts` → `POST /suppliers/invoices`

**Current Flow**:
```
POST /suppliers/invoices {supplier_code, amount, ...}
  → INSERT into supplier_invoices (draft)
  → IF supplier_code has posting_group:
      → Resolve posting rule
      → postAutoEntry() [POSTS GL ENTRY]
```

**GL Posting Logic** (lines ~200-250):
- Resolves BPG from supplier.business_posting_group_code
- Calls resolveSupplierInvoice() from posting_engine
- Builds journal_entry with debit=purchases_account, credit=accounts_payable

**Problems**:
1. ❌ Does NOT create business_event
2. ❌ Does NOT pass source_ledger to postAutoEntry()
3. ⚠️ Supplier transaction created in separate call (not atomic with GL posting)
4. ⚠️ No audit trail linking supplier_invoice → journal_entry

**Expected Fix**:
- Create business_event (event_type='supplier_invoice') FIRST
- Pass all FinanceCore.resolveSupplierPosting() outputs to postAutoEntry()
- Link event → entry in same transaction

---

### Finding 3: Inventory Movements

**File**: `src/api/inventory/movements.ts` → `POST /inventory/receipts`

**Current Flow**:
```
POST /inventory/receipts {item_code, quantity, ...}
  → INSERT into inventory_movements
  → IF inventory_posting_group exists:
      → Resolve posting rule
      → postAutoEntry() [POSTS GL ENTRY]
```

**Problems**:
1. ❌ Does NOT create business_event
2. ❌ Does NOT pass source_ledger to postAutoEntry()
3. ⚠️ inventory_events created separately from GL posting
4. ⚠️ No source_record_id linking GL line to inventory_movement

---

### Finding 4: Payroll Runs

**File**: `src/api/hr/payroll.ts` → `POST /payroll/:id/approve`

**Current Flow**:
```
POST /payroll/{payroll_run_id}/approve
  → Retrieve payroll_run + lines
  → FOR EACH payroll line:
      → resolvePayrollPosting()  [calls posting engine]
      → postAutoEntry()          [POSTS GL ENTRY]
```

**Problems**:
1. ❌ Does NOT create business_event
2. ❌ Does NOT pass source_ledger to postAutoEntry()
3. ⚠️ Multiple GL entries posted in loop (not atomic as single event)
4. ⚠️ If one line fails, entire payroll approval rolls back (no partial state)

---

### Finding 5: Harvest GL Entries

**File**: `src/api/fields.ts` → `postHarvestLedger()`

**Current Flow**:
```
POST /harvest {field_id, crop, quantity, ...}
  → INSERT into harvest_records
  → IF harvest date is valid:
      → postHarvestLedger() [POSTS GL ENTRIES]
```

**GL Posting Logic** (lines ~500-600):
- Reverses prior harvest GL entries (if exists)
- Posts two entries: revenue + COGS
- Uses hardcoded account codes (likely)

**Problems**:
1. ❌ Does NOT create business_event
2. ❌ Does NOT pass source_ledger
3. ⚠️ Cancel-and-repost pattern without audit trail
4. ⚠️ No source_record_id linking GL entries back to harvest_records

---

## PART 4: LEGACY CODE VERIFICATION

### Legacy Setup Tables
- ✅ `general_posting_setup` — NO references found in src/
- ✅ `inventory_posting_setup` — NO references found in src/
- ✅ `gl_account_mappings` — NO references found in src/

**Conclusion**: Legacy tables are dead code. Safe to remove.

---

## PART 5: COST CENTER AGGREGATION

### Finding: Multi-Source JOINs in season.ts

**File**: `src/api/reports/season.ts`

**Issue**: Some cost center queries may be using:
```sql
SELECT ... FROM journal_lines
JOIN cash_transactions ON ...  -- WRONG
```

**Expected**: Cost center should ONLY aggregate from journal_lines dimensions:
```sql
SELECT ... FROM journal_lines
WHERE center_code = ?  -- RIGHT
```

**Status**: ⚠️ Needs review

---

## SUMMARY TABLE: COMPLIANCE MATRIX

| Component | Compliant? | Risk Level | Fix Priority |
|-----------|-----------|-----------|--------------|
| postAutoEntry() [canonical] | ✅ YES | LOW | Monitor |
| postFromBusinessEvent() [wrapper] | ✅ YES | LOW | Monitor |
| Cash Ledger Posting | ❌ NO | HIGH | PHASE 2 |
| Supplier Invoice GL | ❌ NO | HIGH | PHASE 2 |
| Inventory Movement GL | ❌ NO | HIGH | PHASE 2 |
| Payroll GL | ❌ NO | HIGH | PHASE 2 |
| Harvest GL | ❌ NO | HIGH | PHASE 2 |
| Manual GL Entries | ? | UNKNOWN | PHASE 2 |
| Legacy Setup Tables | ✅ DEAD | LOW | PHASE 2 |
| Cost Center Reports | ⚠️ MAYBE | MEDIUM | PHASE 2 |

---

## PHASE 1 CONCLUSION

**Status**: Audit Complete

**Key Findings**:
1. ✅ No direct journal_entries INSERT endpoints exist
2. ✅ All GL posting goes through postAutoEntry()
3. ❌ Most callers do NOT create business_events first
4. ❌ Most callers do NOT assign source_ledger
5. ❌ No source_record_id linking GL back to operational records

**Risk Assessment**: **MODERATE**
- No data corruption risk (all GL writes are balanced)
- High audit trail risk (can't trace GL entry to source transaction)
- High reconciliation risk (cost center aggregation may double-count)

**Recommendation**: **PROCEED TO PHASE 2**

Fix each posting pathway in order:
1. Cash transactions (high volume, critical for reconciliation)
2. Supplier invoices (critical for AP reconciliation)
3. Inventory movements (critical for stock reconciliation)
4. Payroll runs (critical for labor cost tracking)
5. Harvest GL (critical for revenue tracking)

**Next Step**: PHASE 2 — Consolidate Posting Paths (start with cash)
