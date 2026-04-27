# Agent Context — Agri-Nile ERP Flow
> اقرأ هذا الملف أولاً في بداية كل جلسة عمل

## Tech Stack
- **Backend**: Hono (TypeScript) on Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite) — remote production DB
- **Frontend**: React 18 + Vite + TanStack Query v5 + Tailwind CSS 3
- **Auth**: JWT via `authMiddleware` + RBAC `roleGuard`
- **Dev Server**: `cd web && npm run dev` → `http://localhost:5173/`

## Current System State (as of 2026-04-27)
```
Suppliers:          286 records
Cash Transactions:  69 records
Inventory Movements: 700 records
Journal Entries:    955+ entries (fully backfilled)
GL Balance:         88,277,909.82 EGP (SUM debit = SUM credit ✅)
Treasury Balance:   -19,801.00 EGP (matches Excel source)
GL Mappings:        19 rows (all flagged deprecated=1; posting-groups is canonical)
Chart of Accounts:  349 accounts
DB Tables:          71 (6 legacy tables dropped in refactor 2026-04-27)
```

## Non-Negotiable Axioms
1. **Draft-to-Post Pattern**: Every financial transaction starts as `status='draft'`. It only affects balances after explicit `POST /:id/post`.
2. **GL Must Balance**: `postAutoEntry()` in `src/lib/gl.ts` throws `GL_UNBALANCED` if debit ≠ credit. Never bypass this.
3. **All GL Posting via FinanceCore**: Route layer must call `FinanceCore.*` methods — never call `postAutoEntry()` directly from routes. FinanceCore is the single GL path.
4. **All Mutations via Hono API**: No direct D1 SQL from the frontend. All writes go through `src/api/*.ts` routes.
5. **Company Isolation**: Every query must include `company_id` from `getUser(c)`. Never query without it.
6. **Audit Trail**: Use `logAudit()` from `src/lib/audit.ts` for all significant mutations.

## Key Files & Patterns
```
src/lib/gl.ts           ← GL primitives ONLY: postAutoEntry, getOpenPeriod, isIntegrationEnabled
                           (glCashTransaction / glInventoryMovement / glPayroll REMOVED — use FinanceCore)
src/lib/finance_core.ts ← FinanceCore — SINGLE GL PATH for all posting
                           recordCashMovement, resolveInventoryMovement, resolveSupplierInvoice,
                           resolvePayrollPosting, resolvePayrollPayment,
                           resolvePartnerCapital, resolvePartnerCurrent
src/lib/posting_engine.ts← Posting-group cascade resolver (BPG/PPG/IPG matrix)
                           Called internally by FinanceCore — do not call directly from routes
src/api/gl.ts           ← GL REST API (accounts, posting-groups, posting-setup, entries, periods)
                           PUT /gl/mappings → 405 LOCKED (legacy, sunset Aug 2026)
src/api/config.ts       ← Config API (seasons, gl-integrations)
web/src/api/client.ts   ← Frontend API client (glApi, configApi, etc.)
```

## API Client Pattern (Frontend)
```typescript
// Single item → unwrap()
const data = await unwrap(api.get<MyType>('/endpoint'))

// Paginated → unwrapPaginated()  
const { data, total } = await unwrapPaginated(api.get('/endpoint?page=1'))

// ALL glApi returns unknown[] — must cast:
const mappings = (await glApi.mappings()) as { mapping_key: string; account_code: string }[]
```

## GL Mapping Keys (legacy — `gl_account_mappings` is deprecated)
> ⚠️ These keys are a fallback only. Canonical setup is via **Posting Groups** (`/gl/posting-setup`).
> All 19 rows flagged `deprecated=1`. Table is read-only (PUT /gl/mappings → 405).

| Key | Purpose | Status |
|-----|---------|--------|
| `cash` | Treasury movements | ✅ |
| `inventory` | Stock movements | ✅ |
| `accounts_payable` | Supplier invoices | ✅ |
| `revenue_default` | Cash receipts | ✅ |
| `expense_default` | Cash payments | ✅ |
| `purchases` | Supplier POs | ✅ |
| `wages` | Payroll accrual | ✅ |
| `cogs` | COGS / Work orders | ✅ |
| `wages_payable` | Wage accruals | ✅ |
| `equity` | Partner capital | ✅ |
| `partner_current_acct` | Partner current account | ✅ |
| `bank` | Bank reconciliation | ❌ Pending |
| `deferred_revenue` | Contract advances | ❌ Pending |
| `receivable_default` | Harvest receivables | ❌ Pending |

## Resolved Issues (Latest Session)
- ✅ **AuditLogPage / ErrorLogPage Crashes**: Fixed backend pagination format in `src/api/audit.ts` to match `unwrapPaginated` expectations, resolving `entries.map is not a function` errors.
- ✅ **ChartOfAccounts Edit/Deactivate**: Added Pencil + PowerOff buttons in table view. Edit Modal via PATCH `/gl/accounts/:code`.
- ✅ **Dashboard GL Health Card & Onboarding**: Added visual widgets for integrity monitoring.
- ✅ **Permissions**: Adjusted Sidebar permissions to allow `company_admin` and `accountant` to view System Health (`finance:read` / `config:read`).
- ✅ **SeasonSummary Empty State**: Fixed hardcoded `seasonId=1`. It now dynamically loads the `activeSeason` to ensure data displays correctly when season 1 doesn't exist.

## Resolved — Suppliers Hub (2026-04-26)
- ✅ **SupplierHubPage created**: `/suppliers` now renders three tabs — `قائمة الموردين` (SupplierListPage), `تحليل الأعمار` (APAgingPage), `أرصدة ملخصة` (SuppliersBalancePage).
- ✅ **APAgingPage (`/treasury/ap`) and SuppliersBalancePage (`/reports/suppliers-balance`)** remain as standalone deep-link routes but are no longer in the Sidebar — discoverable via Suppliers hub tabs instead.
- ✅ **App.tsx** updated: `/suppliers` → `SupplierHubPage` (was `SupplierListPage`). `SupplierListPage` import removed from App.tsx (now imported internally by hub).

## Known Issues & Open Items
- ❌ **No Opening Balance Entry**: Treasury -19,801 came from transactions. No "Balance Forward" JE from 2025.
- ❌ **Harvest GL keys pending**: `bank`, `deferred_revenue`, `receivable_default` still unconfigured in gl_account_mappings (low priority — posting-groups setup is the new path).
- ⏰ **Sunset scheduled Aug 1, 2026**: Remove `GET /gl/mappings` endpoint + legacy UI tab after migration cutoff.

## Resolved — Navigation & RBAC Overhaul (2026-04-26)
- ✅ **Sidebar restructured**: 9 sections (Suppliers/AP, Treasury, Inventory, Ops, HR, GL, Reports, System). Old 5-section flat structure retired.
- ✅ **RBAC gap fixed**: `finance.read`, `finance.write`, `hr.read`, `hr.write` added to permissions table (migration 0033). GL and HR sections now visible to accountant/company_admin.
- ✅ **field_supervisor seeded**: Had 0 permissions. Now has operations/fields/contracts read+write, inventory/reports/hr/suppliers read.
- ✅ **warehouse_mgr fixed**: Now has operations.read → can see Fields, Work Orders, Contracts.
- ✅ **Operations RBAC fixed**: fields/operations/contracts changed from `config.read` → `operations.read` in sidebar.
- ✅ **Unified tabbed pages created**:
  - `/gl/settings?tab=mappings|integrations|periods` → GLSettingsPage (merges 3 separate GL config pages)
  - `/reports/season?tab=summary|pnl|budget|readiness|close` → SeasonReportsPage (merges 5 season report pages)
  - `/audit?tab=log|errors|integrity` → AuditCenterPage (merges 3 audit pages)
- ✅ **Previously invisible pages added to sidebar**: treasury/po, treasury/bank, hr/leaves, reports/cost-centers, gl/settings
- ✅ **Login permissions bug fixed**: `/auth/login` now returns permissions in response. App.tsx refreshes from `/auth/me` on mount.

## Permission Module Names (authoritative)
| Sidebar module | DB module | Notes |
|---|---|---|
| suppliers | suppliers | ✅ match |
| treasury | treasury | ✅ match |
| inventory | inventory | ✅ match |
| operations | operations | ✅ match (was config — fixed) |
| hr | hr | ✅ match (migration 0033 added hr.read/write) |
| finance | finance | ✅ match (migration 0033 added finance.read/write) |
| reports | reports | ✅ match |
| config | config | ✅ match |
| admin | admin | ✅ match |

## Database Commands (for migration scripts)
```bash
# Remote D1 query
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command="SQL" --json

# Run migration
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file=migrations/XXXX.sql
```
