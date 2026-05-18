# DAY 1 EXECUTION GUIDE — Cost Center Audit + Data Quality Assessment

**Date**: 2026-04-29  
**Duration**: ~6-8 hours  
**Expected Output**: 3 detailed reports  

---

## TASK A1.1: Verify Cost Center Aggregation (2 hours)

**Objective**: Ensure cost center totals read ONLY from journal_lines (GL-only), not from operational tables.

### Step 1: Identify All Report Files

Files that compute cost center data:

```bash
find src/api/reports -name "*.ts" -type f
```

Expected files:
- `src/api/reports/cost-centers.ts` — Cost center drill-down
- `src/api/reports/season.ts` — Season P&L with cost breakdown
- `src/api/reports/suppliers.ts` — Supplier analysis (may have cost center breakdown)
- `src/api/reports/trial-balance.ts` — Account balances
- `src/api/reports/index.ts` — Report routing

---

### Step 2: Scan for Multi-Source JOINs

For EACH report file, search for this pattern:

**DANGEROUS PATTERN** (indicates multi-source aggregation):
```sql
SELECT ... FROM journal_lines
JOIN cash_transactions ...
```

or

```sql
SELECT ... FROM journal_lines
JOIN supplier_transactions ...
```

or

```sql
SELECT ... FROM journal_lines
JOIN inventory_movements ...
```

**SAFE PATTERN** (GL-only):
```sql
SELECT ... FROM journal_lines
WHERE center_code = ?
GROUP BY center_code
```

---

### Step 3: Create A1.1 Report Template

**File to Create**: `AUDIT_COST_CENTER_AGGREGATION.md`

For each report file, fill in:

```markdown
# Cost Center Aggregation Audit

## File: src/api/reports/season.ts

### Query 1: Season P&L Cost Breakdown
**Location**: Line XXX  
**Pattern**: [SAFE/DANGEROUS]  
**Current Query**:
\`\`\`sql
[paste exact query]
\`\`\`

**Assessment**: [CLEAN / ISSUE FOUND]  
**If ISSUE**: [describe what's wrong]  
**Remediation**: [how to fix]  

---

## SUMMARY

| File | Status | Issues | Risk Level |
|------|--------|--------|-----------|
| season.ts | ✅ or ❌ | N or M | LOW/MEDIUM/HIGH |
| cost-centers.ts | ✅ or ❌ | N or M | LOW/MEDIUM/HIGH |
| suppliers.ts | ✅ or ❌ | N or M | LOW/MEDIUM/HIGH |
| trial-balance.ts | ✅ or ❌ | N or M | LOW/MEDIUM/HIGH |

**Overall Assessment**: CLEAN / MINOR ISSUES / CRITICAL ISSUES
```

---

## TASK A1.2: Backfill Assessment (2 hours)

**Objective**: Understand exactly how much historic data lacks source tracking.

### Step 1: Connect to D1 Database

Use your preferred SQL client (or `wrangler d1`):

```bash
wrangler d1 execute agri-nile-db --local --command "SELECT COUNT(*) FROM journal_entries;"
```

Or use the CLI:
```bash
npx wrangler d1 shell agri-nile-db --local
```

---

### Step 2: Run Assessment Queries

**Query 1: Orphaned Entries (no source_event_id)**

```sql
SELECT 
  COUNT(*) AS total_orphaned,
  MIN(entry_date) AS earliest,
  MAX(entry_date) AS latest,
  COUNT(DISTINCT company_id) AS affected_companies
FROM journal_entries
WHERE source_event_id IS NULL;
```

**Sample Output**:
```
total_orphaned | earliest   | latest     | affected_companies
142            | 2026-01-15 | 2026-04-15 | 3
```

---

**Query 2: Missing source_ledger**

```sql
SELECT 
  COUNT(*) AS missing_count,
  COUNT(DISTINCT entry_id) AS affected_entries,
  MIN(je.entry_date) AS earliest_entry,
  MAX(je.entry_date) AS latest_entry
FROM journal_entry_lines jel
LEFT JOIN journal_entries je ON je.id = jel.entry_id
WHERE jel.source_ledger IS NULL OR jel.source_ledger = '';
```

**Sample Output**:
```
missing_count | affected_entries | earliest_entry | latest_entry
287           | 142              | 2026-01-15     | 2026-04-28
```

---

**Query 3: Unlinked Business Events**

```sql
SELECT 
  COUNT(*) AS unlinked_events,
  COUNT(DISTINCT source_module) AS source_modules_affected,
  GROUP_CONCAT(DISTINCT event_type) AS event_types
FROM business_events
WHERE status = 'posted' AND journal_entry_id IS NULL;
```

**Sample Output**:
```
unlinked_events | source_modules_affected | event_types
0               | 0                       | (NULL)
```

---

**Query 4: Data Quality Timeline (Breakdown by Date)**

```sql
SELECT 
  DATE(je.entry_date) AS entry_date,
  COUNT(*) AS total_entries,
  SUM(CASE WHEN je.source_event_id IS NULL THEN 1 ELSE 0 END) AS orphaned,
  SUM(CASE WHEN jel.source_ledger IS NULL THEN 1 ELSE 0 END) AS missing_ledger,
  COUNT(DISTINCT je.company_id) AS companies
FROM journal_entries je
LEFT JOIN journal_entry_lines jel ON jel.entry_id = je.id
GROUP BY DATE(je.entry_date)
ORDER BY entry_date DESC
LIMIT 30;
```

**Sample Output**:
```
entry_date | total_entries | orphaned | missing_ledger | companies
2026-04-28 | 45           | 0        | 0              | 3
2026-04-27 | 38           | 0        | 0              | 3
...
2026-04-01 | 52           | 12       | 25             | 2
2026-03-31 | 48           | 48       | 48             | 2
```

---

**Query 5: By Company ID (Identify problem companies)**

```sql
SELECT 
  je.company_id,
  c.name AS company_name,
  COUNT(*) AS total_entries,
  SUM(CASE WHEN je.source_event_id IS NULL THEN 1 ELSE 0 END) AS orphaned_pct,
  ROUND(100.0 * SUM(CASE WHEN jel.source_ledger IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) AS source_ledger_pct
FROM journal_entries je
LEFT JOIN journal_entry_lines jel ON jel.entry_id = je.id
LEFT JOIN companies c ON c.id = je.company_id
GROUP BY je.company_id
ORDER BY orphaned_pct DESC;
```

---

**Query 6: GL Balance Integrity**

```sql
SELECT 
  SUM(debit) AS total_debit,
  SUM(credit) AS total_credit,
  ABS(SUM(debit) - SUM(credit)) AS imbalance,
  CASE 
    WHEN ABS(SUM(debit) - SUM(credit)) < 0.01 THEN 'BALANCED ✓'
    ELSE 'OUT OF BALANCE ✗'
  END AS status
FROM journal_entry_lines;
```

**Expected Output**:
```
total_debit | total_credit | imbalance | status
1234567.89  | 1234567.89   | 0.00      | BALANCED ✓
```

---

### Step 3: Create A1.2 Report

**File to Create**: `AUDIT_DATA_QUALITY_ASSESSMENT.md`

```markdown
# Data Quality Assessment Report

**Date**: 2026-04-29  
**Database**: agri-nile-db  
**Time Range**: All time  

---

## FINDINGS

### 1. Orphaned Journal Entries (no source_event_id)

**Query Result**:
| total_orphaned | earliest   | latest     | affected_companies |
|---|---|---|---|
| [X] | [DATE] | [DATE] | [N] |

**Interpretation**:
- [X] entries created before business_events were linked
- Affects [N] companies
- Date range: [DATE] to [DATE]
- **Action Required**: Backfill these with synthetic business_events

---

### 2. Missing source_ledger

**Query Result**:
| missing_count | affected_entries | earliest_entry | latest_entry |
|---|---|---|---|
| [Y] | [Z] | [DATE] | [DATE] |

**Interpretation**:
- [Y] journal_entry_lines lack source_ledger assignment
- From [Z] different journal_entries
- **Action Required**: Infer source_ledger from account type

---

### 3. Unlinked Business Events

**Query Result**:
| unlinked_events | source_modules | event_types |
|---|---|---|
| [0 or N] | [list] | [list] |

**Interpretation**:
- If 0: All business_events are properly linked ✓
- If > 0: Some events posted without journal_entry_id (CRITICAL)

---

### 4. Timeline Analysis

**Query Result**:
```
[paste table from Query 4]
```

**Key Observations**:
- Phase changes visible at: [DATE] (when Phase 4 started)
- Before [DATE]: High orphan count (pre-Phase 4)
- After [DATE]: Low orphan count (Phase 4 forward)
- **Action Required**: Backfill only entries BEFORE Phase 4 cutoff

---

### 5. GL Balance Status

**Query Result**:
| total_debit | total_credit | imbalance | status |
|---|---|---|---|
| [X] | [X] | [≈0] | BALANCED ✓ |

**Interpretation**:
- GL is perfectly balanced (no double-posting errors)
- Safe to proceed with backfill (won't corrupt balances)

---

### 6. Company-by-Company Summary

**Query Result**:
```
[paste table from Query 5]
```

**Risk Assessment**:
- Company 1 ([name]): [status]
- Company 2 ([name]): [status]
- Company 3 ([name]): [status]

---

## BACKFILL STRATEGY

### Scope Definition

**Entries to backfill**: [N] journal_entries (those with source_event_id IS NULL)
**Lines to update**: [Y] journal_entry_lines (those missing source_ledger)
**Business events to create**: [N] synthetic events

### Data Inference Rules

1. **source_ledger Assignment**:
   - If account_code LIKE '1[1]%' → 'cash'
   - If account_code LIKE '1[3]%' → 'inventory'
   - If account_code LIKE '21%' → 'supplier'
   - If account_code LIKE '5%' OR '4%' → 'harvest'
   - Else → 'adjustment'

2. **source_event_id Creation**:
   - ref_type = 'cash_transaction' → event_type='cash_transaction'
   - ref_type = 'supplier_invoice' → event_type='supplier_invoice'
   - ref_type = 'inventory_movement' → event_type='inventory_movement'
   - Else → event_type='manual_entry'

3. **source_record_id**:
   - Use ref_id from journal_entries (link back to source)

---

## RISK ASSESSMENT

| Risk | Probability | Impact | Mitigation |
|------|---|---|---|
| Backfill creates orphans | LOW | HIGH | Test on staging first |
| GL goes out of balance | LOW | CRITICAL | Verify balance before/after |
| Missing inferred source_ledger | MEDIUM | MEDIUM | Manual review required |
| Duplicate business_events | MEDIUM | HIGH | Use unique constraint |

---

## APPROVAL CHECKLIST

- [ ] Cost center audit completed (Task A1.1)
- [ ] Data quality assessment completed (Task A1.2)
- [ ] GL balance verified (BALANCED ✓)
- [ ] Backfill strategy approved
- [ ] Staging environment ready for test
- [ ] Rollback plan documented

**Proceed to Task A1.3?** ✅ YES or ⚠️ ESCALATE

---

## NEXT STEPS

If all green:
1. Proceed to **Task A1.3** (Create Backfill SQL Scripts)
2. Then **Day 2** (Execute backfill)
3. Then **Day 3-4** (Enforcement + Testing)

If any issues:
1. Document blockers
2. Escalate to [User]
3. Adjust strategy
4. Retry
```

---

## TASK A1.3: Create Backfill Strategy (1 hour)

**Objective**: Document exact SQL scripts to run on Day 2.

### Step 1: Create Backfill SQL File

**File to Create**: `scripts/backfill_business_events_and_source_tracking.sql`

```sql
-- ============================================
-- Backfill Script: Business Events + Source Tracking
-- Date: 2026-04-29
-- Purpose: Populate source_event_id + source_ledger for pre-Phase-4 data
-- ============================================

-- Step 1: Create synthetic business_events for orphaned journal_entries
-- This ensures 1:1 mapping between business_events and journal_entries

INSERT INTO business_events (
  company_id,
  event_type,
  event_date,
  source_module,
  source_id,
  reference_number,
  payload,
  status,
  journal_entry_id,
  posted_at,
  posted_by
)
SELECT
  je.company_id,
  CASE je.ref_type
    WHEN 'cash_transaction' THEN 'cash_transaction'
    WHEN 'supplier_invoice' THEN 'supplier_invoice'
    WHEN 'supplier_transaction' THEN 'supplier_invoice'
    WHEN 'inventory_movement' THEN 'inventory_movement'
    WHEN 'purchase_order' THEN 'purchase_receipt'
    WHEN 'harvest_records' THEN 'harvest_revenue'
    ELSE 'manual_entry'
  END AS event_type,
  je.entry_date,
  COALESCE(je.ref_type, 'manual') AS source_module,
  COALESCE(je.ref_id, je.id) AS source_id,
  je.entry_number,
  json_object(
    'backfilled', 1,
    'original_je_id', je.id,
    'entry_date', je.entry_date,
    'description', je.description
  ) AS payload,
  'posted' AS status,
  je.id AS journal_entry_id,
  je.created_at AS posted_at,
  je.created_by AS posted_by
FROM journal_entries je
WHERE je.source_event_id IS NULL
  AND je.is_posted = 1
ORDER BY je.id ASC;

-- Verification
-- SELECT COUNT(*) AS backfilled FROM business_events WHERE payload LIKE '%backfilled%';

---

-- Step 2: Link created business_events back to journal_entries.source_event_id
UPDATE journal_entries je
SET source_event_id = (
  SELECT be.id FROM business_events be
  WHERE be.journal_entry_id = je.id
  LIMIT 1
)
WHERE je.source_event_id IS NULL
  AND je.is_posted = 1;

-- Verification
-- SELECT COUNT(*) AS still_orphaned FROM journal_entries WHERE source_event_id IS NULL;

---

-- Step 3: Backfill missing source_ledger on journal_entry_lines
-- Infer from account type based on chart_of_accounts.account_type

UPDATE journal_entry_lines jel
SET source_ledger = CASE
  -- Asset accounts (1000-1999): Usually inventory or cash
  WHEN jel.account_code LIKE '11%' THEN 'cash'          -- 1100: Cash
  WHEN jel.account_code LIKE '12%' THEN 'cash'          -- 1200: Bank
  WHEN jel.account_code LIKE '13%' THEN 'inventory'     -- 1300: Inventory
  WHEN jel.account_code LIKE '14%' THEN 'adjustment'    -- 1400: Receivables
  WHEN jel.account_code LIKE '15%' THEN 'adjustment'    -- 1500: Fixed Assets
  
  -- Liability accounts (2000-2999): Usually supplier
  WHEN jel.account_code LIKE '21%' THEN 'supplier'      -- 2100: Accounts Payable
  WHEN jel.account_code LIKE '22%' THEN 'adjustment'    -- 2200: Accrued
  
  -- Revenue/Expense accounts (4000-5999): Usually harvest or manual
  WHEN jel.account_code LIKE '4%' THEN 'harvest'        -- 4000: Revenue
  WHEN jel.account_code LIKE '5%' THEN 'harvest'        -- 5000: Expense/COGS
  
  -- Equity (3000): adjustment
  WHEN jel.account_code LIKE '3%' THEN 'adjustment'
  
  -- Default
  ELSE 'adjustment'
END
WHERE (jel.source_ledger IS NULL OR jel.source_ledger = '')
  AND jel.company_id = ? -- Replace with company_id
ORDER BY jel.id ASC;

-- Verification
-- SELECT COUNT(*) AS still_missing FROM journal_entry_lines WHERE source_ledger IS NULL OR source_ledger = '';

---

-- Step 4: Backfill source_record_id where possible
-- Use ref_id from journal_entries as the source record ID

UPDATE journal_entry_lines jel
SET source_record_id = (
  SELECT je.ref_id FROM journal_entries je
  WHERE je.id = jel.entry_id
  LIMIT 1
)
WHERE jel.source_record_id IS NULL
  AND jel.company_id = ?; -- Replace with company_id

-- Verification
-- SELECT COUNT(*) AS missing_source_id FROM journal_entry_lines WHERE source_record_id IS NULL;

---

-- Final Integrity Check
-- RUN THESE AFTER BACKFILL TO VERIFY SUCCESS

SELECT 
  'Orphaned Entries' AS check_type,
  COUNT(*) AS count,
  CASE WHEN COUNT(*) = 0 THEN '✓ PASS' ELSE '✗ FAIL' END AS result
FROM journal_entries
WHERE source_event_id IS NULL;

SELECT 
  'Missing source_ledger' AS check_type,
  COUNT(*) AS count,
  CASE WHEN COUNT(*) = 0 THEN '✓ PASS' ELSE '✗ FAIL' END AS result
FROM journal_entry_lines
WHERE source_ledger IS NULL OR source_ledger = '';

SELECT 
  'GL Balance' AS check_type,
  ABS(SUM(debit) - SUM(credit)) AS imbalance,
  CASE WHEN ABS(SUM(debit) - SUM(credit)) < 0.01 THEN '✓ BALANCED' ELSE '✗ OUT OF BALANCE' END AS result
FROM journal_entry_lines;
```

---

### Step 2: Create Rollback Script

**File to Create**: `scripts/rollback_business_events_backfill.sql`

```sql
-- ROLLBACK SCRIPT (if backfill causes issues)
-- Use ONLY if critical problems detected

DELETE FROM business_events
WHERE payload LIKE '%backfilled%'
  AND status = 'posted';

UPDATE journal_entries
SET source_event_id = NULL
WHERE source_event_id IN (
  SELECT id FROM business_events WHERE payload LIKE '%backfilled%'
);

-- Restore original source_ledger (set back to NULL)
-- Note: This is irreversible — only if completely corrupted

-- Verify rollback
SELECT COUNT(*) FROM business_events WHERE payload LIKE '%backfilled%';
SELECT COUNT(*) FROM journal_entries WHERE source_event_id IS NULL AND is_posted = 1;
```

---

### Step 3: Create A1.3 Documentation

**File to Create**: `BACKFILL_STRATEGY_DOCUMENTATION.md`

```markdown
# Backfill Strategy Documentation

**Purpose**: Populate source_event_id, source_ledger, source_record_id for pre-Phase-4 GL data

**Scope**: [X] journal_entries + [Y] journal_entry_lines (from assessment A1.2)

**Timeline**: 
- Phase 4 started: 2026-04-XX
- Pre-Phase 4 data: [X] entries require backfill
- Post-Phase 4 data: Already compliant ✓

---

## Backfill Approach

### Step 1: Create Synthetic business_events

For each journal_entry with source_event_id IS NULL:

```sql
INSERT INTO business_events (...)
SELECT ... FROM journal_entries
WHERE source_event_id IS NULL
```

**Rationale**:
- Ensures 1:1 mapping (Single Pipeline Law)
- Payload marked as 'backfilled': true
- Allows audit trail (can identify which were synthetic)

---

### Step 2: Update source_event_id

Link new business_events back to journal_entries:

```sql
UPDATE journal_entries
SET source_event_id = (SELECT id FROM business_events WHERE journal_entry_id = je.id)
WHERE source_event_id IS NULL
```

---

### Step 3: Infer source_ledger

Based on account code pattern:

| Account Code | source_ledger | Reason |
|---|---|---|
| 11XX | cash | Cash accounts |
| 13XX | inventory | Inventory accounts |
| 21XX | supplier | Accounts Payable |
| 4XXX | harvest | Revenue |
| 5XXX | harvest | Expense/COGS |
| Other | adjustment | Default catch-all |

---

### Step 4: Link source_record_id

Use ref_id from journal_entries (original transaction ID)

---

## Data Validation

Before executing backfill:

- [ ] GL is balanced (debit = credit)
- [ ] No business_events exist for [X] entries
- [ ] All journal_entries have is_posted = 1

After executing backfill:

- [ ] 0 entries with source_event_id IS NULL
- [ ] 0 lines with source_ledger IS NULL
- [ ] GL still balanced
- [ ] All business_events linked to journal_entries

---

## Rollback Procedure

If critical issues detected:

1. Delete synthetic business_events (WHERE payload LIKE '%backfilled%')
2. Reset source_event_id to NULL
3. Verify integrity still holds

**Warning**: No data corruption risk, but audit trail will show gaps.

---

## Approval Sign-Off

**Backfill approved by**: ________  
**Date**: 2026-04-29  
**Executed on**: [Date]  
**Result**: ✓ PASS or ✗ ISSUES  
**Verified by**: ________  

---

**Next Step**: Execute on **Day 2** after staging environment validation
```

---

## DAY 1 COMPLETION CHECKLIST

- [ ] **Task A1.1 Complete**: Cost center audit report created (`AUDIT_COST_CENTER_AGGREGATION.md`)
  - [ ] All report files scanned
  - [ ] Multi-source JOINs identified (if any)
  - [ ] Status documented (CLEAN / ISSUES)
  
- [ ] **Task A1.2 Complete**: Data quality assessment report created (`AUDIT_DATA_QUALITY_ASSESSMENT.md`)
  - [ ] All 6 queries executed
  - [ ] Query results pasted in report
  - [ ] Key observations documented
  - [ ] Risk assessment completed
  - [ ] Approval checklist signed
  
- [ ] **Task A1.3 Complete**: Backfill strategy documented
  - [ ] `scripts/backfill_business_events_and_source_tracking.sql` created
  - [ ] `scripts/rollback_business_events_backfill.sql` created
  - [ ] `BACKFILL_STRATEGY_DOCUMENTATION.md` created
  - [ ] Ready for Day 2 execution

---

## DELIVERABLES

By end of Day 1, you should have:

1. **AUDIT_COST_CENTER_AGGREGATION.md** — Cost center query review
2. **AUDIT_DATA_QUALITY_ASSESSMENT.md** — Data quality metrics
3. **BACKFILL_STRATEGY_DOCUMENTATION.md** — Exact SQL scripts + approach
4. **scripts/backfill_business_events_and_source_tracking.sql** — Main backfill script
5. **scripts/rollback_business_events_backfill.sql** — Rollback script

All ready for Day 2 execution on staging environment.

---

**Status**: Ready to Execute  
**Estimated Time**: 6-8 hours  
**Next**: Day 1 Task Execution →
