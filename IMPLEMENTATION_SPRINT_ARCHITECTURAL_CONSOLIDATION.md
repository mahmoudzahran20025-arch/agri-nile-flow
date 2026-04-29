# Implementation Sprint: Architectural Consolidation

**Objective**: Enforce the "Single Pipeline Law" from SYSTEM_ARCHITECTURE_REALITY_CHECK.md and eliminate all parallel GL posting paths.

**Status**: Planning Phase
**Date Started**: 2026-04-29
**Estimated Duration**: 5-7 days (full sprint)

---

## THE PROBLEM IN ONE SENTENCE

Multiple GL posting pathways exist in parallel (some through FinanceCore, some bypassing it), creating data inconsistency, incomplete audit trails, and cost center aggregation errors.

---

## PHASE 1: AUDIT & DISCOVERY (Day 1)

### Task 1.1: Complete Codebase Scan
Find every function/endpoint that writes to GL tables:

**Target Files to Scan**:
- `src/api/*.ts` — all REST endpoints
- `src/lib/*.ts` — all business logic libraries
- `src/middleware/*.ts` — any auth/guard middleware

**Search Terms**:
- `INSERT INTO journal_entries`
- `INSERT INTO journal_lines`
- `postAutoEntry`
- `postFromBusinessEvent`
- `FinanceCore.` (all FinanceCore calls)

**Output**: Document listing every GL write path with:
- File + function name
- Does it go through FinanceCore? (YES/NO)
- Does it create a business_event? (YES/NO)
- Does it run through PostingEngine? (YES/NO)
- Risk level: COMPLIANT / LEGACY / ORPHAN

### Task 1.2: Database Integrity Audit
Run these SQL queries to understand current state:

```sql
-- Q1: Orphaned journal entries (no source_event_id)
SELECT COUNT(*) AS orphaned_entries FROM journal_entries WHERE source_event_id IS NULL;

-- Q2: Posted business events with no linked journal entry
SELECT COUNT(*) AS orphaned_events FROM business_events 
WHERE status='posted' AND journal_entry_id IS NULL;

-- Q3: Journal lines without source_ledger (pre-Phase 4 data)
SELECT COUNT(*) AS missing_source_ledger FROM journal_lines 
WHERE source_ledger IS NULL OR source_ledger='';

-- Q4: Duplicate posting rules (same type + keys)
SELECT rule_type, COUNT(*) AS cnt
FROM posting_rules 
GROUP BY company_id, rule_type, 
  COALESCE(bus_posting_group_code,'_'), 
  COALESCE(prod_posting_group_code,'_'),
  COALESCE(inv_posting_group_code,'_')
HAVING COUNT(*) > 1;

-- Q5: Journal entries by source (to identify data provenance)
SELECT COUNT(*) AS cnt, ref_type
FROM journal_entries
GROUP BY ref_type;
```

**Output**: Data Quality Report with counts + delta analysis

### Task 1.3: Identify Non-Compliant Endpoints
List API routes that allow direct GL writes:
- GET their signatures
- List what fields they accept
- Check if they bypass posting_rules

**Expected Findings**:
- Likely manual GL entry endpoints that don't create business_events
- Possible hardcoded account codes (bypassing rule resolution)
- Possible cost center direct writes

---

## PHASE 2: CONSOLIDATE POSTING PATHS (Days 2-3)

### Task 2.1: Enforce Single Pipeline in FinanceCore

**Current State**: FinanceCore has posting methods but they may not cover ALL GL posting scenarios.

**Target State**: EVERY GL write goes:
```
BusinessEvent Created → PostingEngine Resolves Rules → JournalEntry + Lines Written → Event Linked
```

**Work Items**:

1. **For Cash Transactions**:
   - `FinanceCore.prepareCashMovement()` + `FinanceCore.recordCashMovement()` already create business_events ✓
   - `resolveCashLedger()` must be updated to call PostingEngine, not hardcode accounts ⚠️
   - Must populate source_ledger='cash' on all lines ⚠️

2. **For Supplier Invoices**:
   - `resolveSupplierInvoice()` must create a business_event ('supplier_invoice') BEFORE posting
   - Must call PostingEngine.resolveSupplierInvoice() for account routing
   - Must populate source_ledger='supplier' on all lines

3. **For Inventory Movements**:
   - `resolveInventoryMovement()` must create business_event before posting
   - Must call PostingEngine.resolveInventoryMovement() for account routing
   - Must populate source_ledger='inventory' on all lines

4. **For Payroll**:
   - `resolvePayrollPosting()` must create business_event before posting
   - Must populate source_ledger='payroll' on all lines

5. **For Manual GL Entries**:
   - Create business_event (event_type='manual_entry') FIRST
   - Then post via PostingEngine
   - Require CHIEF_ACCOUNTANT role
   - Populate source_ledger='manual' on all lines

6. **For Harvest GL**:
   - `postHarvestLedger()` must create business_event (event_type='harvest')
   - Must use PostingEngine for account resolution
   - Must populate source_ledger='harvest' on all lines

### Task 2.2: Delete Legacy Setup Table Code

**Legacy tables to DELETE from codebase**:
- `general_posting_setup` — migrated to `posting_rules(rule_type='general')`
- `inventory_posting_setup` — migrated to `posting_rules(rule_type='inventory')`
- `gl_account_mappings` — migrated to `posting_rules(rule_type='control')`

**Work Items**:
1. Remove any queries that SELECT from these tables
2. Remove any migrations that created these tables
3. Verify posting_engine.ts reads ONLY from posting_rules
4. Delete any UI routes that expose these tables
5. Test: all posting_rules_based resolution should work

### Task 2.3: Enforce Posting Rules Resolution

**Current State**: Some account codes may be hardcoded in API endpoints.

**Target State**: ALL account resolution goes through PostingEngine.

**Scan for**:
- `account_code = "1310"` (hardcoded)
- `account_code = "2100"` (hardcoded)
- Any direct string assignments bypassing resolveXxx()

**Replace with**:
- Call appropriate PostingEngine resolver (e.g., resolveInventoryMovement)
- Use resolveControlAccount() for singleton accounts (cash, AP, etc.)

---

## PHASE 3: BACKFILL & RECONCILIATION (Day 4)

### Task 3.1: Backfill Missing business_events

**For Orphaned Journal Entries** (source_event_id IS NULL):

For each orphaned entry:
1. Create synthetic business_event with `payload='migrated'`
2. Set `source_module` = guess from entry_date + account type (inventory/supplier/cash/manual)
3. Set `journal_entry_id` = the orphaned entry
4. Set `status = 'posted'`

**SQL Pattern**:
```sql
INSERT INTO business_events (company_id, event_type, event_date, reference_number,
  source_module, source_id, payload, status, journal_entry_id, posted_at, posted_by)
SELECT
  je.company_id,
  'migration_synthetic', -- synthetic event type
  je.entry_date,
  je.entry_number,
  'manual', -- assume manual entry
  je.id,
  json_object('migrated', 1, 'original_je_id', je.id),
  'posted',
  je.id,
  je.created_at,
  je.created_by
FROM journal_entries je
WHERE je.source_event_id IS NULL
  AND je.company_id = ?
ORDER BY je.id ASC;
```

Verify: All journal_entries now have source_event_id ≠ NULL

### Task 3.2: Backfill Missing source_ledger

**For Journal Lines** with source_ledger IS NULL:

Infer source_ledger from account type + entry description:
- If posting to Inventory accounts → source_ledger='inventory'
- If posting to AP/Purchases → source_ledger='supplier'
- If posting to Cash → source_ledger='cash'
- If posting to Wages/Payroll → source_ledger='payroll'
- If posting to Revenue/COGS → source_ledger='harvest'
- If no pattern matches → source_ledger='adjustment'

**SQL Pattern**:
```sql
UPDATE journal_lines
SET source_ledger = CASE
  WHEN account_code LIKE '1[3]%' THEN 'inventory'  -- 1300s Inventory accounts
  WHEN account_code LIKE '21%' THEN 'supplier'     -- 2100 AP
  WHEN account_code LIKE '5%' THEN 'cash'          -- 5000s Expense/Revenue
  ELSE 'adjustment'
END
WHERE source_ledger IS NULL
  AND company_id = ?;
```

Verify: All journal_lines now have source_ledger ≠ NULL

### Task 3.3: Cost Center Reconciliation

**Verify that all cost center aggregations READ ONLY FROM journal_lines**:

Scan for reports that:
- JOIN journal_lines to cash_transactions
- JOIN journal_lines to supplier_transactions
- JOIN journal_lines to inventory_movements

**THESE ARE WRONG**. Cost center data should ONLY come from `journal_lines.center_code` dimension.

Delete these multi-source aggregations. Replace with single GL query.

---

## PHASE 4: COMPLIANCE ENFORCEMENT (Days 5-6)

### Task 4.1: Add Forbidden Path Guards

**Add database triggers** (if D1 supports):

```sql
-- Trigger: Prevent direct journal_entries INSERT that bypasses business_events
CREATE TRIGGER prevent_direct_je_insert BEFORE INSERT ON journal_entries
WHEN NEW.source_event_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'Cannot insert journal_entry without source_event_id. Use PostingEngine.post().');
END;
```

**Add application guards** in API layer:

```typescript
// Middleware: Check every POST to GL endpoints
app.use(async (c, next) => {
  const path = c.req.path
  if (path.includes('/api/gl/entries') && c.req.method === 'POST') {
    return c.json({ error: 'FORBIDDEN: POST /api/gl/entries is disabled. Use domain endpoints instead.' }, 403)
  }
  await next()
})
```

### Task 4.2: Integrity Score Endpoint

**Add** `GET /api/gl/integrity/status` that returns:

```json
{
  "orphaned_entries": 0,
  "orphaned_events": 0,
  "missing_source_ledger": 0,
  "duplicate_rules": 0,
  "status": "CLEAN" | "WARNING" | "CRITICAL"
}
```

This is the system's "health check" — must always return CLEAN before deployment.

### Task 4.3: UI Updates

**Update** [web/src/pages/gl/PostingSetupHealthPage.tsx](web/src/pages/gl/PostingSetupHealthPage.tsx):
- Replace references to legacy setup tables with posting_rules
- Add integrity score display at top
- Show business_event ↔ journal_entry linkage on entry detail

---

## PHASE 5: VALIDATION & TESTING (Days 6-7)

### Task 5.1: End-to-End Flow Testing

**Test Each Transaction Type**:

1. **Cash Transaction**:
   - Create cash expense via `POST /api/cash/expenses`
   - Verify: business_event created ✓
   - Verify: journal_entry created ✓
   - Verify: source_ledger='cash' on all lines ✓
   - Verify: accounts resolved via PostingEngine ✓

2. **Supplier Invoice**:
   - Create invoice via `POST /api/suppliers/invoices`
   - Verify: business_event created ✓
   - Verify: journal_entry created ✓
   - Verify: source_ledger='supplier' on all lines ✓

3. **Inventory Movement**:
   - Create receipt via `POST /api/inventory/receipts`
   - Verify: business_event created ✓
   - Verify: journal_entry created ✓
   - Verify: source_ledger='inventory' on all lines ✓

4. **Payroll Run**:
   - Approve payroll via `POST /api/payroll/:id/approve`
   - Verify: business_event created ✓
   - Verify: source_ledger='payroll' ✓

5. **Manual GL Entry**:
   - Create entry via `POST /api/gl/manual-entries` (CHIEF_ACCOUNTANT only)
   - Verify: business_event created ✓
   - Verify: source_ledger='manual' ✓

### Task 5.2: Reconciliation Testing

1. **GL vs Inventory**:
   ```sql
   SELECT SUM(debit-credit) AS gl_balance FROM journal_lines
   WHERE company_id=? AND account_code LIKE '1[3]%';
   
   SELECT SUM(total_value) FROM inventory_events
   WHERE company_id=? AND status='posted';
   ```
   These two must match (within 0.01).

2. **GL vs Supplier**:
   ```sql
   SELECT SUM(debit-credit) FROM journal_lines
   WHERE company_id=? AND account_code LIKE '21%';
   
   SELECT SUM(debit-credit) FROM supplier_transactions
   WHERE company_id=? AND status='posted';
   ```
   These two must match (within 0.01).

3. **Cost Center Reports**:
   - Verify reports read ONLY from journal_lines
   - Verify center_code dimension propagation
   - Verify no double-counting from multi-source JOINs

### Task 5.3: Audit Trail Testing

For a sample transaction:
1. Open GL entry detail page
2. Verify trace shows:
   - Source business_event ✓
   - Posting rule resolved ✓
   - Rule slot labels on each line ✓
   - source_ledger value ✓
3. Click "View Source" → should open the originating document (receipt, invoice, etc.)

### Task 5.4: TypeScript Compilation

```bash
npm run type-check
```

Must pass with ZERO errors.

---

## SUCCESS CRITERIA

| Criterion | Target | Status |
|-----------|--------|--------|
| Orphaned journal_entries | 0 | ⚠️ |
| Orphaned business_events | 0 | ⚠️ |
| Missing source_ledger | 0 | ⚠️ |
| Duplicate posting_rules | 0 | ⚠️ |
| TS Compilation Errors | 0 | ⚠️ |
| Legacy setup table queries | 0 | ⚠️ |
| Cost center multi-source JOINs | 0 | ⚠️ |
| GL-Inventory Reconciliation | ±0.01 | ⚠️ |
| GL-Supplier Reconciliation | ±0.01 | ⚠️ |
| Manual GL POST enabled | CHIEF_ACCOUNTANT only | ⚠️ |
| Direct POST /api/gl/entries | BLOCKED (HTTP 403) | ⚠️ |

---

## FILE MODIFICATION CHECKLIST

| File | Phase | Work |
|------|-------|------|
| `src/lib/finance_core.ts` | 2 | Update all posting methods to create business_events + use PostingEngine |
| `src/lib/posting_engine.ts` | 2 | Verify reads from posting_rules only |
| `src/lib/gl.ts` | 2 | Update postAutoEntry to enforce source_ledger |
| `src/api/*.ts` | 2,4 | Update all GL-writing endpoints |
| `src/api/reports/season.ts` | 4 | Ensure GL-only queries for cost centers |
| `web/src/pages/gl/PostingSetupHealthPage.tsx` | 4 | Update UI references + add integrity score |
| `migrations/*.sql` | 3 | Backfill business_events + source_ledger |

---

## KNOWN RISKS & MITIGATION

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Backfill breaks transaction linkage | HIGH | Backfill synthetically, verify before commit |
| Hardcoded accounts in codebase | HIGH | Complete codebase scan + grep test |
| Cost center double-counting | HIGH | Test reconciliation end-to-end |
| PostingEngine cache invalidation | MEDIUM | Add cache clear on rule change + test |
| TS compilation after refactor | MEDIUM | Run type-check after EACH phase |

---

## ROLLBACK PLAN

If integration fails:
1. Export data as CSV before Phase 3 backfill
2. Keep a D1 snapshot before migration
3. If Phase 3 backfill creates orphans, revert to pre-Phase-3 snapshot
4. Restart from Phase 1 with different backfill strategy

---

## NEXT STEP

Execute Phase 1: Complete Codebase Audit
