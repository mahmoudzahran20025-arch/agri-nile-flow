# Suppliers & Inventory Module — Comprehensive Audit Report

**Date:** 2026-05-06  
**Scope:** Suppliers (الموردين) + Inventory/Stock (المخازن)  
**Modules excluded:** Finance/GL (except integration points), HR, Payroll  

---

## 1. Executive Summary

| Module | Health Score | Critical Issues | Quick Wins |
|--------|-------------|-----------------|------------|
| **Suppliers Backend** | B+ | 2 | 3 |
| **Suppliers Frontend** | B | 3 | 4 |
| **Inventory Backend** | B+ | 2 | 4 |
| **Inventory Frontend** | B | 4 | 5 |
| **Integration (B↔F)** | C+ | 5 | 6 |

**Top-line verdict:** Both modules are functionally solid with good posting-engine integration, but suffer from **weak TypeScript contracts**, **scattered dead code**, **missing frontend-to-backend feature parity**, and **several business-logic edge cases** that could corrupt inventory balances under concurrent load.

---

## 2. Backend-Frontend Integration Audit

### 2.1 Suppliers — API ↔ UI Mapping

| Backend Endpoint | Frontend Consumer | Status | Issue |
|------------------|-------------------|--------|-------|
| `GET /api/suppliers` | `SupplierListPage` | OK | Weak typing (`unknown`); no server-side filtering for status/balance |
| `GET /api/suppliers/:code` | `SupplierDetailPage` | OK | Weak typing (`unknown` cast) |
| `POST /api/suppliers` | `AddSupplierModal` | OK | No `unwrap`; error path relies on `(res as {success}).success` |
| `PATCH /api/suppliers/:code` | `EditSupplierModal` | OK | Same weak error-handling pattern |
| `POST /api/suppliers/:code/transactions` | `AddSupplierTransactionModal` | OK | Payload shape correct; missing `financial_account_id` validation on backend for credit entries |
| `PATCH /api/suppliers/:code/transactions/:id/post` | `SupplierDetailPage` (bulk + single) | OK | Bulk uses `Promise.allSettled` (good) but no rollback on partial failure |
| `DELETE …/transactions/:id` | `SupplierDetailPage` | OK | `window.confirm` only client-side guard |
| `GET /api/suppliers/:code/statement` | `SupplierDetailPage` | OK | Supports `season_id` + `month` filters correctly |
| `GET /api/suppliers/:code/summary` | `SupplierDetailPage` | OK | Smart buttons consume this correctly |
| `GET /api/suppliers/aging` | **NO CONSUMER FOUND** | STALE | Likely dead UI route |
| `GET /api/suppliers/drafts` | **NO CONSUMER FOUND** | STALE | `PendingApprovalsPage` may consume it but not verified |
| `GET /api/suppliers/:code/statement?download=csv` | `downloadCsv` helper | OK | Utility function exists but not typed |

### 2.2 Inventory — API ↔ UI Mapping

| Backend Endpoint | Frontend Consumer | Status | Issue |
|------------------|-------------------|--------|-------|
| `GET /inventory/balances` (legacy in `items.ts`) | `ChartsPage`, `ReportsPage` (indirect) | LEGACY | Conflicts with new `/inventory/stock-balances` in `balances.ts` |
| `GET /inventory/stock-balances` | `WarehouseBalancesPage` | OK | `balancesList` bypasses `unwrap()` and manually parses response — fragile |
| `GET /inventory/warehouses` | Multiple pages | OK | `warehousesSetup` endpoint (`any` typed) appears duplicate / legacy |
| `POST /inventory/warehouses` | `WarehousesPage` (assumed) | NOT VERIFIED | Not read in this audit |
| `GET /inventory/item/:code/stock` | `AddInventoryBatchModal` (line stock check) | OK | Called per-line; no debounce → potential request spam |
| `GET /inventory/item/:code/card` | `ItemCardPage` | NOT VERIFIED | Route exists in `App.tsx` |
| `GET /inventory/movements` | `InventoryMovementsPage` | OK | Pagination + server-side filters correct |
| `POST /inventory/movements` | **NOT CALLED DIRECTLY** | — | Frontend always uses `/movements/batch` even for single-item moves |
| `POST /inventory/movements/batch` | `AddInventoryBatchModal` | OK | Payload contract matches; `unit_price` optional handling correct |
| `POST /inventory/movements/transfer` (backend) | `InternalTransferModal` | **MISMATCH** | Frontend calls `/movements/transfer-batch` (see `inventoryApi.transferBatch`) — backend route is `/movements/transfer` in `movements.ts` |
| `GET /inventory/transactions` | `TransactionHistoryPage` | NOT VERIFIED | Route exists in `App.tsx` |
| `GET /inventory/transactions/summary` | `TransactionHistoryPage` (assumed) | NOT VERIFIED | — |
| `GET /inventory/cost-by-field` | `CostByFieldPage` | NOT VERIFIED | — |
| `GET /inventory/reorder-alerts` | `WarehouseBalancesPage` | OK | Consumed correctly with `refetchInterval` |
| `GET /inventory/health-summary` | `WarehouseBalancesPage` | OK | Consumed correctly |
| `GET /inventory/posting-health` | `InventoryPostingHealthPage` | NOT VERIFIED | — |
| `GET /inventory/gl-trace` | `GlIntegrityAuditPage` (assumed) | NOT VERIFIED | — |
| `POST /inventory/gl-preview` | `GLPreviewPanel` (inside `AddInventoryBatchModal`) | OK | Contract matches; `TRANSFER_IN`/`TRANSFER_OUT` missing from frontend movement type grid |
| `PATCH /inventory/items-master/:code` | `ItemMasterPage` (assumed) | NOT VERIFIED | — |

### 2.3 Integration Critical Issues

1. **`/movements/transfer` vs `/movements/transfer-batch` mismatch**  
   `web/src/api/inventory.ts:46` calls `POST /inventory/movements/transfer-batch`.  
   `src/api/inventory/movements.ts` defines `POST /movements/transfer` (line ~520+).  
   **Impact:** Internal transfer modal will 404.

2. **`warehousesSetup` duplicate endpoint**  
   `web/src/api/inventory.ts:12-13` defines a second warehouses getter with `any` type and eslint suppression.  
   Likely a leftover from migration.

3. **`itemsMaster` and `balancesList` bypass `unwrap()`**  
   Both functions manually extract `data`, `pagination`, `warehouses` from the raw response.  
   If the backend ever changes its envelope shape, these will silently break.

4. **`GET /inventory/balances` (legacy) still mounted**  
   `items.ts` exposes the old endpoint while `balances.ts` exposes `/stock-balances`.  
   Dual endpoints risk stale consumers reading incorrect schema.

5. **Supplier `aging` and `drafts` endpoints orphaned**  
   No frontend routes or components found that consume these APIs in the audited pages.  
   Either revive the UI or deprecate the endpoints.

---

## 3. Dead Code & Legacy Cleanup

### 3.1 Frontend Dead / Stale Code

| File | Line(s) | Finding | Priority | Effort |
|------|---------|---------|----------|--------|
| `web/src/api/inventory.ts` | 12-13 | `warehousesSetup` with explicit `any` — duplicate of `warehouses` | High | 5 min |
| `web/src/api/inventory.ts` | 61, 64, 66, 68, 70, 72 | Six `// eslint-disable-next-line @typescript-eslint/no-explicit-any` suppressions | Medium | 30 min (add proper types) |
| `web/src/api/inventory.ts` | 136-146 | `itemsMaster` re-declares inline return type instead of re-using `Item` interface | Medium | 15 min |
| `web/src/pages/inventory/WarehouseBalancesPage.tsx` | 9 | `import type { } from '../../types'` — empty import | Low | 1 min |
| `web/src/pages/suppliers/SupplierListPage.tsx` | 166 | `draftMeta` cast to `any`-like shape via `as` instead of typed meta field | Low | 10 min |
| `web/src/pages/suppliers/SupplierDetailPage.tsx` | 312-321 | `centerMap` logic manually re-typing `SupplierTransaction` fields with `as unknown as Record` | Medium | 20 min |
| `web/src/components/forms/AddSupplierTransactionModal.tsx` | 97-114 | Three `useEffect` blocks to coerce form state — could be a single derived state reducer | Low | 30 min |

### 3.2 Backend Dead / Stale Code

| File | Line(s) | Finding | Priority | Effort |
|------|---------|---------|----------|--------|
| `src/api/inventory/items.ts` | 1-141 | Entire file contains legacy `GET /balances` and old warehouse/item endpoints that overlap with `balances.ts` / `governance.ts` | High | Audit consumers then delete or redirect |
| `src/api/suppliers.ts` | ~350+ | `updateSupplierRunningBalance` rebalances on backdated inserts — heavily commented but no automated test reference | Medium | Add test or document |
| `src/api/inventory/governance.ts` | 751+ (unread) | Last ~20 lines not read — may contain unfinished retry logic | Low | Read and decide |

### 3.3 Orphaned Frontend Routes (in `App.tsx` but not audited)

- `PendingApprovalsPage` — may consume `/suppliers/drafts`; verify or remove
- `PhysicalCountPage`, `FixedAssetsPage`, `WipBalancesPage` — exist in router but no corresponding backend audit performed in this scope

---

## 4. Vulnerabilities & Weaknesses Analysis

### 4.1 Security

| ID | Severity | Location | Description | Recommended Fix |
|----|----------|----------|-------------|---------------|
| SEC-01 | Medium | `src/middleware/auth.ts:94-107` | `hasPermission` queries DB on every permission-guarded request. No cache. | Cache role-permission matrix in memory (LRU or KV) with TTL; invalidate on config change. |
| SEC-02 | Low | `src/middleware/auth.ts:123-130` | `roleGuard` only checks string equality; no hierarchical roles (e.g., `company_admin` should imply `accountant`). | Document role hierarchy or implement explicit inheritance. |
| SEC-03 | Medium | `web/src/pages/suppliers/SupplierDetailPage.tsx:287` | `window.confirm` for delete is the only guard; no optimistic locking or version check. | Add `If-Match` or `version` header to prevent concurrent overwrites. |
| SEC-04 | Low | `web/src/components/forms/AddSupplierModal.tsx:64` | Email regex is naive (`^[^\s@]+@[^\s@]+\.[^\s@]+$`); rejects valid emails, accepts invalid ones. | Use a robust validator or HTML5 `type="email"` only. |
| SEC-05 | Medium | `src/api/inventory/governance.ts:224-255` | `PATCH /items-master/:code` dynamically builds SQL SET clause. Column names are hardcoded (safe) but input values are weakly validated (e.g., `standard_cost` could be negative). | Add explicit validation layer: reject negative costs, empty names, etc. |

### 4.2 Business Logic & Data Integrity

| ID | Severity | Location | Description | Recommended Fix |
|----|----------|----------|-------------|---------------|
| BIZ-01 | **Critical** | `src/api/inventory/movements.ts` (~batch insert loop) | D1 SQLite does not support multi-statement transactions. If line 5 of 10 fails, lines 1-4 are committed, 6-10 are not. Snapshot (`inventory_balances`) and movement table become inconsistent. | Implement compensating rollback: on any line failure, enqueue a reversal movement for previously-inserted lines, or switch to a single INSERT with batched values. |
| BIZ-02 | High | `src/lib/inventory_posting.ts:94-141` | `readInventoryBalance` has a read-then-write race: it reads snapshot, finds stale, recomputes from ledger, then writes healed snapshot. Concurrent requests can overwrite each other with stale values. | Use `INSERT … ON CONFLICT … DO UPDATE` atomically in a single statement; avoid read-then-write. |
| BIZ-03 | High | `src/api/inventory/movements.ts` | Negative stock prevention checks `readInventoryBalance` before insert, but another request can insert between the check and the write (TOCTOU). | Use an atomic `UPDATE inventory_balances SET balance_qty = balance_qty - ? WHERE balance_qty >= ?` guard, or enforce in a D1 transaction if available. |
| BIZ-04 | Medium | `src/api/inventory/governance.ts:76-85` | `avgCost` computation divides `balance_value / balance_qty` without zero-check on `balance_qty`. Backend has a ternary but frontend `glPreview` may receive `Infinity` or `NaN`. | Ensure backend returns explicit `null` when `balance_qty === 0`; frontend checks before formatting. |
| BIZ-05 | Medium | `src/api/inventory/analytics.ts:86-87` | `reorder-alerts` divides by `NULLIF(lb.balance_qty, 0)` but doesn't handle the case where `balance_qty` is NULL — `consumption_pct` becomes NULL silently. | Explicitly coalesce to 0 or exclude rows with NULL balance. |
| BIZ-06 | Low | `src/api/inventory/adjustments.ts:191` | Adjustment loss validation checks `absQty > prevQty` but not `absQty === prevQty` (zero balance after adjustment is allowed, which is correct, but should be explicit). | Add comment or make boundary check inclusive (`>=` with explicit policy). |
| BIZ-07 | Medium | `src/api/suppliers.ts` | `updateSupplierRunningBalance` performs a full rebalance on backdated inserts — O(n) per insert. With high-volume suppliers this will degrade. | Consider batching rebalance or using a running-total window function in the query instead of iterative updates. |

### 4.3 Input Validation Gaps

- **`AddSupplierModal`**: `Number(form.code)` where `form.code` is `"abc"` produces `NaN`; `NaN <= 0` is `false`, so validation passes and backend receives `NaN`. Use `Number.isInteger(Number(form.code)) && Number(form.code) > 0`.
- **`AddInventoryBatchModal`**: `Number(l.unit_price)` can be `NaN`; sent to backend as `undefined` only if `!l.unit_price`. A string `"abc"` becomes `NaN` which is truthy, so `NaN` is sent.
- **`EditSupplierModal`**: `is_active` is toggled via `<select value="1"|"0">` but cast with `Number(form.is_active)`. If a malicious value is injected, it passes.

---

## 5. UI/UX Improvements & Form Optimization

### 5.1 Forms

| File | Finding | Recommendation | Effort |
|------|---------|----------------|--------|
| `AddSupplierModal.tsx` | Wizard uses three tabs but all state is in one flat object; no "previous" button on first tab (good) but no progress indicator. | Add step counter or keep tab bar visible. | 15 min |
| `AddSupplierTransactionModal.tsx` | `equipment_type_id` and `equipment_usage_mode` are select fields but use string comparison in `useEffect` to auto-set `entry_type`. | Replace with a single derived state function instead of three effects. | 20 min |
| `AddInventoryBatchModal.tsx` | Line-item grid is not keyboard-navigable; tab order jumps unpredictably. | Add `tabIndex` or refactor to a table with `onKeyDown` navigation. | 1-2 hrs |
| `AddInventoryBatchModal.tsx` | Real-time stock fetch fires on every item selection with no debounce. | Debounce `fetchStock` by 200 ms. | 10 min |
| `AddInventoryBatchModal.tsx` | `TRANSFER_IN`/`TRANSFER_OUT` are missing from the movement type grid (Step 1), but the backend supports them. | Add transfer tile or route to a dedicated transfer modal. | 30 min |

### 5.2 Data Tables & Lists

| File | Finding | Recommendation | Effort |
|------|---------|----------------|--------|
| `SupplierListPage.tsx` | Client-side filtering (`statusFilter`, `balFilter`) on already-paginated data means filters only apply to the current page. | Move filters to server-side query parameters. | 2-3 hrs |
| `SupplierDetailPage.tsx` | `DataTable` `pageSize` is 100 with no option to change. | Add page-size selector (25 / 50 / 100 / 200). | 30 min |
| `InventoryMovementsPage.tsx` | KPI strip (`totalIn`, `totalOut`) sums only the **current page** of movements, misleading users. | Add server-side summary endpoint or fetch all pages for KPIs. | 1-2 hrs |
| `InventoryMovementsPage.tsx` | `GlBadge` links to `/gl/entries` without passing `journal_entry_id` as query param. | Append `?id=${entryId}` for deep-linking. | 5 min |

### 5.3 Accessibility (a11y)

- **Color-only indicators**: Status badges (green/amber/red) have no `aria-label` or text fallback for screen readers.
- **Form errors**: Error `div`s are not linked to inputs via `aria-describedby` or `aria-errormessage`.
- **Modal focus trapping**: `Modal` component not audited; verify focus is trapped and `Escape` closes.
- **RTL support**: Arabic layout is correct (`dir="rtl"`) but some `margin-left` / `margin-right` utilities may break on browser zoom.

### 5.4 Missing Features (opportunities)

1. **Bulk supplier import** (CSV/Excel) — no endpoint or UI found.
2. **Inventory movement approval workflow** — draft exists but no "reject with reason" or "request edit" flow.
3. **Supplier credit limit warning** — `credit_limit` is collected but never surfaced when posting transactions.
4. **Stocktake / physical count reconciliation UI** — `PhysicalCountPage` exists in router but not verified.
5. **Print-friendly supplier statement** — only CSV export is available.
6. **Inventory balance history chart** — `ItemCardPage` presumably shows history, but no sparkline in list views.

---

## 6. Risk Matrix (Heat Map)

| | Likelihood | Impact | Risk Score |
|---|---|---|---|
| **BIZ-01** Batch partial commit | Medium | **Critical** | 🔴 High |
| **BIZ-02** Snapshot race condition | Medium | High | 🟠 High |
| **BIZ-03** Negative stock TOCTOU | Medium | High | 🟠 High |
| **SEC-01** Permission query flood | High | Medium | 🟡 Medium |
| **INT-01** Transfer route 404 | High | Medium | 🟡 Medium |
| **INT-03** `unwrap` bypass fragility | Medium | Medium | 🟡 Medium |

---

## 7. Cleanup Priority & Time Estimates

### Quick Wins (< 30 min each)

1. Fix `transferBatch` URL mismatch (`transfer-batch` → `transfer`).
2. Remove `warehousesSetup` dead endpoint from frontend API.
3. Remove empty type import in `WarehouseBalancesPage`.
4. Add `aria-label` to status badges.
5. Fix `GlBadge` deep-link query param.
6. Replace `Number(x) <= 0` with robust integer validation in modals.

### Short-Term (1-2 hrs)

7. Add server-side `status` + `balance` filters to `GET /api/suppliers`.
8. Debounce `fetchStock` in `AddInventoryBatchModal`.
9. Replace three `useEffect` coercions in `AddSupplierTransactionModal` with derived state.
10. Add `aria-describedby` links between inputs and error messages in all three modals.
11. Fix `itemsMaster` / `balancesList` to use a properly-typed `unwrapPaginated` variant.

### Medium-Term (1-3 days)

12. Implement compensating rollback or single-statement batch insert for inventory movements (BIZ-01).
13. Refactor `readInventoryBalance` to an atomic upsert (BIZ-02).
14. Add atomic negative-stock guard (BIZ-03).
15. Cache role-permission matrix in middleware (SEC-01).
16. Add print-friendly statement view for suppliers.

---

## 8. Appendix: File Reference Index

### Backend (audited)
- `src/api/suppliers.ts`
- `src/api/inventory/index.ts`
- `src/api/inventory/items.ts`
- `src/api/inventory/movements.ts`
- `src/api/inventory/adjustments.ts`
- `src/api/inventory/balances.ts`
- `src/api/inventory/receipts.ts`
- `src/api/inventory/transactions.ts`
- `src/api/inventory/analytics.ts`
- `src/api/inventory/governance.ts` (partial)
- `src/middleware/auth.ts`
- `src/lib/inventory_posting.ts`
- `src/lib/posting_engine.ts`
- `src/lib/finance_core.ts`

### Frontend (audited)
- `web/src/App.tsx`
- `web/src/api/suppliers.ts`
- `web/src/api/inventory.ts`
- `web/src/types/index.ts`
- `web/src/pages/suppliers/SupplierListPage.tsx`
- `web/src/pages/suppliers/SupplierDetailPage.tsx`
- `web/src/pages/inventory/WarehouseBalancesPage.tsx`
- `web/src/pages/inventory/InventoryMovementsPage.tsx`
- `web/src/components/forms/AddSupplierModal.tsx`
- `web/src/components/forms/EditSupplierModal.tsx`
- `web/src/components/forms/AddSupplierTransactionModal.tsx`
- `web/src/components/forms/AddInventoryBatchModal.tsx` (partial)

---

*End of Report*
