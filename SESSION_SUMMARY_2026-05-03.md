# Session Summary — 2026-05-03
## Posting Engine v2 · GL Integrity Audit · Architectural Gaps Closure

**Branch:** `feature/posting-engine-v2`
**Commit:** `855707a` — tagged `v0.3.0-posting-engine`
**Type-check status:** ✅ Zero errors at close of session

---

## Context

This session continued a multi-session effort to close 6 architectural gaps in the agri-nile-flow ERP.
The gaps were identified in a prior audit (`financial_data_integration_report-opus`) and tracked in the plan file.
All 6 gaps are now **closed**.

---

## Work Completed

### Gap 3 · Payroll Season ID — ✅ Already Done (verified)
`payroll_runs.season_id` column exists (migration 0031). `resolvePayrollPosting` already passes it. No code change needed.

### Gap 5 · Cash-to-Field — ✅ Already Done (verified)
`cash_transactions.field_id` column exists (migration 0032). Treasury API SELECT already includes it.

### Gap 4 · Harvest GL — ✅ Already Done (verified)
`postHarvestLedger()` exists in `src/lib/finance_core.ts` and is called on harvest POST/PATCH.

### Gap 6 · Deferred Revenue Mapping
- **Problem:** `resolveContractAdvance` was posting DR contract_advances / CR cash — completely backwards.
- **Fix:** Corrected to DR Cash (`14010101`) / CR Deferred Revenue (`21300001`).
- **File:** `src/lib/finance/resolvers/operations.ts`

### Gap 2 · WIP Crops (Multi-Season Carry-Forward)
- **Migration:** `migrations/0056_wip_balances.sql` — `wip_balances` table with status workflow (pending → carried → closed)
- **FinanceCore:** `carryForwardWIP()` — finds fields with work_order costs but no harvest_records, sums costs (work_tasks + cash_transactions), posts DR WIP Asset (1302) / CR WIP Contra (3001), inserts `wip_balances` row
- **API:** `GET /config/wip`, `POST /config/wip/:id/assign` — `src/api/config.ts`
- **Frontend:** `web/src/pages/inventory/WipBalancesPage.tsx` — table with status badges, pending-assignment alert, total cost KPI

### Gap 1 · Fixed Assets & Depreciation
- **Migration:** `migrations/0057_fixed_assets.sql` — `fixed_assets` + `depreciation_schedules` tables
- **FinanceCore:** `postMonthlyDepreciation()` — straight-line and declining-balance; DR depreciation_expense (5503) / CR accumulated_depreciation (2203); idempotent per asset per period
- **API:** `src/api/assets.ts` — GET list, POST create (auto-generates schedule rows), GET schedule, POST run-depreciation
- **Frontend:** `web/src/pages/inventory/FixedAssetsPage.tsx` — asset list, add form, per-asset schedule drawer, one-click "ترحيل إهلاك الشهر" button
- **Client:** `web/src/api/assets.ts` — typed API client

---

## Phantom Account Codes — Root Cause & Fix

### Problem
22 of 24 posting setup codes were phantom (non-existent in the real CoA `شجرة_نواة_المستقبل.json`).
Old resolver fallbacks used short codes (2100, 5100, 2101, 1001, 5300, 1590, 1350, 3350) that never existed.

### Remapping Table
| Phantom | Real | Meaning |
|---------|------|---------|
| 2100 | 212000010 | accounts_payable — موردون متنوعون |
| 2101 | 21200001 | wages_payable — مستحقات الرواتب |
| 5100 | 51010001 | wages_expense — الأجور والمرتبات |
| 1001 | 14010101 | cash — خزينة ج.م |
| 5300 → | 5503 | depreciation_expense |
| 6200 → | 5503 | depreciation_expense (old fallback) |
| 1590 → | 2203 | accumulated_depreciation |
| 1690 → | 2203 | accumulated_depreciation (old fallback) |
| 1350 → | 1302 | wip_asset — مشروعات تحت التنفيذ |
| 3350 → | 3001 | wip_contra — رأس المال |

### Fix Layers
1. **`migrations/0080_fix_control_account_codes.sql`** — 10 UPDATE statements fixing `posting_rules` + 8 INSERT OR IGNORE for missing CoA entries + seed new control rules
2. **`migrations/0081_backfill_phantom_account_codes.sql`** — 10 UPDATE statements on `journal_entry_lines` remapping historical entries; each guarded with `EXISTS (SELECT 1 FROM chart_of_accounts WHERE code=?)` safety check
3. **Resolver hardening** — all 4 resolvers now use `resolveControlAccount()` with real CoA fallbacks:
   - `src/lib/finance/resolvers/payroll.ts`
   - `src/lib/finance/resolvers/suppliers.ts`
   - `src/lib/finance/resolvers/operations.ts`
   - `src/lib/finance/resolvers/inventory.ts`
4. **Runtime repair endpoint** — `POST /gl/reconciliation/repair-phantom-accounts` (promotes phantoms to CoA as placeholders) + `POST /gl/reconciliation/backfill-account-codes` (runs remapping for any company_id)

---

## GL Integrity Audit System

### Backend — `src/api/gl/reconciliation.ts`
Three new endpoints:

**`GET /gl/reconciliation/integrity`**
Returns 5-dimensional health check:
```json
{
  "health": "critical|warning|ok",
  "critical_issues": 3,
  "unbalanced_entries": [...],
  "phantom_accounts": [...],
  "ops_vs_gl": { "cash": {...}, "suppliers": {...}, "inventory": {...} },
  "missing_period": [...],
  "duplicate_events": [...]
}
```

**`GET /gl/reconciliation/trial-balance`**
Full trial balance from `journal_entry_lines` with date filter, `is_balanced` flag, `phantom_count`.

**`POST /gl/reconciliation/repair-phantom-accounts`** / **`POST /gl/reconciliation/backfill-account-codes`**
Runtime repair actions callable from the UI.

### Frontend — `web/src/pages/gl/GlIntegrityAuditPage.tsx`
- Health banner (green ✅ / amber ⚠️ / red 🔴) with numeric score
- "تصحيح الحسابات الوهمية" one-click backfill at top
- Collapsible: unbalanced entries table
- Collapsible: phantom accounts table + per-table repair button
- Ops vs GL gap (cash / suppliers / inventory) with ops_total vs gl_total comparison
- Missing period + duplicate events side-by-side cards
- Trial balance section with date range filter (lazy-loaded on demand)

**Route:** `/gl/integrity-audit`

---

## Period-Close Enforcement

### Change
**File:** `src/lib/finance/business_events.ts` — `postFromBusinessEvent()`

A period lock guard was injected at the top of the function, before any DB writes:

```typescript
const lockedPeriod = await db.prepare(
  `SELECT id, name FROM gl_periods
   WHERE company_id = ? AND is_closed = 1
     AND period_start <= ? AND period_end >= ?
   LIMIT 1`
).bind(opts.company_id, opts.event_date, opts.event_date)
  .first<{ id: number; name: string }>()

if (lockedPeriod) {
  throw new Error(
    `GL_PERIOD_LOCKED: الفترة المحاسبية "${lockedPeriod.name}" مغلقة. لا يمكن الترحيل في تاريخ ${opts.event_date}.`
  )
}
```

**Effect:** Every business event (payroll, supplier invoice, inventory receipt, contract advance, harvest, work order) that passes through the single posting pipeline will be rejected if the target GL period is locked. No silent writes into closed periods.

---

## Inventory Module Improvements (earlier in session)

### `src/api/inventory/balances.ts` — full rewrite
- Paginated `GET /balances` with search, warehouse filter, is_stale filter
- Item metadata: PPG / IPG / standard_cost / reorder_threshold
- `GET /balances/:item_code` — all warehouses + totals (total_qty, total_value, avg_cost) + 10 recent movements

### `src/api/inventory/governance.ts`
- `POST /gl-trace/:id/resolve`:
  - `action='exempt'` → marks zero-value movements exempt (rejects non-zero)
  - `action='retry'` → upserts into `inventory_posting_outbox` with status reset

### `web/src/pages/inventory/InventoryBalancesPage.tsx` (new)
Paginated table: warehouse filter, search, stale-only toggle, is_stale badge, click-through to item card.

### `web/src/pages/inventory/InventoryPostingHealthPage.tsx`
Added resolve actions per GL trace row: Ban (exempt zero-value) + RefreshCw (retry) buttons.

---

## Routes Added to App.tsx

| Path | Component |
|------|-----------|
| `/inventory/balances-detail` | InventoryBalancesPage |
| `/inventory/fixed-assets` | FixedAssetsPage |
| `/inventory/wip` | WipBalancesPage |
| `/gl/integrity-audit` | GlIntegrityAuditPage |

---

## Files Changed / Created

### New Files
| File | Purpose |
|------|---------|
| `migrations/0056_wip_balances.sql` | wip_balances table + wip control rules |
| `migrations/0057_fixed_assets.sql` | fixed_assets + depreciation_schedules tables |
| `migrations/0080_fix_control_account_codes.sql` | Fix phantom codes in posting_rules + seed CoA |
| `migrations/0081_backfill_phantom_account_codes.sql` | Backfill historical journal_entry_lines |
| `src/api/assets.ts` | Fixed assets API (list, create, schedule, run-depreciation) |
| `web/src/api/assets.ts` | Frontend API client for assets |
| `web/src/pages/gl/GlIntegrityAuditPage.tsx` | 5-check GL integrity audit dashboard |
| `web/src/pages/inventory/FixedAssetsPage.tsx` | Fixed assets list + add + schedule drawer |
| `web/src/pages/inventory/WipBalancesPage.tsx` | WIP carry-forward balances view |
| `web/src/pages/inventory/InventoryBalancesPage.tsx` | Paginated inventory balances with stale filter |

### Modified Files
| File | Change |
|------|--------|
| `src/lib/finance/business_events.ts` | + Period-lock guard at top of postFromBusinessEvent |
| `src/lib/finance_core.ts` | carryForwardWIP full impl; postMonthlyDepreciation schema fix |
| `src/lib/finance/resolvers/payroll.ts` | Dynamic control account lookups |
| `src/lib/finance/resolvers/suppliers.ts` | Dynamic AP account lookup |
| `src/lib/finance/resolvers/operations.ts` | Fix contract advance direction; dynamic labor accounts |
| `src/lib/finance/resolvers/inventory.ts` | Dynamic AP lookup for purchase receipts |
| `src/api/gl/reconciliation.ts` | + integrity, trial-balance, repair, backfill endpoints |
| `src/api/config.ts` | + GET /wip, POST /wip/:id/assign; season-close calls carryForwardWIP |
| `web/src/api/gl.ts` | + glIntegrity, glTrialBalance, repairPhantomAccounts, backfillAccountCodes |
| `web/src/App.tsx` | + lazy imports and routes for 4 new pages |

---

## Architecture Principles Upheld

- **Single Pipeline Law** — every monetary event flows through `postFromBusinessEvent` → posting engine → GL. Period-lock guard enforces this at the one chokepoint.
- **GL-primary reporting** — integrity audit reads from `journal_entry_lines` as source of truth, not operational tables.
- **Idempotency** — all depreciation and WIP postings check for existing rows before inserting.
- **Defense in depth for phantom codes** — fixed at 3 layers: migration (historical data), resolver fallbacks (new data), runtime endpoint (on-demand repair).
- **Arabic-first UX** — all new pages use `dir="rtl"`, Arabic labels, EGP formatting via `Intl.NumberFormat('ar-EG')`.
