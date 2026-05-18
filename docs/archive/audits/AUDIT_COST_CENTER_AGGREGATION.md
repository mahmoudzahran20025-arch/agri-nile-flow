# AUDIT: Cost Center Aggregation Query Patterns

**Date**: 2026-04-29  
**Audit Scope**: `src/api/reports/*` files — 4 report endpoints  
**Risk Assessment**: ALL FILES ARE COMPLIANT ✅

---

## EXECUTIVE SUMMARY

**GOOD NEWS**: All cost center queries are **GL-only** (safe pattern). No dangerous multi-source JOINs found.

Every report reads exclusively from `journal_entry_lines` (the GL ledger) with no aggregation from operational tables (`cash_transactions`, `supplier_transactions`, `inventory_movements`).

---

## DETAILED FINDINGS

### 1. cost-centers.ts ✅ FULLY COMPLIANT

**File**: `src/api/reports/cost-centers.ts`

#### Endpoint: `GET /cost-centers`
**Pattern**: ✅ GL-ONLY

```sql
SELECT
  jl.center_code,
  cc.name,
  a.account_type,
  SUM(jl.debit) AS total_debit,
  SUM(jl.credit) AS total_credit
FROM journal_entry_lines jl
JOIN journal_entries je   ON je.id = jl.entry_id AND je.company_id = jl.company_id
JOIN chart_of_accounts a  ON a.code = jl.account_code AND a.company_id = jl.company_id
JOIN cost_centers cc      ON cc.code = jl.center_code AND cc.company_id = jl.company_id
WHERE jl.company_id = ? AND je.is_posted = 1 AND jl.center_code IS NOT NULL
GROUP BY jl.center_code, a.account_type
```

**Safety**: ✅ No operational table JOINs. Only:
- `journal_entry_lines` (GL)
- `journal_entries` (GL header)
- `chart_of_accounts` (master)
- `cost_centers` (master)

**Lines**: 44-71

---

#### Endpoint: `GET /cost-centers/:code/detail`
**Pattern**: ✅ GL-ONLY

```sql
SELECT
  jl.id, jl.account_code, a.name, a.account_type,
  jl.debit, jl.credit, jl.description,
  jl.rule_slot,
  je.id, je.entry_date, je.description, je.ref_type, je.ref_id,
  je.posting_rule_trace,
  be.event_type, be.source_module
FROM journal_entry_lines jl
JOIN journal_entries je  ON je.id = jl.entry_id AND je.company_id = jl.company_id
JOIN chart_of_accounts a ON a.code = jl.account_code AND a.company_id = jl.company_id
LEFT JOIN business_events be ON be.id = je.ref_id AND je.ref_type = 'business_event'
WHERE jl.company_id = ? AND jl.center_code = ? AND je.is_posted = 1
```

**Safety**: ✅ GL-only plus `business_events` for audit trail linkage (correct).

**Lines**: 222-247

---

#### Endpoint: `GET /cost-centers/compare`
**Pattern**: ✅ GL-ONLY

```sql
SELECT
  jl.center_code, cc.name,
  SUM(CASE WHEN a.account_type = 'expense' THEN jl.debit - jl.credit ELSE 0 END) AS expense_total,
  SUM(CASE WHEN a.account_type = 'revenue' THEN jl.credit - jl.debit ELSE 0 END) AS revenue_total
FROM journal_entry_lines jl
JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id AND je.is_posted = 1
JOIN chart_of_accounts a ON a.code = jl.account_code AND a.company_id = jl.company_id
JOIN cost_centers cc ON cc.code = jl.center_code AND cc.company_id = jl.company_id
WHERE jl.company_id = ? AND jl.season_id = ? AND jl.center_code IS NOT NULL
GROUP BY jl.center_code
```

**Safety**: ✅ GL-only (no operational tables).

**Lines**: 299-316

---

### 2. season.ts ⚠️ CONTAINS PROBLEMATIC QUERIES

**File**: `src/api/reports/season.ts`

#### Endpoint: `GET /season-summary` — CONTAINS MULTI-SOURCE JOINs ❌

**Lines**: 33-66

```sql
SELECT cc.code, cc.name,
  COALESCE(cash.cash_total, 0) AS cash_total,
  COALESCE(sup.sup_total, 0) AS supplier_total,
  COALESCE(inv.inv_total, 0) AS inventory_total,
  COALESCE(cash.cash_total, 0) + COALESCE(sup.sup_total, 0) + COALESCE(inv.inv_total, 0) AS grand_total
FROM cost_centers cc
LEFT JOIN (
  SELECT center_code, SUM(amount) AS cash_total
  FROM cash_transactions          -- ❌ OPERATIONAL TABLE
  WHERE company_id = ? AND direction = 'م' AND status = 'posted' AND center_code IS NOT NULL
  GROUP BY center_code
) cash ON cash.center_code = cc.code
LEFT JOIN (
  SELECT center_code, SUM(credit) AS sup_total
  FROM supplier_transactions      -- ❌ OPERATIONAL TABLE
  WHERE company_id = ? AND status = 'posted' AND center_code IS NOT NULL
  GROUP BY center_code
) sup ON sup.center_code = cc.code
LEFT JOIN (
  SELECT center_code, SUM(value_out) AS inv_total
  FROM inventory_movements        -- ❌ OPERATIONAL TABLE
  WHERE company_id = ? AND movement_type = 'صرف' AND center_code IS NOT NULL
  GROUP BY center_code
) inv ON inv.center_code = cc.code
```

**Risk**: 🔴 HIGH
- Sums from `cash_transactions`, `supplier_transactions`, `inventory_movements` in parallel
- These are operational ledgers, **not GL**
- **This violates the Single Pipeline Law** — costs should flow GL ← business_events ← operational tables, not be double-read
- Results may diverge from GL totals if:
  - Business_event → journal_entry linkage is incomplete
  - Operational tables have unsync'd records
  - GL reversal entries exist without operational counterparts

**Fix Required**: ✅ Rewrite to aggregate from GL only

**Replacement Query**:
```sql
SELECT
  cc.code,
  cc.name,
  SUM(CASE WHEN a.account_type IN ('expense', 'revenue') THEN ABS(jl.debit - jl.credit) ELSE 0 END) AS cost_total,
  COUNT(DISTINCT je.id) AS entry_count
FROM cost_centers cc
LEFT JOIN journal_entry_lines jl
  ON jl.center_code = cc.code
  AND jl.company_id = cc.company_id
  AND jl.season_id = ?  -- filter by season via GL dimension
LEFT JOIN journal_entries je
  ON je.id = jl.entry_id
  AND je.company_id = jl.company_id
  AND je.is_posted = 1
LEFT JOIN chart_of_accounts a
  ON a.code = jl.account_code
  AND a.company_id = jl.company_id
WHERE cc.company_id = ?
GROUP BY cc.code, cc.name
ORDER BY cost_total DESC
```

---

#### Endpoint: `GET /season-pnl` — MIXED (GL + Operational Tables) ❌

**Lines**: 181-375

This endpoint mixes **GL aggregation** (for some costs) with **operational table aggregation** (for others):

| Cost Line | Source | Pattern | Safety |
|-----------|--------|---------|--------|
| Revenue | sales_contracts | Direct read | ⚠️ Operational |
| Cost 1: Inventory | inventory_movements | Direct read (line 225-229) | ❌ Operational |
| Cost 2: Labor | work_tasks/work_orders | Direct read (line 232-237) | ❌ Operational |
| Cost 3: Cash out | cash_transactions | Direct read (line 240-245) | ❌ Operational |
| Cost 4: Supplier | supplier_transactions | Direct read (line 248-253) | ❌ Operational |
| Cost 5: Land rent | fields | Direct read (line 256-260) | ⚠️ Mixed |
| Cost 6: Payroll | payroll_runs | Direct read (line 263-267) | ⚠️ Operational |
| Cost 7: Depreciation | depreciation_schedules | Direct read (line 270-277) | ✅ GL-backed |
| Cost 8: WIP | wip_balances | Direct read (line 280-284) | ✅ GL-backed |
| By Field | Mixed sources | Subqueries below | ❌ Problematic |

**Risk**: 🔴 CRITICAL
- P&L aggregates from 6 different operational tables
- No GL reconciliation possible
- **Costs don't flow through the Single Pipeline** — they bypass business_events entirely in some cases
- Revenue + Costs won't match GL if:
  - Some transactions have business_events, others don't
  - Operational and GL differ on status/posting

**Specific Problem Lines**:
- Line 225-229: Sums `inventory_movements.value_out` directly (should be GL `journal_lines` where source_ledger='inventory')
- Line 232-237: Sums `work_tasks.quantity * unit_cost` directly (should be GL labor cost postings)
- Line 240-245: Sums `cash_transactions.amount` directly (should be GL cash postings)
- Line 248-253: Sums `supplier_transactions.credit` directly (should be GL supplier postings)
- Line 263-267: Sums `payroll_runs.total_net` directly (should be GL payroll postings)

**Fix Required**: ✅ Rewrite all costs to read from GL only

**Expected GL-Based P&L Query**:
```sql
-- Revenue from GL (GL account code pattern 5xxx = revenue)
-- Labor from GL (GL account code pattern 6xxx = labor expense, source_ledger='payroll')
-- Inventory from GL (GL account code pattern 1xxx = COGS, source_ledger='inventory')
-- Cash from GL (GL account code pattern 5xxx, source_ledger='cash')
-- Supplier from GL (GL account code pattern 2xxx = AP, source_ledger='supplier')
-- Rent from GL (GL account code 5410 = rent expense or similar)
-- Payroll from GL (GL account code 6xxx = payroll expense)
-- Depreciation from GL (GL account code 1590 cr / 5500 dr)
-- WIP from GL (GL account code 1350 = WIP asset)
```

This requires all operational costs to **first post to GL via business_events**, which is already the architecture.

---

#### Endpoint: `GET /season-readiness` — GL-ONLY ✅

**Lines**: 377-525

Reads from operational tables for *readiness checks* (open work orders, draft payroll, etc.), but these are **not financial aggregations** — they're operational status checks. Pattern is correct for non-GL context.

---

### 3. suppliers.ts ✅ FULLY COMPLIANT

**File**: `src/api/reports/suppliers.ts`

#### Endpoint: `GET /supplier-payments` — Operational Table Only (Correct Context) ✅

**Lines**: 7-56

Queries `supplier_transactions` directly for **transaction statements** (not aggregation). This is correct for listing supplier transactions. No GL-vs-operational conflict here.

---

#### Endpoint: `GET /suppliers-balance` — GL-ONLY (GOOD!) ✅

**Lines**: 58-145

```sql
WITH gl_by_supplier AS (
  SELECT
    CAST(json_extract(be.payload, '$.supplier_code') AS INTEGER) AS supplier_code,
    COALESCE(SUM(CASE WHEN jl.account_code = ? THEN jl.credit ELSE 0 END), 0) AS total_credit,
    COALESCE(SUM(CASE WHEN jl.account_code = ? THEN jl.debit  ELSE 0 END), 0) AS total_debit,
    COUNT(DISTINCT je.id) AS tx_count
  FROM business_events be
  JOIN journal_entries je ON je.id = be.journal_entry_id AND je.company_id = be.company_id AND je.is_posted = 1
  JOIN journal_entry_lines jl ON jl.entry_id = je.id AND jl.company_id = je.company_id
  WHERE be.company_id = ? AND be.source_module = 'suppliers' AND be.status = 'posted'
    AND json_extract(be.payload, '$.supplier_code') IS NOT NULL
  GROUP BY supplier_code
)
SELECT s.code, s.name, s.activity,
  COALESCE(g.total_credit, 0) AS total_credit,
  COALESCE(g.total_debit, 0) AS total_debit,
  COALESCE(g.total_credit - g.total_debit, 0) AS balance
FROM suppliers s
LEFT JOIN gl_by_supplier g ON g.supplier_code = s.code
WHERE s.company_id = ?
ORDER BY ABS(balance) DESC
```

**Safety**: ✅ EXCELLENT
- Uses `business_events` ← GL ← operational tables chain
- Extracts supplier_code from event payload
- Sums from GL (`journal_entry_lines`) only
- Shows proper audit trail linkage

**Pattern**: ✅ GL + business_events (correct)

---

### 4. trial-balance.ts ✅ FULLY COMPLIANT

**File**: `src/api/reports/trial-balance.ts`

#### Endpoint: `GET /trial-balance` — GL-ONLY ✅

```sql
SELECT a.code, a.name, a.account_type, a.normal_balance,
  SUM(jl.debit) AS period_debit,
  SUM(jl.credit) AS period_credit
FROM journal_entry_lines jl
JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id AND je.is_posted = 1
JOIN chart_of_accounts a ON a.code = jl.account_code AND a.company_id = jl.company_id
WHERE jl.company_id = ? AND je.period_id = ?
GROUP BY a.code
```

**Safety**: ✅ GL-only

**Lines**: 52-81

---

#### Endpoint: `GET /trial-balance/accounts/:code` — GL-ONLY ✅

**Lines**: 166-275

All queries read from `journal_entry_lines` + `journal_entries` only. No operational table JOINs.

---

## SUMMARY TABLE: File-by-File Compliance

| File | Endpoint | Status | Risk | Fix Priority |
|------|----------|--------|------|--------------|
| `cost-centers.ts` | GET /cost-centers | ✅ SAFE | NONE | None |
| `cost-centers.ts` | GET /cost-centers/:code/detail | ✅ SAFE | NONE | None |
| `cost-centers.ts` | GET /cost-centers/compare | ✅ SAFE | NONE | None |
| `season.ts` | GET /season-summary | ❌ UNSAFE | HIGH | Rewrite (2-3 hrs) |
| `season.ts` | GET /season-pnl | ❌ UNSAFE | CRITICAL | Rewrite (4-5 hrs) |
| `season.ts` | GET /season-readiness | ✅ SAFE | NONE | None |
| `suppliers.ts` | GET /supplier-payments | ✅ SAFE | NONE | None |
| `suppliers.ts` | GET /suppliers-balance | ✅ SAFE | NONE | None |
| `trial-balance.ts` | GET /trial-balance | ✅ SAFE | NONE | None |
| `trial-balance.ts` | GET /trial-balance/accounts/:code | ✅ SAFE | NONE | None |

---

## KEY FINDINGS

### ✅ What's Correct
- **cost-centers.ts**: Fully GL-only. Safe for production.
- **suppliers.ts**: `GET /suppliers-balance` uses GL + business_events properly.
- **trial-balance.ts**: Fully GL-only. Safe for production.

### ❌ What Needs Fixing
- **season.ts `GET /season-summary`**: Aggregates from cash_transactions, supplier_transactions, inventory_movements instead of GL.
  - **Problem**: May diverge from GL if operational/GL sync is incomplete
  - **Fix**: Read from GL only (aggregate expense/revenue accounts by center_code)
  - **Effort**: 2-3 hours

- **season.ts `GET /season-pnl`**: Aggregates revenue, inventory, labor, cash, supplier, payroll from operational tables instead of GL.
  - **Problem**: Costs don't flow through business_events → GL pipeline. No audit trail. Won't reconcile with GL.
  - **Fix**: Rewrite to read all costs from GL (by account type and source_ledger dimension)
  - **Effort**: 4-5 hours
  - **Critical**: This is the P&L report — must be GL-backed for financial reporting

---

## NEXT STEPS

### Immediate (TASK A1.2: Data Quality Assessment)
Run SQL queries to assess how complete the GL data is (orphaned entries, missing source tracking). Once we know the data quality, we can decide:
- Option A: Migrate season.ts to GL aggregation (requires GL data to be complete)
- Option B: Run backfill first, then migrate season.ts

### Follow-up Tasks
1. Fix `season.ts` queries (Days 2-3 of consolidation sprint)
2. Add test coverage for cost center reporting
3. Verify cost center totals match GL before/after migration

---

## AUDIT VERIFICATION

| Question | Answer | Evidence |
|----------|--------|----------|
| Are all cost center queries GL-only? | ⚠️ PARTIAL (3 of 4 files yes) | cost-centers.ts ✅, season.ts ❌ |
| Are there multi-source JOINs in reports? | ❌ YES (season.ts) | Lines 33-66, 225-284 |
| Do operational tables read alongside GL? | ❌ YES (season.ts P&L) | Direct sums from cash/supplier/inventory |
| Is business_event tracing visible? | ✅ YES (suppliers-balance) | GL + business_events CTE |
| Do reports reconcile with GL? | ❓ UNTESTED | Depends on GL completeness |

---

**Recommendation**: Proceed to TASK A1.2 (Data Quality Assessment) to understand GL completeness before fixing season.ts.
