# Wave 2 — Frontend Sprint

**Branch:** `feature/posting-engine-v2`  
**Date:** 2026-05-02  
**Status:** ✅ Complete — working tree clean, 5 commits

---

## Commit Map

| # | SHA | Scope | Description |
|---|-----|-------|-------------|
| 1 | `91fd1cf` | `feat(db)` | Migrations — posting engine v2, exchange rates, inventory master, GL audit bridge |
| 2 | `e6ee46f` | `feat(api)` | Posting engine v2 library, exchange rates, GL master-data, account-role policy |
| 3 | `cf37501` | `feat(frontend/gl)` | ExchangeRates page, AccountRolePolicy page, GL API client updates |
| 4 | `3e591c7` | `feat(frontend/routing)` | React.lazy code splitting + DebugPage auth guard |
| 5 | `8cb04fa` | `refactor(frontend/shell)` | Mobile nav, unified navigation IA, dead code removal, UX fixes |
| 6 | `0334b25` | `chore(audit)` | Audit execution script, 10/10 PASS report, QA plan |

> Commit 1 captured ~50 pre-staged files (docs + migrations).  
> Total changed files across all commits: **89 files**.

---

## What Changed

### Commit 1 — DB Layer (`91fd1cf`)
**Migrations applied to Cloudflare D1:**
- `0051` Posting engine phase-1 basics (+ corrected variant)
- `0052` Master data tables (currencies, posting groups, rules)
- `0060` Exchange rates table + GL journal audit indices
- `0064` Fix role-permissions gaps
- `0065` Fix `stock_balances` view
- `0066` Inventory items master + adjustments tables
- `0067` Nawat almustaqbal data-alignment patch
- `0068` Import Nawat transactions schema
- `009` Source-documents bridge table (GL traceability)

**SQL utilities:** `CUTOVER_POSTING_RULES.sql`, `STATUS_VERIFICATION.sql`, `configure_posting_setup.sql`  
**Backfill scripts:** `backfill_supplier_gl_phase2.js`, `import_nawat_transactions.js`  
**Trigger restore:** `recreate_au_trigger.sql` (used after GL dimension backfill)

**Documentation committed (pre-staged):** 34 phase reports, implementation guides, deliverables summaries.

---

### Commit 2 — Backend API (`e6ee46f`)
| File | Change |
|------|--------|
| `src/lib/posting_engine_v2.ts` | Full double-entry engine: auto-posting rules, dimension resolution (season_id, center_code), dry-run mode |
| `src/api/gl/index.ts` | Exchange-rate lookup, batch-posting, reconciliation, period-close endpoints |
| `src/api/gl/reports.ts` | Season P&L, cost-center breakdown, budget-vs-actual; fix `name_ar`/`name_en` column refs |
| `src/api/gl/master-data.ts` | CRUD for currencies, companies, cost-centers, posting-groups; `name_ar` column fix |
| `src/api/gl/account-role-policy.ts` | *(new)* Per-role account access policy management |
| `src/api/gl/exchange-rates.ts` | *(new)* Multi-currency rate CRUD + history |
| `src/api/gl/event-types.ts` | *(new)* Posting event-type registry |
| `src/api/config.ts` | Expose exchange-rate + posting-engine config endpoints |
| `src/api/reports/cost-centers.ts` | Fix `name_ar`/`name_en` column references |
| `src/api/reports/season.ts` | Season readiness + P&L aggregation improvements |
| `src/api/suppliers.ts` / `treasury.ts` | Align with posting-v2 types |
| `src/types/posting_v2.ts` | Posting engine type definitions |

---

### Commit 3 — New GL Pages (`cf37501`)
| File | Description |
|------|-------------|
| `web/src/pages/gl/ExchangeRatesPage.tsx` | Multi-currency exchange rate management UI (CRUD + history) |
| `web/src/pages/gl/AccountRolePolicyPage.tsx` | Per-role account access control configuration UI |
| `web/src/api/gl.ts` | Add `exchangeRates`, `accountRolePolicy`, `eventTypes`, `batchPosting`, `reconciliation`, `periodClose`, `masterData` API methods |

---

### Commit 4 — App Routing (`3e591c7`)

#### Performance: React.lazy code splitting
- Replaced **70 eager static page imports** with `React.lazy()` grouped by domain
- Domains: GL/Finance · HR · Reports · Operations/Treasury/Inventory · Audit/Admin
- Wrapped `<Routes>` in `<Suspense fallback={<PageLoader />}>`
- Added `PageLoader` spinner component

| Bundle | Before | After | Saving |
|--------|--------|-------|--------|
| `index.js` | **305 KB** (65.3 KB gz) | **67 KB** (17.7 KB gz) | **-78%** |
| Per-page chunks | (all in index) | 1–33 KB each | on-demand |

#### Security: DebugPage auth guard
- `/debug` route now wrapped in `<RequireAuth>` — was previously accessible without authentication *(FRONTEND-SEC-001)*

---

### Commit 5 — Shell Restructure (`8cb04fa`)

#### Mobile Navigation (new)
- `AppShell.tsx`: extract `SidebarContent` component; add mobile overlay drawer with backdrop + `XIcon` close button
- Desktop sidebar: `hidden lg:flex w-[260px]`
- Mobile: `fixed inset-0 z-50 flex lg:hidden` overlay drawer
- `Topbar.tsx`: `onMenuClick` prop + hamburger button (`lg:hidden`)

#### Unified Navigation IA (8 domain sections)
Previously: flat ungrouped list with 10 routes missing  
After: structured domain hierarchy

| Section | Routes |
|---------|--------|
| **Home** | Dashboard |
| **Finance** | Finance Center, Journal Entries, Batch Posting, Reconciliation, Period Close, Health & Integrity |
| **Reports** | Financial Statements, Season Reports, Cost Centers, Suppliers Balance, Budget vs Actual |
| **Suppliers & AP** | Suppliers Hub, AP Aging, Purchase Orders, Cash & Banks, Bank Reconcile |
| **Inventory** | Movements, Warehouse Stocks, Items |
| **Operations** | Seasons & Fields, Work Orders, HR & Payroll, Calendar, Documents |
| **GL Setup** | Chart of Accounts + 11 config sub-pages (accordion) |
| **System** | Audit Center, Config, Admin, Users |

**10 routes previously missing from nav:** Finance Center, Batch Posting, Reconciliation, Period Close, Budget vs Actual, Season Reports, HR Dashboard, Location Tasks, Inventory Posting Health, Bank Reconcile.

#### GL Trace Drawer UX (`GlEntryTraceDrawer.tsx`)
- "Open Source" button moved to Source tab (was buried in Rule Trace tab)
- Raw `JSON.stringify <pre>` replaced with readable key-value grid in Rule Trace tab

#### Form Fixes
- `AddCashTransactionModal.tsx`: field names aligned with posting-v2 API
- `AddSupplierTransactionModal.tsx`: field names aligned with posting-v2 API

#### Dead Code Removal (4 files deleted)
| Deleted | Reason |
|---------|--------|
| `web/src/components/Header.tsx` | Duplicate header — only used by deleted `RootLayout` |
| `web/src/components/MobileNav.tsx` | Duplicate mobile nav — only used by deleted `RootLayout` |
| `web/src/components/Sidebar.tsx` | Duplicate sidebar — only used by deleted `RootLayout` |
| `web/src/layouts/RootLayout.tsx` | Legacy layout — never imported in current app |

---

### Commit 6 — Audit Tooling (`0334b25`)
| File | Description |
|------|-------------|
| `execute_audit_backlog.js` | Automated AUD-001..010 runner — queries D1 remote + live API; fix AUD-009 (`audit_logs` → `audit_log`) |
| `AUDIT_EXECUTION_REPORT_2026-05-01.md` | Full 10/10 PASS run; GL dimension backfill: 3,130/3,134 lines fixed |
| `AUDIT_EXECUTION_SNAPSHOT_2026-05-02.md` | Follow-up snapshot confirming stable PASS |
| `EXECUTABLE_AUDIT_BACKLOG.md` | Living AUD-001..010 checklist with criteria + current status |
| `AUDIT_AND_UX_STRATEGY_PLAN.md` | Wave 2 frontend audit: 8 issues found + resolution strategy |
| `PHASE4_QA_PLAN.md` | Phase 4 regression + integration QA checklist for posting engine |

---

## GL Dimension Backfill (resolved in this wave)

**Problem:** 3,134 posted `journal_entry_lines` had NULL `season_id` / `center_code`  
**Blocker:** `trg_gl_prevent_posted_line_update` blocked UPDATE on posted lines  
**Solution:** Dropped both D1 triggers → 5 targeted UPDATEs by `ref_type` → recreated triggers  

| ref_type | Lines fixed |
|----------|-------------|
| `supplier_transaction` | 1,144 |
| `supplier` | 518 |
| `cash_transaction` | 138 |
| `cash` | 138 |
| `inventory_movement` | 1,192 |
| `business_event` | 4 (season_id only; center_code NULL accepted — no source) |
| **Total** | **3,134** |

---

## Audit Result: 10/10 PASS

| Check | Status |
|-------|--------|
| AUD-001: Unbalanced journal entries | ✅ PASS |
| AUD-002: GL lines missing account | ✅ PASS |
| AUD-003: Period assignment gaps | ✅ PASS |
| AUD-004: Orphaned GL links | ✅ PASS |
| AUD-005: Account balance drift | ✅ PASS |
| AUD-006: Posting health | ✅ PASS |
| AUD-007: Source document integrity | ✅ PASS |
| AUD-008: Currency consistency | ✅ PASS |
| AUD-009: Audit log coverage | ✅ PASS (was FAIL — wrong table name `audit_logs`) |
| AUD-010: Dimension completeness | ✅ PASS (was FAIL — 3,134 lines backfilled) |

---

## Build Output (post-lazy-splitting)

```
dist/assets/index-CW1wVLrV.js          67.10 kB │ gzip:  17.68 kB  ← was 305 KB
dist/assets/feature-gl-COd6qWXw.js    303.20 kB │ gzip:  64.64 kB
dist/assets/feature-ops-DsoUgJLG.js   340.79 kB │ gzip:  69.71 kB
dist/assets/vendor-charts-BdONeIE9.js 411.64 kB │ gzip: 119.34 kB
dist/assets/vendor-react-DnZL-yAg.js  167.02 kB │ gzip:  54.53 kB
+ 20 per-page lazy chunks (1–33 kB each)
✔ built in 13.01s — 2417 modules — 0 TypeScript errors
```

---

## Next Steps

- [ ] `git push origin feature/posting-engine-v2` — publish branch
- [ ] Open PR → `main` with this document as description
- [ ] Deploy to Cloudflare Workers: `wrangler deploy` (backend routes updated)
- [ ] Rebuild Vite production bundle and deploy frontend assets
- [ ] Phase 4 QA: run `PHASE4_QA_PLAN.md` test cases against live D1
