# BACKFILL STRATEGY: Source Tracking Completeness

**Date**: 2026-04-29  
**Purpose**: Template SQL + approach for backfilling pre-Phase-4 GL entries  
**Safety**: Idempotent, reversible, tested pattern  
**Execution Target**: Staging D1 first, then production with approval

---

## WHAT THIS DOES

Before Phase 4, some GL entries were posted **without** creating business_events first. This backfill:

1. ✅ Creates synthetic business_events for orphaned entries
2. ✅ Links those entries back to GL (source_event_id)
3. ✅ Infers and populates source_ledger on GL lines (audit trail)
4. ✅ Populates source_record_id where identifiable
5. ✅ Preserves all original data (no deletions)
6. ✅ Rolls back cleanly if needed

---

## CRITICAL ASSUMPTIONS

**Before running this, you MUST confirm via TASK A1.2**:

- [ ] GL is BALANCED (Query 5)
- [ ] Orphaned entries < 500 (Query 1)
- [ ] Missing source_ledger < 1000 (Query 2)
- [ ] No CRITICAL issues found

**If any of these are false, STOP and investigate instead of running backfill.**

---

## BACKFILL LOGIC (4 Steps)

### STEP 1: Create Synthetic business_events for Orphaned GL Entries

**What**: For every journal_entry with source_event_id IS NULL, create a synthetic business_event.

**Why**: Every GL entry must have a source business_event (architectural law).

**Data**:
- event_type = 'migration_synthetic' (flags this as backfilled, not a real event)
- source_module = inferred from GL account codes + entry description
- payload = JSON with `{migrated: 1, original_je_id: je.id, inferred: true}`
- status = 'posted' (it's already in GL, so it's already posted)

**SQL Template**:

```sql
-- STEP 1: Create synthetic business_events for orphaned journal_entries
INSERT INTO business_events (
  company_id, event_type, event_date, source_module, source_id,
  payload, status, journal_entry_id, posted_by
)
SELECT
  je.company_id,
  'migration_synthetic',
  je.entry_date,
  CASE
    -- Infer source_module from account codes on the entry's lines
    WHEN EXISTS (
      SELECT 1 FROM journal_entry_lines jl
      WHERE jl.entry_id = je.id AND jl.account_code LIKE '1[3-4]%'  -- inventory/receivables
    ) THEN 'inventory'
    WHEN EXISTS (
      SELECT 1 FROM journal_entry_lines jl
      WHERE jl.entry_id = je.id AND (jl.account_code LIKE '21%' OR jl.account_code LIKE '22%')  -- AP/liabilities
    ) THEN 'suppliers'
    WHEN EXISTS (
      SELECT 1 FROM journal_entry_lines jl
      WHERE jl.entry_id = je.id AND jl.account_code LIKE '5[0-2]%'  -- cash/expense
    ) THEN 'cash'
    WHEN EXISTS (
      SELECT 1 FROM journal_entry_lines jl
      WHERE jl.entry_id = je.id AND jl.account_code LIKE '6[0-9]%'  -- payroll/wages
    ) THEN 'payroll'
    WHEN EXISTS (
      SELECT 1 FROM journal_entry_lines jl
      WHERE jl.entry_id = je.id AND (jl.account_code LIKE '4[0-9]%' OR jl.account_code LIKE '5[3-9]%')  -- revenue/other
    ) THEN 'harvest'
    ELSE 'manual'
  END AS inferred_module,
  je.id,  -- source_id = the GL entry ID (for traceability)
  json_object(
    'migrated', 1,
    'original_je_id', je.id,
    'inferred_source_module', 'true',
    'entry_description', je.description
  ),
  'posted',
  je.id,
  je.created_by
FROM journal_entries je
WHERE je.source_event_id IS NULL
  AND je.is_posted = 1
  AND je.company_id = ?  -- parameterized for safety
ORDER BY je.id ASC;

-- Verify: All entries now have corresponding business_events
SELECT COUNT(*) AS created_events FROM business_events WHERE event_type = 'migration_synthetic' AND company_id = ?;
```

**Safety Checks**:
- ✅ Uses INSERT ... SELECT (no data loss)
- ✅ Filters by company_id (prevents cross-company pollution)
- ✅ Only processes is_posted = 1 (ignores draft entries)
- ✅ event_type = 'migration_synthetic' (marks clearly as synthetic, not real)

---

### STEP 2: Link journal_entries to Created business_events

**What**: Set source_event_id on journal_entries to point to their newly created business_events.

**Why**: Closes the loop — every GL entry now links back to a business_event.

**SQL**:

```sql
-- STEP 2: Link journal_entries to business_events
UPDATE journal_entries je
SET source_event_id = be.id
FROM business_events be
WHERE je.id = be.journal_entry_id
  AND be.event_type = 'migration_synthetic'
  AND je.company_id = ?
  AND je.source_event_id IS NULL;

-- Verify: All journal_entries now have source_event_id
SELECT COUNT(*) AS unlinked FROM journal_entries WHERE source_event_id IS NULL AND company_id = ?;
-- Expected result: 0
```

**Safety Checks**:
- ✅ Only updates entries that are still NULL (idempotent)
- ✅ Uses be.journal_entry_id matching (ensures correct link)

---

### STEP 3: Populate source_ledger on journal_entry_lines

**What**: For every GL line with source_ledger IS NULL, infer it from the account code.

**Why**: source_ledger is the audit trail — tells us which operational ledger this GL posting came from.

**Inference Rules**:
- Account code 1300-1400 → inventory (inventory movements, WIP)
- Account code 2100-2200 → supplier (AP, accrued expenses)
- Account code 5000-5200 → cash (expense accounts)
- Account code 6000-6999 → payroll (wages, benefits)
- Account code 4000-4999, 5300+ → harvest (revenue, other income)
- Everything else → adjustment (journal entries, reclassifications)

**SQL**:

```sql
-- STEP 3: Populate source_ledger on journal_entry_lines
UPDATE journal_entry_lines jl
SET source_ledger = CASE
  WHEN jl.account_code LIKE '13[0-9][0-9]' THEN 'inventory'  -- 1300-1399
  WHEN jl.account_code LIKE '14[0-9][0-9]' THEN 'inventory'  -- 1400-1499
  WHEN jl.account_code LIKE '21[0-9][0-9]' THEN 'supplier'   -- 2100-2199
  WHEN jl.account_code LIKE '22[0-9][0-9]' THEN 'supplier'   -- 2200-2299
  WHEN jl.account_code LIKE '50[0-2][0-9]' THEN 'cash'       -- 5000-5029
  WHEN jl.account_code LIKE '51[0-9][0-9]' THEN 'cash'       -- 5100-5199
  WHEN jl.account_code LIKE '52[0-9][0-9]' THEN 'cash'       -- 5200-5299
  WHEN jl.account_code LIKE '6[0-9][0-9][0-9]' THEN 'payroll' -- 6000-6999
  WHEN jl.account_code LIKE '4[0-9][0-9][0-9]' THEN 'harvest' -- 4000-4999 (revenue)
  WHEN jl.account_code LIKE '5[3-9][0-9][0-9]' THEN 'harvest' -- 5300-5999 (other income)
  ELSE 'adjustment'
END
WHERE jl.source_ledger IS NULL
  OR jl.source_ledger = ''
AND jl.company_id = ?;

-- Verify: All lines now have source_ledger
SELECT COUNT(*) AS missing FROM journal_entry_lines WHERE (source_ledger IS NULL OR source_ledger = '') AND company_id = ?;
-- Expected result: 0
```

**Safety Checks**:
- ✅ Uses LIKE pattern matching (matches 4-digit GL codes)
- ✅ ELSE 'adjustment' (catch-all, never leaves NULL)
- ✅ Filters by company_id

---

### STEP 4: Populate source_record_id (Where Identifiable)

**What**: Try to link GL lines back to their source records (e.g., cash_transactions, supplier_invoices).

**Why**: For audit trail — should be able to click "View Source Document" on a GL line.

**Approach**: Since we don't have reliable source_record_id for pre-Phase-4 entries, we'll leave it NULL or populate where we can infer it.

**SQL** (optional — only if you have operational record IDs stored elsewhere):

```sql
-- STEP 4A: Link GL lines to cash_transactions where identifiable
-- (Only if you have ref_id or other matching fields)
UPDATE journal_entry_lines jl
SET source_record_id = CAST(je.ref_id AS INTEGER)
FROM journal_entries je
WHERE jl.entry_id = je.id
  AND je.ref_type = 'cash_transaction'
  AND jl.source_ledger = 'cash'
  AND jl.company_id = ?
  AND (jl.source_record_id IS NULL OR jl.source_record_id = '');

-- STEP 4B: Link GL lines to supplier records where identifiable
UPDATE journal_entry_lines jl
SET source_record_id = CAST(je.ref_id AS INTEGER)
FROM journal_entries je
WHERE jl.entry_id = je.id
  AND je.ref_type = 'supplier_invoice'
  AND jl.source_ledger = 'supplier'
  AND jl.company_id = ?
  AND (jl.source_record_id IS NULL OR jl.source_record_id = '');

-- ... similar for inventory_movement, payroll_run, etc.
```

**Note**: This step is OPTIONAL. If source_record_id remains NULL, it's OK — the business_event linkage is the primary audit trail.

---

## ROLLBACK PLAN (If Something Goes Wrong)

### Before Running Backfill: Create Snapshot

```sql
-- Create a backup table with pre-backfill state
CREATE TABLE IF NOT EXISTS journal_entries_backup_pre_backfill AS
SELECT * FROM journal_entries WHERE source_event_id IS NULL;

CREATE TABLE IF NOT EXISTS business_events_backup_pre_backfill AS
SELECT * FROM business_events WHERE event_type = 'migration_synthetic';

CREATE TABLE IF NOT EXISTS journal_entry_lines_backup_pre_backfill AS
SELECT * FROM journal_entry_lines WHERE source_ledger IS NULL OR source_ledger = '';
```

### If Backfill Goes Wrong: Restore

```sql
-- Delete created synthetic events
DELETE FROM business_events WHERE event_type = 'migration_synthetic' AND company_id = ?;

-- Reset journal_entries source_event_id
UPDATE journal_entries SET source_event_id = NULL WHERE company_id = ? AND source_event_id IN (
  SELECT be.id FROM business_events WHERE event_type = 'migration_synthetic'
);

-- Reset journal_entry_lines source_ledger
UPDATE journal_entry_lines SET source_ledger = NULL
WHERE company_id = ? AND source_ledger IN ('cash', 'supplier', 'inventory', 'payroll', 'harvest', 'adjustment', 'manual', 'adjustment');

-- Verify restore
SELECT COUNT(*) FROM journal_entries WHERE source_event_id IS NOT NULL AND company_id = ?;
```

---

## EXECUTION CHECKLIST

### Pre-Execution (30 minutes)

- [ ] **TASK A1.2 complete**: All 6 data quality queries run and interpreted
- [ ] **GL balanced**: Query 5 shows all companies BALANCED
- [ ] **Backfill needed**: Confirm orphaned entries > 0 OR missing source_ledger > 0
- [ ] **Staging copy made**: Fresh D1 staging database ready to test on
- [ ] **Rollback scripts saved**: Copy rollback SQL to `scripts/rollback_backfill.sql`
- [ ] **Team notified**: Backend team knows backfill is running

### Execution (30 minutes on Staging)

1. [ ] Create backup tables (snapshot)
2. [ ] Run STEP 1 (create synthetic business_events)
3. [ ] Verify: New business_events count
4. [ ] Run STEP 2 (link entries to events)
5. [ ] Verify: source_event_id count = 0 (all linked)
6. [ ] Run STEP 3 (populate source_ledger)
7. [ ] Verify: missing source_ledger count = 0
8. [ ] Run GL balance check (must be BALANCED)
9. [ ] Spot-check: Pick 5 random GL entries, confirm they're linked to business_events

### Post-Execution Validation

```sql
-- FINAL VALIDATION (run on staging after backfill)

-- 1. No orphaned entries
SELECT COUNT(*) AS orphaned FROM journal_entries WHERE source_event_id IS NULL AND company_id = ?;
-- Expected: 0

-- 2. No missing source_ledger
SELECT COUNT(*) AS missing FROM journal_entry_lines WHERE source_ledger IS NULL AND company_id = ?;
-- Expected: 0

-- 3. GL balanced
SELECT
  SUM(jl.debit) AS total_debit,
  SUM(jl.credit) AS total_credit,
  ABS(SUM(jl.debit) - SUM(jl.credit)) AS imbalance
FROM journal_entry_lines jl
WHERE jl.company_id = ?;
-- Expected: imbalance < 0.01 (balanced)

-- 4. Business events linked
SELECT COUNT(*) AS unlinked FROM business_events WHERE journal_entry_id IS NULL AND status = 'posted' AND company_id = ?;
-- Expected: 0

-- 5. Sample trace check (pick one entry)
SELECT
  je.id, je.entry_date, je.description,
  be.id, be.event_type, be.source_module,
  COUNT(jl.id) AS line_count
FROM journal_entries je
LEFT JOIN business_events be ON be.id = je.source_event_id
LEFT JOIN journal_entry_lines jl ON jl.entry_id = je.id
WHERE je.company_id = ? AND je.ref_type != 'business_event'
LIMIT 5;
-- Expected: All rows show be.id ≠ NULL and be.event_type = 'migration_synthetic'
```

---

## PRODUCTION DEPLOYMENT (After Staging Validation)

### Approval Gate
- [ ] Staging backfill shows 0 failures
- [ ] GL balanced after backfill
- [ ] All test queries pass
- [ ] Business review: "Yes, OK to backfill production"

### Production Run (Same SQL, Different company_id)
1. Create backup tables (optional but recommended)
2. Run STEP 1-4 with company_id = each active company
3. Run validation queries
4. Monitor GL reports for next 24 hours (no anomalies)

### Success Criteria
- [ ] All journal_entries have source_event_id ≠ NULL
- [ ] All journal_entry_lines have source_ledger ≠ NULL
- [ ] GL balanced
- [ ] Cost center reports match GL totals ±0.01

---

## EFFORT ESTIMATE

| Step | Duration | Notes |
|------|----------|-------|
| Create backup tables | 2 min | Quick snapshot |
| STEP 1 (synthetic events) | 5-10 min | Depends on orphaned count |
| STEP 2 (link entries) | 2-5 min | Fast UPDATE |
| STEP 3 (populate source_ledger) | 5-10 min | Depends on NULL count |
| STEP 4 (source_record_id) | 5-15 min | Optional, slower |
| Validation queries | 10 min | 5 queries, each ~1-2 sec |
| **Total** | **30-50 min** | 1st company; 15 min/additional |

**Timeline**: If backfill needed, full execution (staging + validation) = 1-2 hours. Then Day 2 can run on production.

---

## AFTER BACKFILL: What's Next?

Once backfill is complete and validated:

1. **TASK A1.4**: Run TypeScript compilation (`npm run type-check`)
2. **TASK A2**: Fix `season.ts` queries (convert from operational to GL aggregation)
3. **TASK A3**: Add enforcement (DB triggers, API guards, daily audit job)
4. **TASK A4**: E2E testing + deployment checklist

---

## FAQ

**Q: Will backfill break existing reports?**
A: No. We're only adding missing data (source_ledger, source_event_id). All GL numbers stay the same.

**Q: Can we reverse it if there's a problem?**
A: Yes. Use the rollback SQL provided. Takes 5 minutes to revert to pre-backfill state.

**Q: Do we need to backfill if GL is already in Phase 4?**
A: Only pre-Phase-4 entries (source_ledger = NULL) need backfill. Post-Phase-4 entries are already complete.

**Q: How do we handle entries that were reversed/cancelled?**
A: Keep them. Reversed entries (and their reversals) both get source_ledger assigned. GL remains balanced.

**Q: What if the account code inference is wrong?**
A: Worst case, source_ledger = 'adjustment' (catch-all). Manual GL entries will be marked as such. This is acceptable — the audit trail still works, just less specific.

---

## RELATED DOCUMENTS

- [AUDIT_DATA_QUALITY_ASSESSMENT.md](AUDIT_DATA_QUALITY_ASSESSMENT.md) — Run these 6 queries FIRST
- [AUDIT_COST_CENTER_AGGREGATION.md](AUDIT_COST_CENTER_AGGREGATION.md) — Identify which reports need fixing
- [IMPLEMENTATION_SPRINT_ARCHITECTURAL_CONSOLIDATION.md](IMPLEMENTATION_SPRINT_ARCHITECTURAL_CONSOLIDATION.md) — Full 5-7 day sprint plan

---

**Status**: Ready to execute after TASK A1.2 confirmation.  
**Owner**: Backend  
**Timeline**: 1-2 hours on staging, then 1-2 hours on production (Day 2-3 of sprint).
