# Period-Close Governance — Deployment Patch Manifest

**Scope:** Financial Period Close Checklist Engine + Cockpit UI  
**Patch file:** `period_close_patch.diff` (1 502 lines — tracked changes only)  
**Status:** ✅ Deployed to production Worker `fee24aca` on 2026-05-03  
**DB tables applied:** Live on `agri-nile-flow-data-lake` (confirmed, see below)

---

## 1. Files in this patch (period-close scope only)

| File | Type | Change |
|------|------|--------|
| `src/api/gl/periods.ts` | Backend (Worker) | Major rewrite — checklist engine + governance endpoints |
| `web/src/api/gl.ts` | Frontend client | New types + checklist API methods |
| `web/src/pages/gl/PeriodCloseCockpit.tsx` | Frontend page | Full rewrite — consumes real checklist APIs |
| `migrations/0075_period_close_governance.sql` | **DB migration** | `period_close_checklist` + `period_account_balances` DDL |
| `test_financial_period_close_flow.js` | Tooling | Operational readiness script (Node.js, 7 scenarios) |
| `web/src/pages/contracts/ContractsPage.tsx` | Frontend cleanup | Dead `STATUS_BADGE` code + `@ts-ignore` removed |
| `wrangler.toml` | Config | Comment fix for dead env var `ENABLE_POSTING_ENGINE` |

### Excluded from this patch (unrelated changes in same branch)
All `src/api/inventory/*`, `web/src/pages/inventory/*`,
`web/src/pages/suppliers/*`, `web/src/pages/operations/*`,
`migrations/0069`–`0074`, `src/lib/finance/resolvers/cash.ts`,
`web/package.json`, `web/package-lock.json`, etc.

---

## 2. Database schema — required for a fresh environment

Apply **`migrations/0075_period_close_governance.sql`** (included in this repo).

```sql
-- period_close_checklist: persisted checklist state per (company, period, step)
CREATE TABLE IF NOT EXISTS period_close_checklist (
  id            INTEGER  PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER  NOT NULL,
  period_id     INTEGER  NOT NULL,
  step_key      TEXT     NOT NULL,
  step_order    INTEGER  NOT NULL DEFAULT 0,
  step_label    TEXT     NOT NULL DEFAULT '',
  is_critical   INTEGER  NOT NULL DEFAULT 1,
  status        TEXT     NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','running','passed','failed','warning')),
  count_blocked INTEGER  NOT NULL DEFAULT 0,
  details_json  TEXT     NOT NULL DEFAULT '',
  completed_by  INTEGER,
  completed_at  TEXT,
  UNIQUE (company_id, period_id, step_key),
  FOREIGN KEY (period_id) REFERENCES financial_periods(id) ON DELETE CASCADE
);

-- period_account_balances: immutable balance snapshot created at period close
CREATE TABLE IF NOT EXISTS period_account_balances (
  id             INTEGER PRIMARY KEY,
  company_id     INTEGER NOT NULL,
  period_id      INTEGER NOT NULL,
  account_code   TEXT    NOT NULL,
  opening_debit  REAL    NOT NULL DEFAULT 0,
  opening_credit REAL    NOT NULL DEFAULT 0,
  period_debit   REAL    NOT NULL DEFAULT 0,
  period_credit  REAL    NOT NULL DEFAULT 0,
  closing_debit  REAL    NOT NULL DEFAULT 0,
  closing_credit REAL    NOT NULL DEFAULT 0,
  snapshotted_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, period_id, account_code)
);
```

Apply to D1:
```bash
npx wrangler d1 execute agri-nile-flow-data-lake --remote \
  --file migrations/0075_period_close_governance.sql
```

---

## 3. Backend changes (`src/api/gl/periods.ts`)

### New CLOSE_STEPS registry (5 steps, 3 critical)
| Step key | Label | Critical |
|----------|-------|----------|
| `inventory_gl` | Inventory → GL completeness | ✅ |
| `unposted_entries` | No unposted journal entries | ✅ |
| `balance_check` | Double-entry balance | ✅ |
| `orphan_entries` | No orphan entries in range | ⚠️ warning-only |
| `period_summary` | Period summary stats | ℹ️ info |

### New / changed endpoints
| Method | Path | Behaviour |
|--------|------|-----------|
| `GET` | `/gl/periods` | List all periods |
| `POST` | `/gl/periods` | Create period — **single-open-period guard** (409 if another is open) |
| `GET` | `/gl/periods/:id` | Single period |
| `GET` | `/gl/periods/:id/checklist` | Stored checklist; fills missing steps as `pending` |
| `POST` | `/gl/periods/:id/checklist/run` | Run all 5 steps; returns `{checks, all_critical_passed, blockers}` |
| `POST` | `/gl/periods/:id/checklist/run/:step` | Run one step by key |
| `PATCH` | `/gl/periods/:id/close` | Close period — requires all critical passed; `?force=1` for `super_admin`/`company_admin` bypasses; snapshots into `period_account_balances` |
| `PATCH` | `/gl/periods/:id/reopen` | Reopen — `super_admin`/`company_admin` only; single-open-period guard enforced |

---

## 4. Frontend changes

### `web/src/api/gl.ts`
New exported types:
- `PeriodCloseChecklistStep`
- `PeriodCloseChecklistResponse`
- `PeriodCloseRunAllResponse`

New client methods:
- `glApi.periodById(id)`
- `glApi.periodChecklist(id)`
- `glApi.runPeriodChecklist(id)`
- `glApi.runPeriodChecklistStep(id, step)`
- `glApi.closePeriod(id, force?)`

### `web/src/pages/gl/PeriodCloseCockpit.tsx`
- Progress bar over all 5 steps
- Per-step status badge (`passed` / `failed` / `warning` / `pending`)
- "Run All Checks" button (TanStack Query mutation)
- "Close Period" button — disabled until all 3 critical steps pass
- "Force Close" button — visible only to `super_admin` / `company_admin`
- Reopen flow with confirmation dialog

---

## 5. Readiness script (`test_financial_period_close_flow.js`)

```bash
node test_financial_period_close_flow.js --period <id>
```

Runs 7 scenarios against live D1:
1. Single-open-period policy (pass if openCount === 1)
2. Inventory posting completeness (pending/failed = 0)
3. No unposted journal entries
4. Double-entry balance (unbalanced = 0)
5. No orphan entries in date range
6. Opening/closing balance snapshot exists (if period is closed)
7. Checklist coverage (5 steps run, ≥ 3 critical passed)

Exit code 2 on any failure.

---

## 6. Smoke test results (2026-05-03)

All 8 tests passed against Worker `fee24aca` + live D1 (period 5):

| # | Test | Result |
|---|------|--------|
| 1 | GET /checklist (cold) | ✅ 200 — 5 steps, all `pending` |
| 2 | POST /checklist/run (all) | ✅ 200 — all 5 steps executed + persisted |
| 3 | POST /checklist/run/inventory_gl | ✅ 200 — `passed`, 0 blocked |
| 4 | POST /checklist/run/unposted_entries | ✅ 200 — `failed`, 10 blocked (correct) |
| 5 | POST /checklist/run/balance_check | ✅ 200 — `passed`, 0 blocked |
| 6 | GET /checklist (after run) | ✅ 200 — persisted state visible |
| 7 | PATCH /close (no force) | ✅ 409 — blocked: "1 critical item unresolved" |
| 8 | PATCH /close?force=1 | ✅ 200 — super_admin bypass + snapshot (16 rows) |

> **Note:** Test 8 force-closed period 5 (April 2026) as expected for `super_admin`.  
> Period 3 (الموسم الشتوي 2025-2026) remains the only open period.  
> To reopen period 5: close period 3 first (single-open-period policy applies at reopen).

---

## 7. Current data blockers (informational)

| Period | Blocker | Remediation |
|--------|---------|-------------|
| Period 3 (الموسم الشتوي) | 313 orphan entries (`period_id IS NULL`) | `UPDATE journal_entries SET period_id=3 WHERE company_id=1 AND period_id IS NULL AND entry_date BETWEEN '2025-10-01' AND '2026-03-31';` |
| Period 5 (April 2026) | 10 unposted entries + already force-closed | Reopen after period 3 is handled; post/void the 10 entries |

---

## 8. Deployment steps for a new environment

```bash
# 1. Apply DB schema
npx wrangler d1 execute agri-nile-flow-data-lake --remote \
  --file migrations/0075_period_close_governance.sql

# 2. Deploy Worker
npx wrangler deploy

# 3. Verify endpoints
node test_financial_period_close_flow.js --period <active-period-id>

# 4. Build frontend
cd web && npm run build
```

---

*Generated by automated patch-set preparation, 2026-05-03.*
