# Refactor Plan
Date: 2026-04-27
Last executed: 2026-04-27

## Priority 1: Remove Dead Code ✅ DONE
- [x] Removed dead exports from `src/lib/gl.ts`:
  - `glCashTransaction` — removed
  - `glSupplierTransaction` — removed
  - `glSupplierInvoice` — removed
  - `glInventoryMovement` — removed
  - `glPayroll` — removed (superseded by `FinanceCore.resolvePayrollPosting`)
  - `glWagesPayment` — **kept** (was still active in payroll.ts; migrated to `FinanceCore.resolvePayrollPayment`)
- [x] `resolveCustomerSale` / `resolveCustomerPayment` removed from `posting_engine.ts` (0 external refs; use `resolveSalesRevenue`/`resolveSupplierPayment` directly)
- [ ] Add lint rules for unused imports/exports and enforce in CI
- [x] Zero long commented blocks policy maintained

## Priority 2: Deprecate Old Systems ✅ DONE
- [x] `gl_account_mappings` kept read-only (GET still serves data; writes blocked)
- [x] `PUT /gl/mappings` returns **405** with migration message → `/gl/posting-setup`
- [x] Removed "OLD PATH / dual-path wrapper" comment block from `finance_core.ts`
- [ ] Remove `/gl/mappings` GET endpoint after sunset date (Aug 1, 2026)
- [ ] Publish migration note for admins (posting groups + posting setup mandatory)

## Priority 3: Database Cleanup ✅ DONE
- [x] Reviewed `CLEANUP_SCRIPT.sql` — all candidates confirmed 0 rows
- [x] Executed on production (single-environment setup):
  - `ALTER TABLE gl_account_mappings ADD COLUMN deprecated INTEGER DEFAULT 1` ✅
  - `UPDATE gl_account_mappings SET deprecated = 1` → 19/19 rows flagged ✅
  - `CREATE INDEX IF NOT EXISTS idx_gam_company_key` ✅
  - `DROP TABLE accounts` — was 0 rows ✅
  - `DROP TABLE transaction_mapping_rules` — was 0 rows ✅
  - `DROP TABLE approval_requests` — was 0 rows ✅
  - `DROP TABLE approval_actions` — was 0 rows ✅
  - `DROP TABLE inventory_adjustments` — was 0 rows ✅
  - `DROP TABLE inventory_adjustment_lines` — was 0 rows ✅
- [x] Verified: all 6 dropped tables confirmed absent from `sqlite_master`

## Priority 4: Consolidate Duplicates ✅ DONE
- [x] `accounts` table dropped (0 rows, shadowed by `chart_of_accounts` with 349 rows)
- [x] Archived duplicate migration artifacts (`0043_gl_performance_indexes_final.sql`, `0043_gl_performance_indexes_fixed.sql`) to `archive/` — canonical: `0043_gl_performance_indexes.sql`
- [x] Payroll route normalized to `FinanceCore.resolvePayrollPayment` (new method added to finance_core.ts)

## Priority 5: Fix Integration Risks ✅ DONE
- [x] Eliminated direct `postAutoEntry` calls from `src/api/treasury.ts` (partner capital + current account routes now use `FinanceCore.resolvePartnerCapital` / `FinanceCore.resolvePartnerCurrent`)
- [x] Removed `validateGLMappings` pre-check helper from `src/api/inventory/movements.ts` (FinanceCore validates internally and throws structured errors)
- [x] `src/api/treasury.ts` — removed `postAutoEntry` import entirely; all GL posting now through FinanceCore
- [ ] Add tests for:
  - Inventory -> GL
  - Suppliers -> GL
  - Treasury -> GL
  - Payroll -> GL
- [ ] Add deployment gate using posting setup health endpoint

## Priority 6: Documentation ✅ DONE (2026-04-27)
- [x] Update `docs/AGENT_CONTEXT.md` — fixed stale GL refs, Key Files table, system state, GL mapping table, Known Issues
- [x] Add schema ownership table to `docs/DATABASE_AUDIT_REPORT.md` — module → tables → code owner
- [x] Update `README.md` — bumped to v1.2.0, added GL Architecture (FinanceCore single path) section
- [x] Update `docs/SYSTEM_ARCHITECTURE.md` — date + status update, added Part 0 FinanceCore flow, marked all old Issues as resolved
- [ ] Publish cleanup runbook with staging/prod checklist (future)
- [ ] Add weekly automated audit generation workflow (future)

## Total Estimated Time
8-14 hours (excluding staging/prod rollout windows)

## Execution Log (2026-04-27)
- Removed 5 dead legacy GL helpers from `src/lib/gl.ts` (glCashTransaction, glSupplierTransaction, glSupplierInvoice, glInventoryMovement, glPayroll)
- Removed `resolveCustomerSale` / `resolveCustomerPayment` wrappers from `posting_engine.ts`
- Archived 2 duplicate 0043 migration files to `archive/`
- Added `FinanceCore.resolvePayrollPayment` to `finance_core.ts`
- Migrated `src/api/hr/payroll.ts` from `glWagesPayment` → `FinanceCore.resolvePayrollPayment`
- Locked `PUT /gl/mappings` → 405 (no more mapping writes via legacy API)
- Removed "OLD PATH dual-path" comment block from `finance_core.ts`
- Added `FinanceCore.resolvePartnerCapital` + `FinanceCore.resolvePartnerCurrent` to `finance_core.ts`
- Migrated `src/api/treasury.ts` partner PATCH — removed `postAutoEntry` import and 2 direct calls → FinanceCore methods
- Removed `validateGLMappings` pre-check helper from `src/api/inventory/movements.ts` (both single + batch handlers)
- Executed Priority 3 DB cleanup on live D1: deprecated flag + index on gl_account_mappings; dropped 6 empty legacy tables (accounts, transaction_mapping_rules, approval_requests, approval_actions, inventory_adjustments, inventory_adjustment_lines)
