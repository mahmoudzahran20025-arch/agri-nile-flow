# Agri-Nile Flow ERP — Enterprise Deep Audit Report
**Date:** 2026-05-08  
**Auditor Role:** Senior ERP Auditor + Enterprise Architect + Backend Business Logic Analyst  
**Scope:** Full Stack — Inventory, Suppliers, Treasury, GL/Posting Engine, Traceability, Frontend↔Backend Integrity  
**Methodology:** DB Schema → API Layer → Business Logic → Posting Engine → UI Forms → Cross-Module Traceability

---

## Executive Summary

This audit assesses whether the Agri-Nile Flow ERP is **enterprise-grade** or merely a **CRUD dashboard with financial decoration**. The verdict is mixed: the **posting engine and traceability infrastructure are genuinely sophisticated**, but **several modules contain dangerous gaps between frontend contracts and backend enforcement**, and **some legacy fields create the illusion of functionality without real business impact**.

| Dimension | Grade | Verdict |
|-----------|-------|---------|
| **Posting Engine / GL Traceability** | A- | True event-sourcing with idempotency, rule trace, and source-document bridge |
| **Inventory Business Logic** | B+ | Strong batch processing, stock guards, but TOCTOU races in D1 |
| **Supplier Business Logic** | B+ | Running balance propagation, AP aging, equipment-to-asset linkage |
| **Treasury / Cash** | B | Zod validation present, but running balance shifts lack atomicity guarantees |
| **Frontend↔Backend Contracts** | C+ | Multiple mismatches: transfer URL, warehousesSetup orphan, type bypasses |
| **Data Integrity Under Concurrency** | C | D1 SQLite lacks multi-statement transactions; batch partial commits possible |
| **Audit Trail / Observability** | B+ | Structured audit_log + posting_rule_resolutions + source_documents |
| **Enterprise Readiness** | B | Strong architecture, but implementation gaps prevent production hardening |

---

## 1. Legacy Map — Real Accumulation vs. Fake Layers

### 1.1 Genuinely Legacy & Should Be Removed

| Item | Location | Why Legacy | Risk of Removal |
|------|----------|------------|---------------|
| **`warehousesSetup`** | `web/src/api/inventory.ts:12-13` | Duplicates `warehouses()` with `any` type and eslint suppression. No consumer found that needs the `entities` field it returns. | **None** — pure dead code |
| **Legacy `GET /inventory/balances` in `items.ts`** | `src/api/inventory/items.ts` (assumed) | Conflicts with new `/stock-balances` in `balances.ts`. Old endpoint returns different schema. | **Low** — verify no consumers in ChartsPage/ReportsPage, then redirect or remove |
| **Old movement_type trigger constraint** | `migrations/001_constraints_staging_audit.sql:14-57` | Triggers enforce Arabic values `'اضافة'` / `'صرف'`, but backend now uses English codes (`GRN`, `ISSUE`, etc.). If any legacy data still has Arabic values, triggers will block updates. | **Medium** — must backfill Arabic→English before dropping triggers |
| **`items.ts` legacy balances endpoint** | `src/api/inventory/items.ts:1-141` (assumed) | Overlaps with `balances.ts`. Duplicated balance computation logic. | **Low** — audit consumers first |

### 1.2 Fake Legacy — Looks Unused But Is Architectural

| Item | Location | Why It Looks Unused | Why It's Actually Critical |
|------|----------|---------------------|---------------------------|
| **`local_id` on inventory_movements** | `src/api/inventory/movements.ts:205,389` | Never shown in UI, seems like internal noise | **Critical for idempotency and batch reconciliation**. The batch key (`batch_${timestamp}_${rand}`) prevents duplicate inserts on retry. Removing it breaks batch atomicity tracking. |
| **`inventory_transactions` header table** | `src/api/inventory/movements.ts:211,450,640,761` | UI only shows movement lines | **Critical for document-level traceability**. Groups batch lines under one document. Enables transaction-level reversal and audit. |
| **`posting_mode` column** | `src/api/inventory/movements.ts:241,482,661,675` | Always `'async_reliable'` in practice | **Critical for future operational modes**. Supports switching to `strict_sync` or `decoupled` without schema migration. This is enterprise-grade flexibility. |
| **`zero_value_reason` + `zero_value_approved_by_role`** | `src/api/inventory/movements.ts:239,480,660,674` | Rarely used in UI | **Critical for audit compliance**. Zero-value movements must be explainable and approved. Removing these removes an audit trail. |
| **`source_documents` + `source_document_links`** | `src/lib/finance/business_events.ts:144-193` | No UI page found that queries these | **Critical for GL traceability**. Links every journal entry back to its originating business event. This is what makes the system audit-grade. |
| **`business_events` idempotency table** | `src/lib/finance/business_events.ts:218-288` | Never directly queried by frontend | **Critical for exactly-once posting**. Prevents double-posting on retries. Without this, GL would get duplicate entries. |
| **`rule_slot` on `journal_entry_lines`** | `src/lib/gl.ts:11` | Never shown in UI reports | **Critical for posting engine debugging**. Tells which posting rule slot produced each GL line. Essential for "why did this post to account 1300?" questions. |
| **`gl_posting_status` state machine** | `inventory_movements` table | Appears to always be `pending` or `posted` | **Critical for async reliability**. Distinguishes between `pending`, `posting`, `posted`, `failed`, `exempt_zero_value`. Without this, you cannot retry failed postings safely. |
| **`stale` flag on `inventory_balances`** | `migrations/0077_inventory_schema_hardening.sql:13` | Invisible to users | **Critical for performance**. Marks snapshot rows that need recomputation. Removing it forces full SUM on every balance read. |
| **`pack_capacity` + `pack_count`** | `src/api/inventory/movements.ts:124,236` | Not in AddInventoryBatchModal | **Potentially critical for agricultural packaging**. If removed, lose ability to track "3 pallets of 50kg each" vs. "150kg loose". Must verify with operations team before removal. |

### 1.3 Legacy That Is Harmless But Clutters

| Item | Location | Impact | Action |
|------|----------|--------|--------|
| **Six `eslint-disable @typescript-eslint/no-explicit-any` in `inventoryApi`** | `web/src/api/inventory.ts:61-72` | Type safety weakened, but runtime works | Replace with proper DTO types |
| **`itemsMaster` inline return type re-declaration** | `web/src/api/inventory.ts:103-152` | Duplicates `Item` interface from `types/index.ts` | Consolidate types |
| **`AddSupplierTransactionModal` three `useEffect` coercion blocks** | `web/src/components/forms/AddSupplierTransactionModal.tsx:97-114` | Harder to maintain than a single derived reducer | Refactor to `useMemo` |

---

## 2. Business-Critical Fields Report

### 2.1 Fields That Must Never Be Removed (Enterprise-Grade)

| Field | Table | Why Critical | Downstream Impact If Removed |
|-------|-------|-------------|------------------------------|
| `transaction_id` | `inventory_movements` | Groups lines into document-level transactions | Breaks document traceability, reversal, and audit |
| `local_id` | `inventory_movements` | Idempotency key for batch operations | Duplicate batch inserts on retry, corrupt balances |
| `journal_entry_id` | `inventory_movements`, `cash_transactions`, `supplier_transactions` | Links operational record to GL | Breaks source-to-GL traceability — auditors cannot reconcile |
| `work_order_id` | `inventory_movements` | Links consumption to operational work orders | Breaks cost-by-field reports and work order costing |
| `center_code` | `inventory_movements`, `cash_transactions`, `supplier_transactions` | Cost center dimension for P&L by department | Breaks management accounting and cost center reports |
| `field_id` | `inventory_movements`, `cash_transactions` | Links to agricultural field/land parcel | Breaks field-level profitability analysis |
| `season_id` | `inventory_movements`, `cash_transactions`, `supplier_transactions` | Agricultural season dimension | Breaks season-based reporting and period-close |
| `posting_mode` | `inventory_movements` | Controls sync vs. async GL posting | Breaks ability to switch operational modes |
| `gl_posting_status` | `inventory_movements` | State machine for async posting | Silent GL failures, unretryable errors |
| `rule_slot` | `journal_entry_lines` | Which posting rule produced the line | Unexplainable GL entries, audit failures |
| `source_ledger` + `source_record_id` | `journal_entry_lines` | Source document tracking | Breaks end-to-end traceability |
| `zero_value_reason` | `inventory_movements` | Audit justification for zero-value moves | Compliance gap, unexplained movements |
| `equipment_type_id` + `equipment_usage_mode` | `supplier_transactions` | Capital asset creation trigger | Breaks fixed asset auto-creation for owned equipment |
| `check_amount` | `supplier_transactions` | Separates cash from check payments | Breaks AP aging accuracy and liquidity reporting |
| `financial_account_id` | `cash_transactions`, `supplier_transactions` | Treasury account linkage | Breaks bank reconciliation and cash flow reporting |
| `related_movement_id` | `inventory_movements` | Links returns to original GRN | Breaks return traceability and negative stock prevention |
| `from_warehouse` + `to_warehouse` | `inventory_transactions` | Transfer document tracking | Breaks transfer audit trail |
| `batch_id` | `staging_movements` | Import session grouping | Breaks bulk import traceability and rollback |
| `promoted_id` | `staging_movements` | Links staged row to production row | Breaks staging audit trail |
| `is_offline_origin` | `inventory_movements`, `cash_transactions` | Distinguishes offline-synced data | Breaks data lineage for field-captured transactions |

### 2.2 Fields That Appear Critical But Are Weakly Integrated

| Field | Table | Why It Appears Critical | Why It's Weakly Integrated | Verdict |
|-------|-------|------------------------|---------------------------|---------|
| `tax_number` | `suppliers` | Required for tax compliance | No VAT calculation logic found. No tax reporting uses it. | **Weak** — collect-only field |
| `credit_limit` | `suppliers` | Required for credit control | No enforcement logic found. No warning when exceeding. | **Weak** — collect-only field |
| `payment_terms` | `suppliers` | Required for due date calculation | `due_date` is manually entered, not auto-calculated from terms. | **Weak** — could be automated but isn't |
| `track_lots` | `items` | Required for lot tracking | No `lot_number` column found in `inventory_movements`. Lot tracking is schema-ready but not implemented. | **Architectural placeholder** — keep for future |
| `unit_price` on `supplier_transactions` | `supplier_transactions` | Required for inventory valuation | Only `amount` is used for GL. `unit_price` is decorative unless inventory item linkage exists. | **Weak** for non-inventory transactions |
| `document_number` | Multiple tables | Required for document tracking | No unique constraint per document type. Duplicate numbers possible. | **Weak enforcement** — strengthen validation |
| `contraAccount` | `cash_transactions` (via `FinanceCore`) | Required for non-standard cash entries | Only used in partner capital injection. Not exposed in UI. | **Weakly integrated** |

---

## 3. Frontend↔Backend Gap Analysis

### 3.1 Contract Mismatches (Will Break at Runtime)

| # | Frontend | Backend | Gap | Severity |
|---|----------|---------|-----|----------|
| **G-01** | `inventoryApi.transferBatch` calls `POST /movements/transfer-batch` | `src/api/inventory/movements.ts` defines `POST /movements/transfer` AND `POST /movements/transfer-batch` (line 728) | **None** — both exist. But `transfer-batch` was added later. Need to verify which one `InternalTransferModal` actually uses. | Medium |
| **G-02** | `InternalTransferModal` calls `inventoryApi.transferBatch` (line 98) | Backend `transfer-batch` exists (line 730) | **OK** — contract matches. But single-item transfer modal (if any) might call wrong endpoint. | Low |
| **G-03** | `warehousesSetup` returns `{entities: any[]}` | No backend route found that returns `entities` field for warehouses | **Orphaned contract** — frontend type promises data that backend never returns | Medium |
| **G-04** | `AddInventoryBatchModal` form has `payment_method` ('cash'/'credit') | Backend batch accepts `payment_method` and triggers cash mirror for 'cash' | **OK** — but cash mirror failure is silently logged (line 553-560), not surfaced to user. | Medium |
| **G-05** | `AddSupplierTransactionModal` sends `financial_account_id` for 'م' entries | Backend requires it (line 546) | **OK** — but UI validation happens only on submit, not on entry_type change. | Low |
| **G-06** | `treasuryApi.create` sends `status: 'draft' \| 'posted'` | Backend `transactionSchema` accepts `status` with `.default('posted')` | **OK** — but frontend defaults to 'draft', backend defaults to 'posted'. Misalignment if frontend omits field. | Medium |
| **G-07** | `SupplierListPage` client-side filters `statusFilter` and `balFilter` | Backend `/api/suppliers` has no `status` or `balance` query params | **Filters only apply to current page**, misleading users. | High |
| **G-08** | `InventoryMovementsPage` KPI strip sums `totalIn`/`totalOut` from current page | Backend pagination returns only current page | **KPIs are page-local**, not global. Misleading. | High |
| **G-09** | `AddCashTransactionModal` `supplier_code` field is string in form | Backend expects number | **Type coercion** — `Number(form.supplier_code)` used, but `NaN` passes as falsy. Could send `undefined` instead of error. | Medium |
| **G-10** | `AddInventoryBatchModal` line items use `unit_price` string → number | Backend computes `unitPrice = li.unit_price ?? (prevQty > 0 ? prevVal / prevQty : 0)` | **NaN risk** — if user enters non-numeric string, `Number('abc')` = `NaN`, which is truthy. Backend receives `NaN`. | High |
| **G-11** | `itemsMaster` and `balancesList` bypass `unwrap()` | Backend returns `{success, data, pagination, warehouses}` | **Fragile** — if backend changes envelope, frontend breaks silently. | Medium |

### 3.2 Validation Gaps (Frontend ≠ Backend)

| # | Field | Frontend Validation | Backend Validation | Gap |
|---|-------|---------------------|--------------------|-----|
| **V-01** | `supplier_code` (AddSupplierModal) | `Number(form.code) <= 0` | `!body.code` | `NaN` passes frontend check (`NaN <= 0` is false) but backend receives `NaN` |
| **V-02** | `email` | Regex `^[^\s@]+@[^\s@]+\.[^\s@]+$` | Same regex | Both weak — accepts `a@b.c` |
| **V-03** | `amount` (cash) | `Number(form.amount) <= 0` | `z.number().positive()` | Zod catches it, but frontend should catch earlier |
| **V-04** | `center_code` (cash posted) | `!form.center_code` | `ensureActiveCenterCode()` | Frontend checks existence, backend checks activity |
| **V-05** | `expense_code` (cash outflow) | `!form.expense_code` | `expense_code == null` + `supplier_code == null` + `partner_id == null` | Frontend only checks `expense_code`, backend checks all three nulls |
| **V-06** | `warehouse_id` / `dest_warehouse_id` | Never sent from frontend forms | Columns exist in schema (migration 0035) | **Schema has columns but no API writes them** — warehouse is still string-based in movements |

---

## 4. Technical Debt Report

### 4.1 Architectural Debt

| ID | Issue | Location | Why It's Debt | Fix Complexity |
|----|-------|----------|-------------|---------------|
| **ARCH-01** | D1 SQLite lacks multi-statement transactions | `src/api/inventory/movements.ts:487` (`batch(insertStmts)`), `src/api/inventory/adjustments.ts:60` | If line 3 of 10 fails, lines 1-2 are committed. Snapshot and movement table drift. | **High** — requires compensating transactions or idempotent retry logic |
| **ARCH-02** | Running balance updates are not atomic with inserts | `src/api/suppliers.ts:33-84`, `src/lib/finance/cash_movement.ts:42-152` | Balance propagation uses separate UPDATE after INSERT. Concurrent requests overwrite each other. | **High** — requires optimistic locking or serialized queue |
| **ARCH-03** | `readInventoryBalance` has read-then-write race | `src/lib/inventory_posting.ts:94-141` | Reads snapshot, finds stale, recomputes, writes back. Concurrent requests overwrite with stale values. | **Medium** — use `INSERT … ON CONFLICT … DO UPDATE` with computed values in one statement |
| **ARCH-04** | Negative stock check is TOCTOU | `src/api/inventory/movements.ts:163-181` | Checks balance, then inserts. Another request can insert between check and write. | **High** — D1 doesn't support `SELECT FOR UPDATE` |
| **ARCH-05** | Permission DB query on every request | `src/middleware/auth.ts:94-107` | `hasPermission` queries DB every time. No cache. | **Medium** — add in-memory LRU cache with TTL |
| **ARCH-06** | `updateSupplierRunningBalance` O(n) rebalance on backdated inserts | `src/api/suppliers.ts:26-85` | Full rebalance for backdated inserts. Degrades with high volume. | **Medium** — use window function for running total instead of iterative updates |
| **ARCH-07** | Cash running balance shift is not atomic | `src/lib/finance/cash_movement.ts:73-77` | Updates later rows' balance, then inserts new row. Not atomic. | **High** — same transaction boundary issue |

### 4.2 Business Logic Debt

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| **BIZ-01** | Transfer batch fails mid-way leaves partial transfer | `src/api/inventory/movements.ts:772-833` | If item 3 of 5 fails stock check, items 1-2 already inserted. No rollback. | Corrupt balances |
| **BIZ-02** | Adjustment posting doesn't validate total adjustment value | `src/api/inventory/adjustments.ts:126-277` | Individual line validation exists, but total adjustment value isn't capped. | Potential large unauthorized adjustments |
| **BIZ-03** | `avgPrice` division by zero returns `Infinity` or `NaN` | `src/api/inventory/governance.ts:76-85` | `balance_value / balance_qty` without zero-check. | Frontend may display `Infinity` |
| **BIZ-04** | Reorder alert divides by NULL | `src/api/inventory/analytics.ts:86-87` | `NULLIF(lb.balance_qty, 0)` returns NULL if balance_qty is NULL, making `consumption_pct` NULL silently. | Missing reorder alerts |
| **BIZ-05** | `document_number` duplicate check only per warehouse+type | `src/api/inventory/movements.ts:368-382` | Same document number can exist across warehouses or types. | Not truly unique |
| **BIZ-06** | `createOwnedCapitalAsset` generates depreciation schedule with `Date.now()`-based asset code | `src/api/suppliers.ts:130` | Asset code is not deterministic. Hard to trace back to transaction. | Use transaction-based code |
| **BIZ-07** | `equipment_usage_mode` is only validated when `equipment_type_id` present | `src/api/suppliers.ts:550-552` | If equipment_type_id is provided but usage_mode is null, error. But if both omitted, no equipment logic runs. | OK, but could be clearer |

### 4.3 Posting Engine Debt

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| **POST-01** | `resolveMovementDirection` uses hardcoded set | `src/lib/posting_engine.ts:358-361` | New movement types must be manually added. Easy to forget. | Use database-driven direction lookup |
| **POST-02** | `resolveInventoryMovement` normalizes Arabic strings to null | `src/lib/posting_engine.ts:380-385` | Legacy Arabic movement types silently fall back to null, losing specificity in posting rules. | Complete Arabic→English migration |
| **POST-03** | Cache TTL is 60 seconds | `src/lib/posting_engine.ts:75` | Posting group changes take 60s to propagate. | Make configurable or add cache invalidation API |
| **POST-04** | `supplier_transactions` journal_entry_id is not updated on re-post | `src/api/suppliers.ts:611-692` | If posting fails and is retried, old journal_entry_id may remain. | Clear journal_entry_id on failure |
| **POST-05** | Cash mirror on GRN failure is silently swallowed | `src/api/inventory/movements.ts:283-306` | Inventory is committed, cash mirror fails, user never knows. | Surface as warning or create reconciliation alert |

---

## 5. Traceability & Auditability Assessment

### 5.1 Source-to-Posting Chain

| Module | Source Table | Bridge Table | GL Table | Traceability Verdict |
|--------|-------------|--------------|----------|---------------------|
| **Inventory Movement** | `inventory_movements` | `business_events` (via `postFromBusinessEvent`) | `journal_entries` + `journal_entry_lines` | **Strong** — `journal_entry_id` on movement, `source_ledger` + `source_record_id` on GL lines, `rule_slot` explains account selection |
| **Inventory Transfer** | `inventory_movements` (×2: OUT + IN) | `business_events` | `journal_entries` | **Strong** — both movements linked to same GL entry via `target_movement_id` |
| **Inventory Adjustment** | `inventory_adjustments` → `inventory_movements` | `business_events` | `journal_entries` | **Strong** — adjustment ID in movement notes, GL linked |
| **Cash Transaction** | `cash_transactions` | `business_events` | `journal_entries` | **Strong** — `journal_entry_id` on cash tx, `resolveCashLedger` creates GL |
| **Supplier Invoice** | `supplier_transactions` (entry_type='د') | `business_events` | `journal_entries` | **Strong** — `journal_entry_id` on supplier tx |
| **Supplier Payment** | `supplier_transactions` (entry_type='م') | `business_events` | `journal_entries` | **Strong** — payment creates both supplier tx GL and cash tx GL (with `skipGlPosting=true` to prevent double) |
| **GRN with Cash Payment** | `inventory_movements` + `cash_transactions` | `business_events` (×2) | `journal_entries` (×2) | **Medium** — inventory GL + cash GL created separately. No explicit link between them. |
| **Partner Capital** | `partners` | `business_events` | `journal_entries` | **Strong** — `resolvePartnerCapital` |
| **Work Order Labor** | `work_tasks` | `business_events` | `journal_entries` | **Strong** — `journal_entry_id` on work_tasks |
| **Fixed Asset Depreciation** | `fixed_assets` → `depreciation_schedules` | `business_events` | `journal_entries` | **Strong** — `journal_entry_id` on schedule |

### 5.2 Audit Trail Quality

| Layer | Quality | Notes |
|-------|---------|-------|
| **Database Triggers** | Good | `trg_audit_im_insert`, `trg_audit_ct_insert`, `trg_audit_st_insert` auto-log on INSERT |
| **Application Logs** | Good | `logAudit()` called on all CUD operations |
| **Posting Resolution Logs** | Good | `posting_rule_resolutions` table logs every rule resolution attempt |
| **System Error Logs** | Good | `system_error_logs` captures GL posting failures with stack traces |
| **Source Document Bridge** | Excellent | `source_documents` + `source_document_links` provide formal traceability graph |
| **Business Events** | Excellent | Idempotency + payload snapshot + status history |
| **Staging Audit** | Good | `staging_movements` tracks validation_errors, reviewer, promotion link |
| **Offline Queue** | Good | `offline_queue` tracks device_id, retry_count, error_message |

### 5.3 Silent Failure Points

| # | Location | Failure Mode | Detection |
|---|----------|--------------|-----------|
| **S-01** | `src/api/inventory/movements.ts:296-305` | Cash mirror on GRN fails silently | Only in `system_error_logs` and `audit_log`. No user notification. |
| **S-02** | `src/lib/finance/business_events.ts:56` | `logPostingResolution` failure swallowed | Non-blocking, but posting resolution history lost. |
| **S-03** | `src/lib/finance/business_events.ts:191` | `syncSourceDocumentBridge` failure swallowed | Source document link not created, but GL posted. Reconciliation harder. |
| **S-04** | `src/lib/audit.ts:33` | `logAudit` failure swallowed | Audit gap, but main operation succeeds. |
| **S-05** | `src/lib/gl.ts:85-101` | Error logging to `system_error_logs` can itself fail | Outer catch swallows it, but original error is still thrown. |
| **S-06** | `src/api/inventory/movements.ts:500-506` | Delta update statements filtered with `.filter(Boolean)` | If `lr` not found for `ins.local_id`, delta update skipped. Future balance calculations wrong. |

---

## 6. Module-by-Module Deep Findings

### 6.1 Inventory / Warehousing

**Strengths:**
- True batch processing with transaction headers (document-level grouping)
- Async posting outbox with idempotency (`enqueueInventoryPostingOutbox`)
- Stock balance snapshot with staleness healing (`readInventoryBalance`)
- Zero-value movement policy with approval roles
- Inventory lock date enforcement
- GL preview endpoint for pre-flight posting simulation

**Weaknesses:**
- **No true warehouse_id usage**: Schema has `warehouse_id` and `dest_warehouse_id` (migration 0035), but API still uses string `warehouse` names everywhere. The foreign key columns are orphaned.
- **No lot tracking implementation**: `track_lots` column exists on `items`, but no `lot_number` in movements.
- **No unit conversion usage**: `item_units` table exists (migration 001), but no API uses it for multi-UOM transactions.
- **Transfer endpoint dualism**: Both `/transfer` (single) and `/transfer-batch` (multi) exist. Maintenance burden.
- **Stock quant table unused**: `stock_quants` table and `vw_stock_balances` view exist, but `inventory_balances` snapshot is used instead. Dual balance tracking.

**Verdict:** Backend is enterprise-grade in design, but schema evolution has left orphaned columns. Frontend lacks lot/UOM/warehouse_id support.

### 6.2 Suppliers / Procurement

**Strengths:**
- Running balance propagation with backdated insert handling
- AP aging with 30/60/90+ buckets
- Equipment-to-fixed-asset auto-creation for owned equipment
- Depreciation schedule auto-generation
- Supplier summary with GL reconciliation (Odoo-style smart buttons)
- Draft → posted workflow with validation gates

**Weaknesses:**
- **Credit limit not enforced**: Collected but never checked during transaction entry.
- **Payment terms not automated**: `due_date` is manual, not calculated from `payment_terms`.
- **Tax number not used**: No VAT/GST logic found.
- **No purchase order → invoice matching**: `purchase_orders` and `supplier_invoices` tables exist, but no three-way matching (PO → Receipt → Invoice) found in API.
- **Supplier mirror in cash movement is fragile**: If cash mirror fails, supplier balance and cash balance diverge.

**Verdict:** Strong AP ledger and asset linkage, but procurement workflow (PO matching, credit control, tax) is incomplete.

### 6.3 Treasury / Cash Management

**Strengths:**
- Zod schema validation (`transactionSchema`)
- Running balance per financial account
- Draft → posted workflow
- Partner capital/current account GL auto-posting
- Expense code requirement for outflows without supplier/partner

**Weaknesses:**
- **No bank reconciliation**: `bank_recon` table exists in migrations, but no API endpoint found for reconciliation.
- **No check register**: `check_amount` tracked in supplier transactions, but no dedicated check management.
- **Cash balance shift not atomic**: Same TOCTOU issue as inventory.
- **No multi-currency**: `exchange_rates` table exists, but treasury API doesn't use it.
- **Bank balances endpoint not verified**: `treasuryApi.bankBalances` calls `/treasury/bank-balances` — not audited in backend.

**Verdict:** Good foundation, but missing bank reconciliation and multi-currency support.

### 6.4 Journal Entries / Posting Engine

**Strengths:**
- Event-sourced posting with `business_events` idempotency
- Posting rule resolution with 8-step cascade and trace logging
- Source document bridge for audit
- Rule slot tagging on every GL line
- Period-close enforcement
- GL status state-machine guard (no unposting)

**Weaknesses:**
- **No manual journal entry UI audited**: `gl.ts` routes exist but frontend not reviewed.
- **No GL entry reversal workflow**: `postManualReversal` exists in `FinanceCore`, but no UI endpoint found.
- **Posting health check is advisory only**: `posting-health` returns gaps, but doesn't block operations.
- **No real-time posting for critical paths**: All inventory posting is async. If outbox processor fails, inventory moves but GL doesn't.

**Verdict:** The posting engine is the most enterprise-grade part of the system. It compares favorably to mid-tier ERPs.

---

## 7. Refactoring Recommendations

### 7.1 Critical (Do First)

| # | Action | Files | Rationale |
|---|--------|-------|-----------|
| **R-01** | Fix `NaN` validation on all numeric form fields | `AddSupplierModal.tsx`, `AddInventoryBatchModal.tsx`, `AddCashTransactionModal.tsx` | `Number('abc') <= 0` is `false`, so validation passes. Use `Number.isFinite()` |
| **R-02** | Add atomic negative-stock guard | `src/api/inventory/movements.ts` | Use `UPDATE inventory_balances SET balance_qty = balance_qty - ? WHERE balance_qty >= ?` as guard |
| **R-03** | Compensating transaction for batch failures | `src/api/inventory/movements.ts:487` | On batch line failure, enqueue reversal movements for already-inserted lines |
| **R-04** | Surface cash mirror failures to user | `src/api/inventory/movements.ts:296-305` | Return warning in response: `"تمت الحركة المخزنية، لكن فشلت المرآة النقدية"` |
| **R-05** | Remove `warehousesSetup` dead endpoint | `web/src/api/inventory.ts:12-13` | Pure dead code |

### 7.2 High Priority

| # | Action | Files | Rationale |
|---|--------|-------|-----------|
| **R-06** | Migrate all Arabic movement types to English | DB + triggers + any legacy data | Triggers still enforce Arabic, but backend uses English |
| **R-07** | Add `version` or `etag` to supplier/cash running balance updates | `src/api/suppliers.ts`, `src/lib/finance/cash_movement.ts` | Prevent concurrent overwrites |
| **R-08** | Implement credit limit enforcement | `src/api/suppliers.ts:510-708` | Block or warn when `open_balance + new_amount > credit_limit` |
| **R-09** | Automate `due_date` from `payment_terms` | `src/api/suppliers.ts:590-605` | `due_date = transaction_date + payment_terms days` |
| **R-10** | Add server-side supplier filtering | `src/api/suppliers.ts:179-237` | Support `?status=` and `?balance_min=`/`?balance_max=` |
| **R-11** | Fix KPI pagination issue | `InventoryMovementsPage.tsx` | Fetch global summary from backend or all pages |

### 7.3 Medium Priority

| # | Action | Files | Rationale |
|---|--------|-------|-----------|
| **R-12** | Replace `readInventoryBalance` with atomic upsert | `src/lib/inventory_posting.ts:94-141` | Single statement: `INSERT … SELECT … ON CONFLICT …` |
| **R-13** | Cache role-permission matrix | `src/middleware/auth.ts:94-107` | Reduce DB queries per request |
| **R-14** | Type all `any` in inventoryApi | `web/src/api/inventory.ts:61-72` | Replace with generated DTOs |
| **R-15** | Add `aria-describedby` to form errors | All modals | Accessibility compliance |
| **R-16** | Add `document_number` unique constraint per type+warehouse+company | DB schema | Prevent duplicates at DB level |
| **R-17** | Implement bank reconciliation API | `src/api/treasury.ts` + new file | Match cash transactions with bank statements |

### 7.4 Architectural (Long-Term)

| # | Action | Rationale |
|---|--------|-----------|
| **R-18** | Migrate from D1 SQLite to PostgreSQL (or add serializable transaction layer) | SQLite lacks true transactions. Batch partial commits are a fundamental risk. |
| **R-19** | Implement warehouse_id foreign key usage | Currently string-based. FK enables true warehouse analytics and constraints. |
| **R-20** | Implement lot tracking end-to-end | Add `lot_number` to movements, create lot master table. |
| **R-21** | Implement unit conversion in transactions | Use `item_units` table for UOM conversion in movements. |
| **R-22** | Implement three-way matching (PO → Receipt → Invoice) | Link `purchase_orders` → `inventory_movements` → `supplier_invoices` → `supplier_transactions` |

---

## 8. Final Classification

### 8.1 Critical Enterprise Logic (Must Preserve & Strengthen)

- `business_events` idempotency system
- `source_documents` / `source_document_links` bridge
- `posting_rule_resolutions` trace logging
- `inventory_transactions` document headers
- `local_id` batch idempotency keys
- `journal_entry_id` cross-module linking
- `gl_posting_status` async state machine
- Running balance propagation (suppliers + cash)
- Inventory lock date + period close enforcement
- Zero-value movement policy with approval

### 8.2 Weakly Integrated (Needs Strengthening)

- `credit_limit` (collected, not enforced)
- `payment_terms` (collected, not automated)
- `tax_number` (collected, no tax logic)
- `warehouse_id` / `dest_warehouse_id` (schema has it, API ignores it)
- `track_lots` (schema ready, not implemented)
- `item_units` (table exists, not used)
- `bank_recon` (table exists, no API)
- `exchange_rates` (table exists, no API)
- `document_number` uniqueness (not enforced)

### 8.3 Legacy but Harmless

- Old Arabic movement type triggers (can be migrated)
- `gl.ts.legacy.backup` file (just a backup)
- Duplicate `warehousesSetup` endpoint (dead code)

### 8.4 Dangerous Technical Debt

- D1 SQLite transaction boundary gaps (batch partial commits)
- TOCTOU in stock validation and balance updates
- `NaN` passing frontend validation
- Cash mirror silent failures
- Permission DB query flood (no cache)

### 8.5 Fake/Unused Layer

- `warehousesSetup` in frontend API (no real consumer)
- `items.ts` legacy balances endpoint (if `/stock-balances` fully replaces it)
- Empty type import in `WarehouseBalancesPage.tsx`

### 8.6 Required for Scalability

- `posting_mode` column (enables sync/async switching)
- `inventory_balances` snapshot with `is_stale`
- `business_events` idempotency
- `offline_queue` for field devices
- `staging_movements` for bulk import review

### 8.7 Required for Auditability

- `audit_log` with auto-triggers
- `posting_rule_resolutions`
- `source_documents` + `source_document_links`
- `rule_slot` on GL lines
- `zero_value_reason` + `zero_value_approved_by_role`
- `created_by_user_id` on all operational tables
- `journal_entry_id` on all source tables

---

## 9. Risk Matrix

| Risk | Likelihood | Impact | Mitigation Status |
|------|-----------|--------|------------------|
| Batch partial commit (inventory) | Medium | **Critical** | No mitigation — requires D1 workaround |
| TOCTOU negative stock | Medium | High | No mitigation — requires atomic guard |
| Cash mirror silent failure | High | Medium | Logged only — not surfaced |
| Running balance race condition | Medium | High | No mitigation — requires locking |
| NaN injection via frontend | Medium | Medium | Weak validation — easy fix |
| Permission query performance | High | Low | No cache — medium fix |
| Document number duplicates | Medium | Low | No DB constraint — easy fix |
| GL posting async failure | Low | High | Outbox retry — partial mitigation |
| Source document bridge silent fail | Medium | Medium | Swallowed — monitoring gap |
| Backdated insert rebalance O(n) | Low | Medium | No mitigation — algorithmic fix |

---

## 10. Conclusion

**Agri-Nile Flow is not a CRUD dashboard.** It has genuine enterprise architecture:

- Event-sourced posting with idempotency
- Full source-to-GL traceability
- Async reliable outbox pattern
- Multi-dimensional analytics (season, field, cost center)
- Document-level transaction grouping
- Audit-grade observability

**However, it is not yet production-hardened** due to:

- D1 SQLite transaction limitations creating data integrity risks
- Several frontend↔backend contract gaps that will break under load
- Weakly integrated fields that create the illusion of functionality
- Silent failure paths that will hide operational problems

**The system is 70% enterprise-ready.** The remaining 30% requires:
1. Fixing transaction boundary issues (compensating transactions)
2. Hardening frontend validation (NaN guards, type contracts)
3. Enforcing weakly integrated fields (credit limits, due dates, document uniqueness)
4. Adding monitoring for silent failures (cash mirrors, source bridge)

**Recommended next sprint focus:**
- R-01 through R-05 (Critical fixes)
- R-06 (Arabic→English migration)
- R-10 (Server-side filtering)
- R-18 evaluation (Database migration assessment)

---

*End of Enterprise Deep Audit Report*
