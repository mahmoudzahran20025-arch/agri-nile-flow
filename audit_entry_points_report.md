# Full System Audit & Operational Unification Plan

## STEP 1 — Map All Entry Points

| Table | File & Line | Caller | GL triggered? | Duplicate risk? |
|-------|-------------|--------|---------------|-----------------|
| `supplier_transactions` | `api/suppliers.ts:798` | UI: `AddSupplierTransactionModal` | **Yes** (`resolveSupplierInvoice`) | **High** (User can enter same invoice twice) |
| `supplier_transactions` | `lib/finance/cash_movement.ts:237` | API: Treasury Payment | No (Cash handles GL) | Low (Mirror only) |
| `inventory_movements` | `api/inventory/movements.ts:498` (GRN) | UI: `AddInventoryBatchModal` | **Yes** (Outbox) | **High** |
| `inventory_movements` | `api/inventory/movements.ts:835` (ISSUE) | UI: `AddInventoryBatchModal` | **Yes** (Outbox) | **High** |
| `inventory_movements` | `api/staging.ts:314` | Mobile App Sync | **Yes** | Low (Handled by UUID) |
| `cash_transactions` | `lib/finance/cash_movement.ts:202` | UI: Treasury forms | **Yes** (`resolveCashLedger`) | Low |
| `work_orders` | `api/operations.ts:209` & `797` | UI: `WorkOrdersPage` | No (Header only) | Low |
| `work_order_equipment`| `api/operations.ts:469` | UI: `WorkOrderEquipmentForm` | **Yes** (`resolveWorkOrderLabor`) | **High** (Parallel to Supplier Tx) |
| `work_order_equipment`| `api/suppliers.ts:844` | UI: `AddSupplierTransactionModal` | No (Supplier Tx handles GL) | Low (Mirror only) |
| `work_tasks` | `api/operations.ts:340` | UI: `WorkOrderTasksForm` | **Yes** (`resolveWorkOrderLabor`) | **High** (Parallel to Supplier Tx) |
| `work_tasks` | `api/suppliers.ts:859` | UI: `AddSupplierTransactionModal` | No (Supplier Tx handles GL) | Low (Mirror only) |

---

## STEP 2 — Actual Duplicates in Current Data

I ran the requested queries against the live `agri-nile-flow-data-lake` remote D1 database.

1. **Supplier Transaction Duplicates (Same Supplier + Date + Amount):**
   - **Found:** 34 duplicate groups. 
   - *Example:* Supplier `20900151` has four identical transactions of EGP 27,000 on 2025-12-02.
2. **Inventory Movement Duplicates (Same Item + Date + Qty + Type):**
   - **Found:** 99 duplicate groups.
   - *Example:* Item `1010002` has 10 identical ISSUE movements of 250 qty on 2026-01-03.
3. **Cross-Table Duplicates (Supplier Tx AND Inventory GRN for same amount/date):**
   - **Found:** 52 exact matches.
   - *Root Cause:* Users are entering a GRN to receive items into inventory AND entering a Supplier Invoice for the exact same transaction, double-booking the liability and expense.

---

## STEP 3 — Map the User Journeys (UX Flows)

### A) تسجيل ساعات ميكنة (Mechanization)
- **Current Paths:** 
  1. User opens `AddSupplierTransactionModal`, selects `SRV_MECH`, and fills the invoice. (Writes to `supplier_transactions` + `work_order_equipment` mirror + GL).
  2. User opens `WorkOrdersPage`, creates WO, and adds equipment. (Writes to `work_order_equipment` + GL).
- **Broken:** Two independent ways to record the same real-world event. 

### B) استلام أسمدة (GRN)
- **Current Path:** User opens `AddInventoryBatchModal` (GRN). (Writes to `inventory_movements` + outbox -> GL).
- **Broken:** The user often also goes to `AddSupplierTransactionModal` to record the supplier's financial liability. This creates the 52 cross-table duplicates identified in Step 2.

### C) صرف أسمدة (ISSUE)
- **Current Path:** User opens `AddInventoryBatchModal` (ISSUE). (Writes to `inventory_movements` + outbox -> GL). 
- **Status:** Clean.

### D) دفع جزء من حساب مورد (Supplier Payment)
- **Current Path:** User opens Treasury form. (Writes to `cash_transactions` -> posts GL -> mirrors to `supplier_transactions` without re-posting GL).
- **Status:** Clean and unified.

### E) تسجيل عمالة يومية (Labor)
- **Current Path:** Same as A (Mechanization). Two parallel paths exist via `AddSupplierTransactionModal` (`SRV_LABOR`) and `WorkOrderTasksForm`.

---

## STEP 4 — Identify Legacy Code

1. **Supplier API without Posting Engine:**
   All `supplier_transactions` correctly route through `FinanceCore.resolveSupplierInvoice`, which encapsulates the posting engine natively.
2. **Forms bypassing Supplier Tx:**
   `POST /api/operations/work-orders/:id/equipment` (called by `WorkOrderEquipmentForm`) creates `work_order_equipment` and posts directly to GL (`resolveWorkOrderLabor`) **without** creating the required AP liability in `supplier_transactions`.
3. **Bypassing `postFromBusinessEvent`:**
   Many `FinanceCore.resolve...` methods directly wrap `postJournalEntry()` internally. This is architecturally sound in V2, but represents the legacy V1 path. 
4. **`execute_posting_job_v2.js`:**
   Located in the `scripts/` directory. A codebase search confirms it is **NOT** called anywhere in the runtime `src/` application. It is strictly a migration/maintenance script.
5. **Hardcoded Date Manipulation:**
   In `src/api/inventory/movements.ts:36-39`, there is an active interceptor catching Excel typos:
   ```typescript
   // Prevent common Excel/Manual typo: 2026-12 instead of 2025-12
   if (corrected.startsWith('2026-12')) {
     corrected = corrected.replace('2026-12', '2025-12')
   }
   ```

---

## STEP 5 — Propose the Clean Unified Flow

**The Principle: One real-world event → one entry point → one GL entry.**

1. **A & E (Mechanization / Labor):**
   - **Entry Point:** `WorkOrdersPage`.
   - **Writes to:** `work_order_equipment` / `work_tasks`.
   - **Action:** When WO is EXECUTED, it auto-generates the `supplier_transaction` (if external) and posts GL.
   - **Remove:** Manual entry of `SRV_MECH`/`SRV_LABOR` via `AddSupplierTransactionModal`.
2. **B (GRN / Receiving Items):**
   - **Entry Point:** `AddInventoryBatchModal` (GRN).
   - **Writes to:** `inventory_movements`.
   - **Action:** When GRN is posted, it auto-generates the `supplier_transaction` for the liability.
   - **Remove:** Manual entry of item invoices via `AddSupplierTransactionModal`.
3. **C (ISSUE):** Remains as-is via `AddInventoryBatchModal`.
4. **D (Payment):** Remains as-is via Treasury Cash form.

---

## STEP 6 — Work Order as the Orchestrator

Currently, if a user creates a Work Order and adds equipment, it **does not** automatically create a `supplier_transaction`. The code in `src/api/operations.ts:469-529` posts to the GL directly. 

**Proposed Solution (What Needs to Change in `operations.ts`):**

When `work_order_equipment` (or `work_tasks`) with a valid `supplier_code` is added, instead of firing `resolveWorkOrderLabor` natively:

```typescript
// IN: src/api/operations.ts (Upon adding external equipment/labor to WO)
const invoiceId = await createSupplierTransaction({
  company_id,
  supplier_code: b.supplier_code,
  amount: equipmentCost,
  entry_type: 'د', // Invoice
  service_type_code: 'SRV_MECH', 
  work_order_id: orderId, // Crucial link
  status: 'posted' // Triggers GL automatically via suppliers API logic
});
// The suppliers API will handle GL and AP accurately, 
// completely eliminating the duplicate risk.
```

---

## STEP 7 — Final Health Check

I executed the final health check against the live remote database:
- `gl_balance`: **0**
- `posted_no_je`: **0**
- `issue_no_service`: **0**
- `executed_wo_no_txn`: **0**

**Conclusion:** 
The GL is perfectly balanced at 0. The system is structurally healthy, but the **UX allows for severe double-entry of costs and liabilities** (52 confirmed cross-table duplicates, 34 supplier duplicates, 99 inventory duplicates). The architecture must transition to "Operations-First" (WO orchestrates Supplier Tx, GRN orchestrates Supplier Tx) to prevent this human error.
