# AUDIT: Data Quality Assessment — GL Completeness

**Date**: 2026-04-29  
**Purpose**: Measure current GL data integrity before backfill decision  
**Status**: 6 SQL Queries Provided (Ready to Execute on Staging D1)

---

## CRITICAL: READ THIS FIRST

These queries should be **RUN ON STAGING D1 DATABASE ONLY**, not production. They measure:

1. ❓ How many GL entries lack source tracking (need backfill)
2. ❓ How many business_events are orphaned (need linkage)
3. ❓ When the GL data quality changed (phase boundary detection)
4. ❓ Which companies are affected
5. ❓ Is GL balanced (necessary before any changes)
6. ❓ Pre-Phase-4 vs Post-Phase-4 data state

**Why these matter**: 
- If orphaned entries >> 100, we have a serious sync issue (bigger investigation needed)
- If source_ledger is mostly NULL, we must backfill before proceeding
- If GL is imbalanced, we have a data corruption risk (STOP immediately)
- If a company shows 0 entries, it's safe (greenfield)

---

## QUERY 1: Count Orphaned GL Entries (Missing source_event_id)

**What it measures**: How many GL entries were posted without linking to a business_event

**Run on**: Staging D1

```sql
SELECT
  COUNT(*) AS orphaned_count,
  COUNT(DISTINCT company_id) AS affected_companies,
  COUNT(CASE WHEN created_at < '2026-04-01' THEN 1 END) AS pre_phase4_count,
  COUNT(CASE WHEN created_at >= '2026-04-01' THEN 1 END) AS post_phase4_count
FROM journal_entries
WHERE source_event_id IS NULL
  AND is_posted = 1;
```

**Expected Result**:
- ✅ GOOD: orphaned_count = 0 (all entries linked)
- ⚠️ WARNING: orphaned_count < 500 (pre-Phase-4 data, manageable backfill)
- 🔴 CRITICAL: orphaned_count > 500 (massive sync issue, needs investigation)

**Action if CRITICAL**: Stop consolidation sprint. Investigate why Phase 4 didn't link entries.

---

## QUERY 2: Count GL Lines Missing source_ledger (Pre-Phase-4 Indicator)

**What it measures**: How many GL lines don't have the source_ledger dimension (audit trail incomplete)

**Run on**: Staging D1

```sql
SELECT
  COUNT(*) AS missing_source_ledger_count,
  COUNT(DISTINCT company_id) AS affected_companies,
  COUNT(DISTINCT jl.account_code) AS unique_account_codes_missing_ledger,
  MIN(je.entry_date) AS earliest_entry_date,
  MAX(je.entry_date) AS latest_entry_date
FROM journal_entry_lines jl
JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id
WHERE (jl.source_ledger IS NULL OR jl.source_ledger = '')
  AND je.is_posted = 1;
```

**Expected Result**:
- ✅ GOOD: missing_source_ledger_count = 0 (all lines have source tracking)
- ⚠️ WARNING: missing_source_ledger_count < 1000 (manageable backfill)
- 🔴 CRITICAL: missing_source_ledger_count > 1000 (need to assess backfill feasibility)

**Action if WARNING**: Backfill will be needed (estimate 1-2 hours for 1000 rows).

---

## QUERY 3: Breakdown by Entry Date — Identify Phase Boundary

**What it measures**: When did GL data quality improve (shows Phase 4 cutoff)

**Run on**: Staging D1

```sql
SELECT
  strftime('%Y-%m', je.entry_date) AS month,
  COUNT(DISTINCT je.id) AS entry_count,
  COUNT(CASE WHEN je.source_event_id IS NOT NULL THEN 1 END) AS entries_with_source_event_id,
  COUNT(CASE WHEN jl.source_ledger IS NOT NULL THEN 1 END) AS lines_with_source_ledger,
  ROUND(100.0 * COUNT(CASE WHEN je.source_event_id IS NOT NULL THEN 1 END) / COUNT(DISTINCT je.id), 1) AS pct_with_source_event_id,
  ROUND(100.0 * COUNT(CASE WHEN jl.source_ledger IS NOT NULL THEN 1 END) / COUNT(*), 1) AS pct_with_source_ledger
FROM journal_entries je
LEFT JOIN journal_entry_lines jl ON jl.entry_id = je.id AND jl.company_id = je.company_id
WHERE je.is_posted = 1
GROUP BY strftime('%Y-%m', je.entry_date)
ORDER BY je.entry_date DESC
LIMIT 24;
```

**Expected Result**:
- Look for the cutoff month where `pct_with_source_event_id` jumps from 0% to 100%
- That's when Phase 4 implementation finished for your data
- Rows before that month are "pre-Phase-4" (need backfill)
- Rows after are "post-Phase-4" (should be complete, if not investigate why)

**Example Output**:
```
month     | entry_count | entries_with_source_event_id | pct_with_source_event_id
2026-04   | 45          | 45                           | 100.0
2026-03   | 120         | 120                          | 100.0
2026-02   | 200         | 0                            | 0.0         ← CUTOFF
2026-01   | 180         | 0                            | 0.0
```

---

## QUERY 4: Breakdown by Company ID — Identify Problem Companies

**What it measures**: Which companies have data quality issues

**Run on**: Staging D1

```sql
SELECT
  c.id AS company_id,
  c.name AS company_name,
  COUNT(DISTINCT je.id) AS total_entries,
  COUNT(CASE WHEN je.source_event_id IS NOT NULL THEN 1 END) AS entries_with_source_event,
  COUNT(CASE WHEN je.source_event_id IS NULL THEN 1 END) AS orphaned_entries,
  COUNT(CASE WHEN jl.source_ledger IS NOT NULL THEN 1 END) AS lines_with_source_ledger,
  COUNT(CASE WHEN jl.source_ledger IS NULL THEN 1 END) AS lines_missing_source_ledger,
  ROUND(100.0 * COUNT(CASE WHEN je.source_event_id IS NOT NULL THEN 1 END) / COUNT(DISTINCT je.id), 1) AS pct_compliant
FROM companies c
LEFT JOIN journal_entries je ON je.company_id = c.id AND je.is_posted = 1
LEFT JOIN journal_entry_lines jl ON jl.entry_id = je.id AND jl.company_id = je.company_id
WHERE c.is_active = 1
GROUP BY c.id
ORDER BY orphaned_entries DESC;
```

**Expected Result**:
- Companies at 100% compliance: safe, no backfill needed
- Companies < 100%: need backfill
- Companies with 0 entries: greenfield, skip

**Action**: Prioritize backfilling the top 3 problem companies first.

---

## QUERY 5: GL Balance Verification (CRITICAL)

**What it measures**: Is the GL balanced? (If not, we have corruption)

**Run on**: Staging D1

```sql
SELECT
  c.id AS company_id,
  c.name AS company_name,
  SUM(jl.debit) AS total_debit,
  SUM(jl.credit) AS total_credit,
  ABS(SUM(jl.debit) - SUM(jl.credit)) AS imbalance,
  CASE
    WHEN ABS(SUM(jl.debit) - SUM(jl.credit)) < 0.01 THEN 'BALANCED ✅'
    ELSE 'IMBALANCED ❌'
  END AS balance_status
FROM companies c
LEFT JOIN journal_entry_lines jl ON jl.company_id = c.id
LEFT JOIN journal_entries je ON je.id = jl.entry_id AND je.is_posted = 1
WHERE c.is_active = 1 AND je.is_posted = 1
GROUP BY c.id
ORDER BY imbalance DESC;
```

**Expected Result**:
- ✅ GOOD: All rows show BALANCED ✅ and imbalance < 0.01
- 🔴 CRITICAL: Any row shows IMBALANCED ❌ (DO NOT PROCEED)

**Action if CRITICAL**: 
1. Stop sprint immediately
2. Investigate which GL entry is causing imbalance
3. Run: `SELECT je.id, je.entry_date, SUM(jl.debit) - SUM(jl.credit) as imb FROM journal_entries je JOIN journal_entry_lines jl ON jl.entry_id = je.id WHERE je.company_id = ? AND ABS(SUM(jl.debit) - SUM(jl.credit)) > 0.01 GROUP BY je.id`
4. Fix the unbalanced entry manually before proceeding

---

## QUERY 6: Business_events Linkage Status

**What it measures**: How many business_events are created but not linked to GL?

**Run on**: Staging D1

```sql
SELECT
  be.company_id,
  c.name AS company_name,
  COUNT(*) AS total_events,
  COUNT(CASE WHEN be.status = 'posted' AND be.journal_entry_id IS NOT NULL THEN 1 END) AS linked_posted_events,
  COUNT(CASE WHEN be.status = 'posted' AND be.journal_entry_id IS NULL THEN 1 END) AS orphaned_posted_events,
  COUNT(CASE WHEN be.status IN ('pending', 'error') THEN 1 END) AS unfinished_events,
  ROUND(100.0 * COUNT(CASE WHEN be.journal_entry_id IS NOT NULL THEN 1 END) / COUNT(*), 1) AS pct_linked
FROM business_events be
JOIN companies c ON c.id = be.company_id
WHERE c.is_active = 1
GROUP BY be.company_id
ORDER BY orphaned_posted_events DESC;
```

**Expected Result**:
- ✅ GOOD: pct_linked ≥ 99% for each company
- ⚠️ WARNING: pct_linked 80-99% (some events not linked, investigate why)
- 🔴 CRITICAL: pct_linked < 80% (systemic linkage issue)

**Action if WARNING or CRITICAL**: 
- Need to understand why events aren't linked
- Run deep-dive: `SELECT be.id, be.event_type, be.status, be.journal_entry_id, be.created_at FROM business_events be WHERE be.company_id = ? AND be.journal_entry_id IS NULL AND be.status = 'posted' ORDER BY created_at DESC LIMIT 10`

---

## EXECUTION INSTRUCTIONS

### Step 1: Connect to Staging D1
```bash
# Use wrangler CLI or D1 dashboard to connect to staging database
wrangler d1 execute agri-nile-staging --command="..."
```

### Step 2: Run Queries in Order
Execute each query 1-6 in sequence, copy results to AUDIT_DATA_QUALITY_ASSESSMENT_RESULTS.md

### Step 3: Interpret Results
- If all queries show ✅ GOOD → Proceed to TASK A1.3 (backfill strategy)
- If any query shows ⚠️ WARNING → Backfill is needed, proceed with caution
- If any query shows 🔴 CRITICAL → STOP and investigate before proceeding

### Step 4: Document Findings
Create AUDIT_DATA_QUALITY_ASSESSMENT_RESULTS.md with:
- Actual query output (copy-paste results)
- Interpretation for each query
- Risk assessment
- Recommendation (backfill or not, how urgent)

---

## EXPECTED OUTCOMES (Best Case Scenario)

If all queries return ideal results:

```
QUERY 1: orphaned_count = 0 ✅
QUERY 2: missing_source_ledger_count = 0 ✅
QUERY 3: All post-Phase-4 entries at 100% ✅
QUERY 4: All companies at 100% compliance ✅
QUERY 5: All companies BALANCED ✅
QUERY 6: All companies pct_linked ≥ 99% ✅

→ RECOMMENDATION: **GL IS READY FOR CONSOLIDATION SPRINT**
   No backfill needed. Proceed to Phase 1 enforcement.
```

---

## EXPECTED OUTCOMES (Realistic Scenario)

More likely, we'll see:

```
QUERY 1: orphaned_count = 237 (pre-Phase-4 entries) ⚠️
QUERY 2: missing_source_ledger_count = 1,456 (pre-Phase-4 lines) ⚠️
QUERY 3: Cutoff month = Feb 2026 (entries before = 0% source_ledger)
QUERY 4: Company A: 95% compliant, Company B: 98% compliant ⚠️
QUERY 5: All companies BALANCED ✅
QUERY 6: Pct_linked = 98% ⚠️

→ RECOMMENDATION: **PROCEED WITH BACKFILL**
   ~2,000 rows need source tracking. Backfill effort: 2-3 hours.
   Phase 4 data quality is good, just need to clean pre-Phase-4 data.
```

---

## IF YOU FIND CRITICAL ISSUES

If any query returns 🔴 CRITICAL:

1. **GL Imbalance**: 
   - Find unbalanced entry: `SELECT je.id FROM journal_entries je WHERE ABS(SUM(jl.debit) - SUM(jl.credit)) > 0.01`
   - Inspect manually in GL module
   - Correct the error (or reverse+repost)
   - Verify balance before proceeding

2. **High Orphaned Count**:
   - Understand why entries exist without source_event_id
   - Check: Are they manual GL entries? Lost business_event records? System crash during Phase 4?
   - Assess: Can they be safely backfilled synthetically? Or do they indicate a larger issue?

3. **High Unlinked Events**:
   - Check: Are these events status='error'? Then backfill is not needed (they failed)
   - Check: Are these new events that haven't been posted yet? Also skip (they're pending)
   - If posted but unlinked: Investigate why the journal_entry wasn't created

---

## NEXT: TASK A1.3

Once results are in and documented:
- If GL is clean (< 500 orphaned, < 1% missing source_ledger): Proceed to TASK A1.3 (quick backfill)
- If GL needs repair: Create REPAIR_PLAN.md first, then TASK A1.3

---

## SQL Reference: How to Run Queries

### Option A: Wrangler D1 CLI
```bash
wrangler d1 execute agri-nile-staging --command="SELECT COUNT(*) FROM journal_entries WHERE source_event_id IS NULL;"
```

### Option B: D1 Dashboard (Cloudflare)
1. Log in to Cloudflare dashboard
2. Navigate to Workers → D1
3. Select staging database
4. Paste query in SQL editor
5. Click "Execute"
6. Copy results

### Option C: Node Script (if CLI not available)
Create `scripts/audit-data-quality.js`:
```javascript
import { Database } from '@cloudflare/d1';

const db = new Database(env.DB);

async function runAudit() {
  const q1 = await db.prepare(`SELECT COUNT(*) AS orphaned_count FROM journal_entries WHERE source_event_id IS NULL`).first();
  const q2 = await db.prepare(`SELECT COUNT(*) AS missing_count FROM journal_entry_lines WHERE source_ledger IS NULL`).first();
  
  console.log('QUERY 1:', q1);
  console.log('QUERY 2:', q2);
  // ... etc
}
```

---

**Status**: Ready to execute on staging D1.  
**Owner**: Backend (you)  
**Timeline**: 30 minutes to run all 6 queries + interpret results.
