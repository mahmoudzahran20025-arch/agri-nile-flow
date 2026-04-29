# FULL SPRINT EXECUTION PLAN — Consolidation + Finance UI

**Duration**: 5-7 Days (Parallel Track Execution)  
**Date Started**: 2026-04-29  
**Status**: In Execution  

---

## SPRINT STRUCTURE

### Two Parallel Tracks

**Track A: Backend Consolidation** (Days 1-4)
- ✅ Verify cost center reports (GL-only aggregation)
- ✅ Backfill historic GL data (source_ledger, business_events, source_record_id)
- ✅ Add enforcement triggers + guards
- ✅ Add daily integrity audit job

**Track B: Finance UI Foundation** (Days 1-5 concurrent)
- ✅ Build GL entry detail page with trace visualization
- ✅ Build posting rule setup UI
- ✅ Build integrity score badge
- ✅ Build business_event ↔ journal_entry linkage display
- ✅ Connect to backend trace data

**Integration Point** (Days 5-7):
- ✅ UI consumes consolidated backend data
- ✅ Full end-to-end testing
- ✅ Deployment readiness

---

## TRACK A: BACKEND CONSOLIDATION (Days 1-4)

### DAY 1: Cost Center Audit + Data Quality Assessment

**Task A1.1: Verify Cost Center Aggregation** (2 hours)

Scan `src/api/reports/` for multi-source JOINs:

**Files to inspect**:
- `src/api/reports/season.ts` — Season P&L with cost breakdown
- `src/api/reports/cost-centers.ts` — Cost center totals
- `src/api/reports/supplier.ts` — Supplier analysis
- `src/api/reports/trial-balance.ts` — Account balances

**What to find**:
```sql
-- WRONG (multi-source):
SELECT ... FROM journal_lines
JOIN cash_transactions ON journal_lines.ref_id = cash_transactions.id

-- RIGHT (GL-only):
SELECT ... FROM journal_lines
WHERE center_code = ?
```

**Deliverable**: Report showing ✅ CLEAN or ❌ PROBLEMATIC per file

---

**Task A1.2: Backfill Assessment** (2 hours)

Run these SQL queries to understand data state:

```sql
-- Q1: How many journal_entries have no source_event_id?
SELECT COUNT(*) AS orphaned_entries
FROM journal_entries
WHERE source_event_id IS NULL;

-- Q2: How many journal_entry_lines missing source_ledger?
SELECT COUNT(*) AS missing_source_ledger
FROM journal_entry_lines
WHERE source_ledger IS NULL OR source_ledger = '';

-- Q3: How many business_events posted but not linked?
SELECT COUNT(*) AS unlinked_events
FROM business_events
WHERE status = 'posted' AND journal_entry_id IS NULL;

-- Q4: Breakdown by entry date (to see which phase added what)
SELECT DATE(je.entry_date) AS entry_date, COUNT(*) AS cnt,
       SUM(CASE WHEN je.source_event_id IS NULL THEN 1 ELSE 0 END) AS orphaned,
       SUM(CASE WHEN jel.source_ledger IS NULL THEN 1 ELSE 0 END) AS missing_ledger
FROM journal_entries je
LEFT JOIN journal_entry_lines jel ON jel.entry_id = je.id
GROUP BY DATE(je.entry_date)
ORDER BY entry_date DESC;
```

**Deliverable**: Data quality report with counts + timeline analysis

---

**Task A1.3: Create Backfill Strategy** (1 hour)

Based on A1.2 findings, decide:
- Which entries need synthetic business_events?
- Which can infer source_ledger from account type?
- Which require manual review?

**Deliverable**: Backfill strategy document with SQL patterns

---

### DAY 2: Backfill Execution + Data Cleanup

**Task A2.1: Backfill Missing business_events** (2 hours)

For each orphaned journal_entry, create synthetic business_event:

```sql
INSERT INTO business_events (
  company_id, event_type, event_date, source_module, source_id,
  reference_number, payload, status, journal_entry_id, posted_at, posted_by
)
SELECT
  je.company_id,
  CASE je.ref_type
    WHEN 'cash_transaction' THEN 'cash_transaction'
    WHEN 'supplier_transaction' THEN 'supplier_invoice'
    WHEN 'inventory_movement' THEN 'inventory_movement'
    ELSE 'manual_entry'
  END AS event_type,
  je.entry_date,
  je.ref_type AS source_module,
  COALESCE(je.ref_id, je.id),
  je.entry_number,
  json_object('backfilled', 1, 'original_je_id', je.id, 'entry_date', je.entry_date),
  'posted',
  je.id,
  je.created_at,
  je.created_by
FROM journal_entries je
WHERE je.source_event_id IS NULL
  AND je.company_id = ?
ORDER BY je.id ASC;

-- Then link them
UPDATE journal_entries
SET source_event_id = (SELECT id FROM business_events WHERE journal_entry_id = journal_entries.id)
WHERE source_event_id IS NULL;
```

**Verification**: `SELECT COUNT(*) FROM journal_entries WHERE source_event_id IS NULL;` → must be 0

---

**Task A2.2: Backfill Missing source_ledger** (2 hours)

Infer source_ledger from account type + posting pattern:

```sql
UPDATE journal_entry_lines jel
SET source_ledger = CASE
  WHEN jel.account_code LIKE '1[3]%' THEN 'inventory'      -- 1300s Inventory
  WHEN jel.account_code LIKE '1[1]%' THEN 'cash'           -- 1100s Cash
  WHEN jel.account_code LIKE '21%' THEN 'supplier'         -- 2100 AP
  WHEN jel.account_code LIKE '5%' OR jel.account_code LIKE '4%' THEN 'harvest'  -- Revenue/Expense
  ELSE 'adjustment'
END
WHERE source_ledger IS NULL OR source_ledger = ''
  AND jel.company_id = ?;
```

**Verification**: `SELECT COUNT(*) FROM journal_entry_lines WHERE source_ledger IS NULL;` → must be 0

---

**Task A2.3: Verify Data Consistency** (1 hour)

Run reconciliation queries:

```sql
-- GL vs Business Events (1:1 mapping)
SELECT COUNT(*) FROM journal_entries je
WHERE NOT EXISTS (SELECT 1 FROM business_events be WHERE be.journal_entry_id = je.id);
-- Should be 0

-- GL Balance Integrity
SELECT SUM(debit) - SUM(credit) AS imbalance FROM journal_entry_lines;
-- Should be ≈ 0 (within 0.01)

-- Source tracking completeness
SELECT COUNT(*) FROM journal_entry_lines
WHERE source_ledger IS NULL OR source_record_id IS NULL;
-- Should be 0
```

**Deliverable**: Data quality green light (or blockers + remediation)

---

### DAY 3: Enforcement + Governance Implementation

**Task A3.1: Add DB Triggers** (1.5 hours)

Prevent future violations:

```sql
-- Trigger 1: Prevent orphaned journal_entries
CREATE TRIGGER enforce_source_event_id
BEFORE INSERT ON journal_entries
WHEN NEW.source_event_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'Journal entry must have source_event_id. Use PostingEngine.post().');
END;

-- Trigger 2: Prevent posted entry modification
CREATE TRIGGER prevent_posted_entry_update
BEFORE UPDATE ON journal_entries
WHEN OLD.is_posted = 1 AND NEW.is_posted = 1
BEGIN
  SELECT RAISE(ABORT, 'Cannot modify posted journal entry. Create reversal instead.');
END;

-- Trigger 3: Enforce source_ledger on all lines
CREATE TRIGGER enforce_source_ledger
BEFORE INSERT ON journal_entry_lines
WHEN NEW.source_ledger IS NULL OR NEW.source_ledger = ''
BEGIN
  SELECT RAISE(ABORT, 'Journal line must have source_ledger assigned. Check PostingEngine.');
END;
```

**Note**: D1 may not support all triggers. If so, move validation to application layer (middleware).

---

**Task A3.2: Add API Guards** (1.5 hours)

Update middleware to block direct GL writes:

```typescript
// src/middleware/gl-safety.ts
import { Context } from 'hono'

export async function glSafetyGuard(c: Context, next: any) {
  const path = c.req.path
  const method = c.req.method

  // FORBIDDEN ENDPOINTS
  const forbidden = [
    '/api/gl/entries',           // POST = direct GL write
    '/api/gl/lines',             // POST = direct line write
    '/api/accounts/balance',     // PUT = account balance manipulation
  ]

  if (forbidden.some(p => path.includes(p)) && ['POST', 'PUT', 'DELETE'].includes(method)) {
    return c.json({
      success: false,
      error: `FORBIDDEN: ${method} ${path} is disabled. Use domain-specific endpoints instead (POST /api/treasury/transactions, POST /api/suppliers/invoices, etc).`
    }, 403)
  }

  await next()
}
```

Mount in `src/index.ts`:
```typescript
import { glSafetyGuard } from './middleware/gl-safety'
app.use('*', glSafetyGuard)
```

---

**Task A3.3: Implement Daily Integrity Audit Job** (2 hours)

Create scheduled job (runs daily at 2 AM):

```typescript
// src/jobs/daily-integrity-audit.ts
import type { D1Database } from '@cloudflare/workers-types'

export async function runDailyIntegrityAudit(db: D1Database): Promise<{
  status: 'CLEAN' | 'WARNING' | 'CRITICAL'
  findings: string[]
  timestamp: string
}> {
  const findings: string[] = []

  // 1. Orphaned entries
  const orphaned = await db.prepare(
    `SELECT COUNT(*) AS n FROM journal_entries WHERE source_event_id IS NULL`
  ).first<{ n: number }>()
  if (orphaned && orphaned.n > 0) {
    findings.push(`⚠️ ${orphaned.n} orphaned journal_entries found`)
  }

  // 2. Missing source_ledger
  const missingSL = await db.prepare(
    `SELECT COUNT(*) AS n FROM journal_entry_lines WHERE source_ledger IS NULL OR source_ledger = ''`
  ).first<{ n: number }>()
  if (missingSL && missingSL.n > 0) {
    findings.push(`⚠️ ${missingSL.n} journal_entry_lines missing source_ledger`)
  }

  // 3. Imbalanced entries
  const imbalanced = await db.prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT entry_id, ABS(SUM(debit) - SUM(credit)) AS imbalance
      FROM journal_entry_lines
      GROUP BY entry_id
      HAVING imbalance > 0.01
    )
  `).first<{ n: number }>()
  if (imbalanced && imbalanced.n > 0) {
    findings.push(`🔴 ${imbalanced.n} imbalanced journal_entries found`)
  }

  // 4. Unlinked business events
  const unlinked = await db.prepare(
    `SELECT COUNT(*) AS n FROM business_events WHERE status='posted' AND journal_entry_id IS NULL`
  ).first<{ n: number }>()
  if (unlinked && unlinked.n > 0) {
    findings.push(`🔴 ${unlinked.n} business_events not linked to journal_entries`)
  }

  // 5. GL balance (must be near zero)
  const glBalance = await db.prepare(
    `SELECT ABS(SUM(debit) - SUM(credit)) AS delta FROM journal_entry_lines`
  ).first<{ delta: number }>()
  if (glBalance && glBalance.delta > 0.01) {
    findings.push(`🔴 GL is OUT OF BALANCE: delta=${glBalance.delta.toFixed(2)}`)
  }

  const status = findings.length === 0 ? 'CLEAN' : findings.some(f => f.startsWith('🔴')) ? 'CRITICAL' : 'WARNING'

  // Log to system_audit_logs
  await db.prepare(`
    INSERT INTO system_audit_logs
    (company_id, user_id, action, table_name, details, created_at)
    VALUES (NULL, NULL, 'INTEGRITY_AUDIT', 'journal_entries', ?, datetime('now'))
  `).bind(JSON.stringify({ status, findings, timestamp: new Date().toISOString() })).run()

  return { status, findings, timestamp: new Date().toISOString() }
}
```

Create endpoint to trigger manually:

```typescript
// src/api/admin.ts
admin.post('/integrity-audit/run', async (c) => {
  const { role } = getUser(c)
  if (role !== 'super_admin') return c.json({ error: 'FORBIDDEN' }, 403)

  const result = await runDailyIntegrityAudit(c.env.DB)
  return c.json({ success: true, data: result })
})
```

---

**Task A3.4: Add Integrity Score Endpoint** (1 hour)

Expose system health:

```typescript
// GET /api/gl/integrity/score
export async function getIntegrityScore(db: D1Database, company_id: number): Promise<{
  overall: number  // 0-100
  components: {
    posting_coverage: number       // % with source_event_id
    source_ledger_completeness: number  // % with source_ledger
    balance_integrity: number      // % entries balanced
    orphan_score: number           // 100 - (orphaned_count / total * 100)
  }
  status: 'CLEAN' | 'WARNING' | 'CRITICAL'
  alerts: string[]
}> {
  const [totalEntries, withSourceEvent, withSourceLedger, balanced, imbalanced] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n FROM journal_entries WHERE company_id = ?`).bind(company_id).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM journal_entries WHERE company_id = ? AND source_event_id IS NOT NULL`).bind(company_id).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM journal_entry_lines WHERE company_id = ? AND source_ledger IS NOT NULL AND source_ledger != ''`).bind(company_id).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM (SELECT entry_id FROM journal_entry_lines WHERE company_id = ? GROUP BY entry_id HAVING ABS(SUM(debit)-SUM(credit)) < 0.01)`).bind(company_id).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM (SELECT entry_id FROM journal_entry_lines WHERE company_id = ? GROUP BY entry_id HAVING ABS(SUM(debit)-SUM(credit)) >= 0.01)`).bind(company_id).first<{ n: number }>(),
  ])

  const total = totalEntries?.n ?? 0
  const posting = total > 0 ? ((withSourceEvent?.n ?? 0) / total * 100) : 100
  const ledger = total > 0 ? ((withSourceLedger?.n ?? 0) / total * 100) : 100
  const balance = total > 0 ? ((balanced?.n ?? 0) / total * 100) : 100
  const orphans = total > 0 ? (100 - ((imbalanced?.n ?? 0) / total * 100)) : 100

  const overall = Math.round((posting * 0.3 + ledger * 0.3 + balance * 0.2 + orphans * 0.2))
  const status = overall >= 95 ? 'CLEAN' : overall >= 80 ? 'WARNING' : 'CRITICAL'
  const alerts: string[] = []
  if (overall < 95) alerts.push(`Overall integrity score: ${overall}/100`)
  if (posting < 95) alerts.push(`${100 - posting}% of entries missing source_event_id`)
  if (ledger < 95) alerts.push(`${100 - ledger}% of lines missing source_ledger`)
  if (balance < 95) alerts.push(`${imbalanced?.n ?? 0} entries are imbalanced`)

  return {
    overall,
    components: {
      posting_coverage: Math.round(posting),
      source_ledger_completeness: Math.round(ledger),
      balance_integrity: Math.round(balance),
      orphan_score: Math.round(orphans),
    },
    status,
    alerts,
  }
}
```

Mount in `src/api/index.ts`:
```typescript
app.get('/gl/integrity/score', async (c) => {
  const { company_id } = getUser(c)
  const score = await getIntegrityScore(c.env.DB, company_id)
  return c.json({ success: true, data: score })
})
```

---

### DAY 4: Testing + Verification + TypeScript Compilation

**Task A4.1: End-to-End Transaction Testing** (2 hours)

For each transaction type, verify:
1. Business event created ✓
2. Journal entry created ✓
3. source_ledger assigned ✓
4. source_record_id set ✓
5. Integrity score shows 100% ✓

**Test Cases**:
- POST /api/treasury/transactions (cash)
- POST /api/suppliers/invoices (supplier)
- POST /api/inventory/receipts (inventory)
- POST /api/payroll/{id}/approve (payroll)
- POST /api/harvest (harvest)

---

**Task A4.2: TypeScript Compilation** (1 hour)

```bash
npm run type-check
```

Must pass with ZERO errors.

---

**Task A4.3: Create Deployment Checklist** (1 hour)

Document pre-deployment verification steps.

---

## TRACK B: FINANCE UI FOUNDATION (Days 1-5, Concurrent)

### DAY 1-2: GL Entry Detail Page with Trace Visualization

**Task B1.1: Design GL Entry Detail Component** (2 hours)

**File**: `web/src/pages/gl/GLEntryDetailPage.tsx`

**UI Layout**:
```
┌──────────────────────────────────────────────────┐
│  GL Entry #JE-2026-0847  [POSTED]                │
│  Date: 2026-04-15  |  Period: Apr 2026          │
│  Integrity Score: 95/100 ✅                       │
├──────────────────────────────────────────────────┤
│  SOURCE BUSINESS EVENT                           │
│  ┌────────────────────────────────────────────┐  │
│  │ Event Type: Cash Transaction               │  │
│  │ Source Module: treasury                    │  │
│  │ Reference: Cash_TXN_1042                   │  │
│  │ Date: 2026-04-15                           │  │
│  │ [View Source Document]                     │  │
│  └────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────┤
│  POSTING RULE RESOLUTION TRACE                   │
│  ┌────────────────────────────────────────────┐  │
│  │ Rule Type: cash_transaction                │  │
│  │ Resolution Step: 1 (Exact Match)           │  │
│  │ Matched Rule ID: 23                        │  │
│  │                                            │  │
│  │ Resolution Path:                           │  │
│  │ ✓ Step 1: Exact match BPG+PPG             │  │
│  │   → Cash Account: 1110                     │  │
│  │   → Contra Account: 2100                   │  │
│  └────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────┤
│  JOURNAL LINES (BALANCED ✓)                      │
│  ┌─────────┬──────────┬────────┬─────────────┐   │
│  │ Account │ Debit    │ Credit │ Source      │   │
│  ├─────────┼──────────┼────────┼─────────────┤   │
│  │ 1110    │ 1000.00  │        │ cash        │   │
│  │ 2100    │          │1000.00│ supplier    │   │
│  └─────────┴──────────┴────────┴─────────────┘   │
│  Total: 1000.00 = 1000.00 ✓                     │
├──────────────────────────────────────────────────┤
│  AUDIT TRAIL                                     │
│  • Posted by: Ahmad Hassan (user_id: 5)        │
│  • Posted at: 2026-04-15 10:32:11 UTC          │
│  • Last modified: (no modifications after post) │
└──────────────────────────────────────────────────┘
```

**Components to Build**:
1. `GLEntryHeader` — Entry number, date, status
2. `SourceEventPanel` — Business event details + link
3. `PostingTracePanel` — Rule resolution visualization
4. `JournalLinesTable` — Lines with source_ledger display
5. `AuditPanel` — Posted by, timestamps

---

**Task B1.2: Create GL Entry Detail API Query** (1.5 hours)

**File**: `web/src/api/gl.ts`

```typescript
export async function fetchGLEntryDetail(entryId: number): Promise<{
  entry: {
    id: number
    entry_number: string
    entry_date: string
    description: string
    is_posted: number
    created_at: string
    posted_at?: string
    posting_rule_trace: any
  }
  businessEvent: {
    id: number
    event_type: string
    source_module: string
    source_id: number
    event_date: string
    payload: any
  } | null
  lines: Array<{
    id: number
    account_code: string
    account_name: string
    debit: number
    credit: number
    center_code?: number
    season_id?: number
    field_id?: number
    rule_slot: string
    source_ledger: string
    source_record_id?: number
  }>
  integrityCheck: {
    balanced: boolean
    imbalance: number
    sourceEventLinked: boolean
  }
}> {
  const res = await fetch(`/api/gl/entries/${entryId}`)
  return res.json().then(r => r.data)
}
```

**Backend Endpoint**: `GET /api/gl/entries/:id`

```typescript
// src/api/gl.ts
gl.get('/entries/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const [entry, lines, event] = await Promise.all([
    c.env.DB.prepare(
      `SELECT * FROM journal_entries WHERE id = ? AND company_id = ?`
    ).bind(id, company_id).first(),
    c.env.DB.prepare(
      `SELECT jel.*, coa.name FROM journal_entry_lines jel
       LEFT JOIN chart_of_accounts coa ON coa.code = jel.account_code
       WHERE jel.entry_id = ? AND jel.company_id = ?
       ORDER BY jel.line_number`
    ).bind(id, company_id).all(),
    c.env.DB.prepare(
      `SELECT * FROM business_events WHERE journal_entry_id = ? AND company_id = ?`
    ).bind(id, company_id).first(),
  ])

  if (!entry) return c.json({ success: false, error: 'Entry not found' }, 404)

  const totalDebit = lines.results.reduce((s, l) => s + l.debit, 0)
  const totalCredit = lines.results.reduce((s, l) => s + l.credit, 0)

  return c.json({
    success: true,
    data: {
      entry,
      businessEvent: event,
      lines: lines.results,
      integrityCheck: {
        balanced: Math.abs(totalDebit - totalCredit) < 0.01,
        imbalance: Math.abs(totalDebit - totalCredit),
        sourceEventLinked: !!entry.source_event_id,
      },
    },
  })
})
```

---

### DAY 2-3: Posting Rule Setup UI + Integrity Score Badge

**Task B2.1: Posting Rule Builder Component** (3 hours)

**File**: `web/src/pages/gl/PostingRuleBuilderPage.tsx`

Visual rule builder with:
- Transaction type selector
- Posting group filters
- Account slot mappings
- Rule priority editor
- Validation preview
- Test with sample transaction

(Build on existing [PostingSetupHealthPage.tsx](web/src/pages/gl/PostingSetupHealthPage.tsx) pattern)

---

**Task B2.2: Integrity Score Badge** (1.5 hours)

**File**: `web/src/components/gl/IntegrityScoreBadge.tsx`

Display GL health at top of every page:

```typescript
export function IntegrityScoreBadge() {
  const [score, setScore] = useState<number | null>(null)
  const [status, setStatus] = useState<'CLEAN' | 'WARNING' | 'CRITICAL'>('CLEAN')

  useEffect(() => {
    fetch('/api/gl/integrity/score')
      .then(r => r.json())
      .then(d => {
        setScore(d.data.overall)
        setStatus(d.data.status)
      })
  }, [])

  const bgColor = status === 'CLEAN' ? 'bg-green-100' : status === 'WARNING' ? 'bg-yellow-100' : 'bg-red-100'
  const textColor = status === 'CLEAN' ? 'text-green-800' : status === 'WARNING' ? 'text-yellow-800' : 'text-red-800'

  return (
    <div className={`${bgColor} ${textColor} px-3 py-1 rounded-full text-sm font-semibold`}>
      GL Integrity: {score}/100
    </div>
  )
}
```

Mount in header:
```typescript
// web/src/components/Header.tsx
<IntegrityScoreBadge />
```

---

### DAY 3-4: Business Event ↔ Journal Entry Linkage Display

**Task B3.1: Business Event Detail Component** (2 hours)

**File**: `web/src/pages/gl/BusinessEventDetailPage.tsx`

Show complete event history:
- Event metadata (type, date, source)
- Payload (original transaction data)
- Linked journal entry (if posted)
- Status timeline (pending → posted → error)
- Reversal chain (if reversed)

---

**Task B3.2: Event-Driven Chart/Timeline** (2 hours)

Visual timeline showing:
```
Business Event Created (pending)
     ↓
  PostingEngine Resolution
     ↓
  Journal Entry Created
     ↓
  Posted ✓
```

---

### DAY 5: Integration + Full E2E Testing

**Task B5.1: Wire Up All Components** (2 hours)

- GL Entry Detail → shows business event link
- Business Event Detail → shows journal entry link
- Integrity Score → updates automatically
- Trace visualization → interactive rule steps

---

**Task B5.2: Full Page Testing** (2 hours)

Test complete flow:
1. Create cash transaction via API
2. View in GL Entry Detail page
3. Click "View Source Event"
4. See Business Event detail
5. Verify all trace info
6. Verify Integrity Score shows 100%

---

## INTEGRATION POINTS (Days 5-7)

### Day 5: Parallel Convergence

- Backend consolidation complete ✓
- Finance UI foundation complete ✓
- Both use same data model (business_events ↔ journal_entries)

### Day 6: Cross-Testing

- UI consumes backend integrity score
- UI displays business event linkages
- API responds with complete trace data
- All TypeScript compiles

### Day 7: Deployment Preparation

- Final testing checklist
- Migration scripts ready
- Rollback plan documented
- Deployment approved

---

## DELIVERABLES BY END OF SPRINT

### Backend (Track A)
✅ Backfilled GL data (source_event_id, source_ledger, business_events)  
✅ Enforced via DB triggers + API guards  
✅ Daily integrity audit job running  
✅ Integrity score endpoint live  
✅ All TypeScript compiling  

### Frontend (Track B)
✅ GL Entry Detail page with posting trace  
✅ Business Event Detail page  
✅ Posting Rule Builder UI  
✅ Integrity Score badge in header  
✅ Trace visualization component  
✅ All connected to backend APIs  

### Governance
✅ Orphaned entries prevented  
✅ Direct GL writes blocked  
✅ Daily health checks automated  
✅ Complete audit trail visible in UI  

---

## RISK MITIGATION

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Backfill script bugs | HIGH | Test on staging first, keep backup |
| UI-backend data mismatch | MEDIUM | Use shared TypeScript interfaces |
| Performance on large datasets | MEDIUM | Add pagination + caching |
| User confusion on GL flow | LOW | Add help tooltips + onboarding |

---

## SUCCESS CRITERIA

- ✅ All journal_entries have source_event_id ≠ NULL
- ✅ All journal_entry_lines have source_ledger ≠ NULL
- ✅ All business_events status = 'posted' have journal_entry_id set
- ✅ GL balance remains = 0 (± 0.01)
- ✅ Integrity score = 100/100
- ✅ TypeScript compilation = 0 errors
- ✅ UI shows complete trace for every entry
- ✅ Users can click from GL → Event → Source Document
- ✅ 24-hour post-deployment monitoring shows no GL anomalies

---

## GO/NO-GO DECISION POINT

**End of Day 4**: Decision to proceed with deployment
- If all backend tests pass ✓ → Proceed
- If any backfill data quality issue ✗ → Debug + remediate (extend Day 4)
- If any UI-backend mismatch ✗ → Fix integration (Day 5 extended)

Assuming all green → **PRODUCTION DEPLOYMENT on Day 6**

---

## EXECUTION CHECKLIST

**Day 1**:
- [ ] Cost center audit complete
- [ ] Data quality assessment done
- [ ] Backfill strategy documented

**Day 2**:
- [ ] Backfill scripts executed
- [ ] Data consistency verified
- [ ] Integrity score = 100%

**Day 3**:
- [ ] Triggers/guards deployed
- [ ] Daily audit job running
- [ ] Integrity endpoint live

**Day 4**:
- [ ] E2E transaction testing done
- [ ] TypeScript compilation: 0 errors
- [ ] Deployment checklist reviewed

**Day 5**:
- [ ] GL Entry Detail page live
- [ ] Business Event linkage visible
- [ ] Integrity badge in header
- [ ] Full integration tested

**Day 6**:
- [ ] Final staging test
- [ ] Production deployment approved
- [ ] 24-hour monitoring active

**Day 7**:
- [ ] Post-deployment verification
- [ ] Stakeholder sign-off
- [ ] Documentation updated

---

**Current Status**: Ready to Begin Day 1 Tasks
**Next Step**: Execute Task A1.1 (Cost Center Audit)
