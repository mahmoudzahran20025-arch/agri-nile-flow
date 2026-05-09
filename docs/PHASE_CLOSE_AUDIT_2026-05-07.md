# Agri-Nile Flow — Finance / Inventory / Suppliers / Posting Phase-Close Audit
**Date:** 2026-05-07  
**Scope:** Finance/GL core, Inventory movements, Supplier AP, Treasury cash, and all posting flows between them.

---

## 1) High-Level Status

- **GL core is structurally solid.** Direct manual journal writes are blocked (`410 GONE` on `POST /gl/entries`). All live GL entries flow through `postFromBusinessEvent`, which enforces idempotency, period-lock checks, source-document bridging, and rule-trace logging.
- **Inventory core is mostly correct but has a critical gap.** Batch warehouse transfers create `inventory_movements` rows (in + out) but **never update the `inventory_balances` snapshot table**. Additionally, a legacy API endpoint (`GET /inventory/balances` in `items.ts`) still queries the dead `vw_stock_balances` view.
- **Supplier AP core is functionally correct.** Invoices post to GL (DR expense / CR AP) and payments post to GL (DR AP / CR cash) while mirroring into the cash journal. However, the treasury mirror path into `supplier_transactions` skips running-balance delta propagation, causing supplier-aging drift on backdated cash payments.
- **Treasury cash journal is clean.** Draft-to-posted promotion, per-account running-balance maintenance, and GL posting via `FinanceCore.prepareCashMovement → resolveCashLedger` are all wired and working.
- **Posting Engine V1 is the active engine.** It contains legacy Arabic literal fallbacks (`وارد`, `صادر`) but is stable. **Posting Engine V2** (`posting_engine_v2.ts`) is fully implemented but has **zero callers**, creating a 398-line maintenance liability.
- **Biggest risks:**
  1. Stale `inventory_balances` after every batch transfer (data integrity).
  2. Supplier balance drift when backdated treasury payments are recorded (AP reconciliation risk).
  3. The dormant `GET /inventory/balances` endpoint returning phantom data from a legacy view (API consumer risk).

---

## 2) Flows Matrix

| Main Flow | Finance/GL | Inventory | Suppliers | Posting | Status & Notes |
|---|---|---|---|---|---|
| **Supplier Invoice** (draft → post) | `resolveSupplierInvoice` → DR expense / CR AP | — | `supplier_transactions` + running balance | `postFromBusinessEvent` | **OK** |
| **Supplier Payment** (direct / draft) | `resolveSupplierPayment` → DR AP / CR cash | — | `supplier_transactions` + cash mirror | `postFromBusinessEvent` | **OK** *(mirror skips balance propagation — see debt)* |
| **Treasury Cash Out / In** | `resolveCashLedger` → DR/CR cash + contra | — | Mirror into `supplier_transactions` if linked | `postFromBusinessEvent` | **OK** |
| **PO Receipt (GRN)** | `resolvePurchaseReceipt` → DR inv / CR AP | `inventory_movements` + `inventory_balances` snapshot | `purchase_orders` status updated | `processPOReceiptOrchestrated` | **OK** |
| **Inventory Movement** (single / batch) | `resolveInventoryMovement` or async outbox | `inventory_movements` + `upsertInventoryBalance` | — | `movements.ts` | **PARTIAL** — cash recorded even on GL failure; batch failure clobbers all lines |
| **Inventory Transfer** (single / batch) | `resolveInventoryTransfer` | `inventory_movements` (in+out) but **NO snapshot update** | — | `movements.ts` | **BROKEN** — `inventory_balances` becomes permanently stale |
| **Harvest → GL** | `postHarvestLedger` (DR AR/CR Rev, DR COGS/CR Inv) | — | — | `postFromBusinessEvent` | **OK** |
| **WIP Carryforward** | `carryForwardWIP` (DR WIP / CR contra) | — | — | `postFromBusinessEvent` | **OK** |
| **Monthly Depreciation** | `postMonthlyDepreciation` (DR dep exp / CR accum dep) | `fixed_assets` + `depreciation_schedules` | — | `postFromBusinessEvent` | **OK** |

---

## 3) Technical Debt Report

### MUST FIX NOW (blocking correctness / stability)

| # | Component / File | Type of Debt | Impact | One-line Fix |
|---|---|---|---|---|
| 1 | `src/api/inventory/movements.ts:860-1049` | Missing snapshot update | **CRITICAL** — `inventory_balances` permanently stale after every transfer | Add `upsertInventoryBalance` calls for both source and destination warehouses after the movement inserts. |
| 2 | `src/api/inventory/movements.ts:1012-1015` | Over-broad failure UPDATE | **CRITICAL** — `LIKE '${batchKey}_%'` overwrites all lines to `failed`, clobbering previously succeeded lines | Scope the failure UPDATE to the specific line's `local_id` (`ins.local_id`). |
| 3 | `src/api/inventory/items.ts:14` | Legacy view query | **HIGH** — `GET /balances` queries `vw_stock_balances` (dead `stock_quants` table) | Rewrite the endpoint to query `inventory_balances` and drop the legacy view from schema. |
| 4 | `src/lib/finance/cash_movement.ts:104-136` | Missing balance propagation | **HIGH** — Treasury mirror into `supplier_transactions` inserts a row with pre-computed balances but never shifts subsequent rows | After inserting the mirror row, call `updateSupplierRunningBalance` (extract shared helper) or propagate delta in the same batch. |
| 5 | `src/api/inventory/receipts.ts` | Missing zero-value policy check | **MEDIUM** — PO receipt can create zero-value inventory movements without `validateZeroValuePolicy` | Add `validateZeroValuePolicy(controls, computedTotal)` before creating movements. |
| 6 | `src/api/inventory/movements.ts:331-343` | Cash/GL desync | **HIGH** — `recordCashMovement()` fires unconditionally after the GL try/catch; if `strict_sync` GL posting failed, cash is still recorded | Move cash recording inside the `strict_sync` success block so it only executes when GL is confirmed. |
| 7 | `src/api/inventory/movements.ts:631-643` | Cash/GL desync (batch) | **HIGH** — Same pattern in batch POST: cash recorded even if any line’s GL posting failed | Move cash recording inside the per-line `strict_sync` success block. |

### FIX SOON (annoying but not blocking day-to-day operations)

| # | Component / File | Type of Debt | Impact | One-line Fix |
|---|---|---|---|---|
| 8 | `src/lib/posting_engine_v2.ts` | Dead code / duplication | **MED** — 398 lines, zero callers. Maintenance drag and confusion. | Decide: wire it behind a feature flag, or delete it from `main` and keep on a branch. |
| 9 | `src/lib/posting_engine.ts` | Legacy dual literals | **MED** — Arabic fallbacks (`وارد`, `صادر`) alongside typed codes create ambiguity | Standardize UI and backend to typed codes (`GRN`, `ISSUE`, etc.) and remove Arabic fallback. |
| 10 | `src/api/inventory/movements.ts:19-26` | Hardcoded vs DB | **MED** — `SUPPORTED_MOVEMENT_TYPES` is a hardcoded Set while `movement_types` table exists | Either query `movement_types` from DB at startup, or drop the dead table. |
| 11 | `src/lib/inventory_posting.ts:150` | Missing optimistic lock | **MED** — `upsertInventoryBalance` has no `expectedVersion`; callers omit version check | Add `expectedVersion: number` to signature and `AND version = ?` in the upsert conflict resolution. |
| 12 | `src/api/inventory/movements.ts:256-257` & `763-765` | Missing tenant filter | **MED** — `local_id` lookups omit `company_id` | Add `AND company_id = ?` to the WHERE clauses. |
| 13 | `src/api/inventory/adjustments.ts:179-230` | Non-atomic loop | **MED** — Adjustment-post loop inserts each movement and updates balance individually; mid-loop failure leaves half-posted document | Collect all movement-insert + balance-update statements into a single `db.batch()`. |
| 14 | `src/api/inventory/movements.ts:553` & `772-778` | Balance update outside batch | **MED** — `upsertInventoryBalance` runs outside the movement `db.batch()` | Append the balance-update statements to the same `db.batch()` as the movement inserts. |
| 15 | `src/api/inventory/movements.ts:446` & `687` & `907` | Missing future negative stock | **MED** — Batch outbound, single transfer, and transfer-batch skip `FUTURE_NEGATIVE_STOCK` validation | Add the future-balance guard query used in the single-POST endpoint before permitting outbound/transfer lines. |

### CAN LIVE WITH (document and park for later)

| # | Component / File | Type of Debt | Notes |
|---|---|---|---|
| 16 | `gl.ts.legacy.backup` & `finance_core.ts.legacy.backup` | Legacy backup files | Keep in repo for reference; do not import into runtime. |
| 17 | `src/api/inventory/balances.ts:169-175` | Dead schema exposure | `GET /movement-types` exposes a table with no active backend consumers. Low risk unless a new UI screen starts using it inconsistently. |
| 18 | `src/api/inventory/analytics.ts:22-23` | Weak join filter | `cost-by-field` joins `seasons s ON s.id = f.season_id` without `s.company_id = f.company_id`. Low risk if seasons are globally unique per company in practice. |

---

## 4) Integration with UI (Frontend / Backend Alignment)

| Screen / Page | API Endpoint Used | Backend File | Verdict | Notes |
|---|---|---|---|---|
| **Inventory Balances** (`InventoryBalancesPage`) | `/inventory/stock-balances` | `balances.ts` | **OK** | Reads from `inventory_balances` snapshot. |
| **Warehouse Balances** (`WarehouseBalancesPage`) | `/inventory/stock-balances` | `balances.ts` | **OK** | Reads from `inventory_balances` snapshot. |
| **Item Stock Modal** (`ItemMasterPage`) | `/inventory/item/:code/stock` | `items.ts` | **OK** | Reads from `inventory_balances` snapshot. |
| **Item Card** (`ItemCardPage`) | `/inventory/item/:code/card` | `items.ts` | **OK** | Reads from `inventory_movements` history. |
| **Inventory Movements** (`InventoryMovementsPage`) | `/inventory/movements` | `movements.ts` | **PARTIAL** | UI filters by Arabic strings (`اضافة`, `صرف`). Backend hardcoded Set also contains Arabic strings. Migrate both to typed codes. |
| **Cash Journal** (`CashJournalPage`) | `/treasury/transactions` + `/treasury/balance` | `treasury.ts` | **OK** | All UI fields (direction, account, season, center) are consumed by backend. |
| **Supplier Detail** (`SupplierDetailPage`) | `/suppliers/:code/statement`, `/summary`, `POST /:code/transactions/:id/post` | `suppliers.ts` | **OK** | Smart buttons and statement correctly wired. |
| **Purchase Orders** (`PurchaseOrdersPage`) | `/finance/purchase-orders` | `purchasing.ts` | **OK** | PO → GRN → Invoice → Payment flow is fully wired. |
| **GL Preview** (Inventory governance) | `/inventory/gl-preview` | `governance.ts` | **OK** | UI passes typed codes; backend handles them correctly. |
| **Stale / Fake endpoint** | `GET /inventory/balances` | `items.ts` | **FAKE** | Queries `vw_stock_balances` (legacy `stock_quants` table). Not used by current React frontend, but is a landmine for API consumers. **Action:** rewrite or delete. |

---

## 5) Final "Phase Close" Checklist

### Legacy Kill List (do now)
- [ ] **Drop `vw_stock_balances` view** from `schema.sql` and execute `DROP VIEW IF EXISTS vw_stock_balances;` on production D1.
- [ ] **Verify `stock_quants` is empty** (or backfill to `inventory_movements` if it holds historic data), then drop the table.
- [ ] **Delete or redirect `GET /inventory/balances`** in `src/api/inventory/items.ts` — replace query with `inventory_balances` or return `410`.
- [ ] **Decide on `movement_types` table** — either make `movements.ts` query it at startup, or drop the table and the `/movement-types` endpoint.
- [ ] **Delete `posting_engine_v2.ts`** from `main` (keep on a feature branch if needed). It is 398 lines of dead code.

### Step-by-step TODO (grouped by area)

#### Finance / GL
- [ ] Verify no frontend screen attempts `POST /gl/entries` directly.
- [ ] Add explicit `company_id` filter to `journal_entry_lines` lookups in `entries.ts` (defensive, even if join already handles it).

#### Inventory
- [ ] **[CRITICAL]** Fix `transfer-batch` snapshot update (`movements.ts:860-1049`): add `upsertInventoryBalance` for both source and destination warehouses.
- [ ] **[CRITICAL]** Fix batch failure clobber (`movements.ts:1012-1015`): scope UPDATE to per-line `local_id`.
- [ ] **[HIGH]** Fix cash/GL desync in single movement POST (`movements.ts:331-343`): move `recordCashMovement` inside the `strict_sync` success block.
- [ ] **[HIGH]** Fix cash/GL desync in batch movement POST (`movements.ts:631-643`): move cash recording inside the per-line success block.
- [ ] **[HIGH]** Rewrite `GET /inventory/balances` (`items.ts:14`) to read from `inventory_balances`.
- [ ] **[MED]** Add `validateZeroValuePolicy` to PO receipt endpoint (`receipts.ts`).
- [ ] **[MED]** Add `FUTURE_NEGATIVE_STOCK` guards to single transfer and transfer-batch endpoints.
- [ ] **[MED]** Include `upsertInventoryBalance` inside the same `db.batch()` as movement inserts for atomicity (single transfer, batch, adjustments).
- [ ] **[MED]** Replace hardcoded `SUPPORTED_MOVEMENT_TYPES` Set with DB query or remove `movement_types` table.

#### Suppliers
- [ ] **[HIGH]** Extract `updateSupplierRunningBalance` into `src/lib/finance/` shared helper and call it after treasury cash mirror inserts (`cash_movement.ts`).
- [ ] **[MED]** Add `company_id` filter to `local_id` lookups in inventory movements (`movements.ts`).

#### Posting Engine
- [ ] **[MED]** Remove Arabic literal fallbacks from `posting_engine.ts` and migrate UI (`InventoryMovementsPage`, `CashJournalPage`) to typed codes.
- [ ] **[MED]** Add `expectedVersion` to `upsertInventoryBalance` signature and enforce optimistic locking in all callers.

### Verification Scripts / Queries
Run these after fixes to confirm system health:

```sql
-- 1. Reconcile inventory snapshot vs movements (should return 0 discrepancies)
SELECT COUNT(*) AS discrepancy_count
FROM inventory_movements im
LEFT JOIN inventory_balances ib
  ON im.item_code = ib.item_code AND im.warehouse = ib.warehouse AND im.company_id = ib.company_id
WHERE im.movement_type LIKE 'TRANSFER%'
  AND (ib.balance_qty IS NULL OR ib.last_updated < im.movement_date);

-- 2. Detect supplier mirror drift (cash mirror rows with mismatched subsequent balances)
SELECT COUNT(*) AS drift_count
FROM supplier_transactions st
WHERE st.local_id LIKE 'st_cash_%'
  AND EXISTS (
    SELECT 1 FROM supplier_transactions st2
    WHERE st2.supplier_code = st.supplier_code
      AND st2.company_id = st.company_id
      AND st2.id > st.id
      AND st2.balance_no_checks != (st.balance_no_checks + (st2.credit - st2.debit))
  );

-- 3. Unbalanced GL entries (integrity check already covers this, but run manually)
SELECT je.id, ROUND(SUM(jel.debit),2) AS dr, ROUND(SUM(jel.credit),2) AS cr
FROM journal_entries je
JOIN journal_entry_lines jel ON jel.entry_id = je.id
WHERE je.company_id = ?
GROUP BY je.id
HAVING ABS(SUM(jel.debit) - SUM(jel.credit)) > 0.01;

-- 4. Pending transfer GL postings
SELECT COUNT(*) FROM inventory_movements
WHERE movement_type IN ('TRANSFER_IN','TRANSFER_OUT')
  AND gl_posting_status = 'pending';

-- 5. Orphan supplier invoices (invoice total vs paid_amount mismatch)
SELECT COUNT(*) FROM supplier_invoices
WHERE total_amount != COALESCE(paid_amount,0) + COALESCE(paid_amount,0)
  AND company_id = ?;
```

### Do NOT touch now (scope freeze)
- Payroll / HR flows (outside this phase).
- Multi-currency wiring (domain of V2, not yet needed).
- Advanced cost-center allocation logic beyond current `season_id` + `center_code` fields.
- Rewriting `posting_engine.ts` into a class-based architecture — the procedural V1 engine works and is well-understood.
- Cloudflare KV caching layer for posting rules (current in-memory 60s cache is sufficient for current scale).

---

*End of Phase-Close Audit.*
