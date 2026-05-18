# Deep Inventory Domain Architecture Audit

## 1. Executive Summary
The Agri-Nile Flow inventory domain has reached a critical architectural inflection point. The underlying database schema is remarkably rich, natively supporting advanced ERP capabilities like multi-level packaging (`pack_capacity`, `pack_count`), lot traceability (`track_lots`, `batch_number`, `expiry_date`), agricultural WIP integration (`field_id`, `season_id`, `crop_cycle_id`), and robust costing methodologies (`moving_average`). 

However, the frontend UI and the API integration layers are severely lagging. The system currently suffers from a "lowest common denominator" phenomenon: because the new Movement Workspace UI does not expose these advanced fields, the APIs do not enforce them, rendering the rich database schema largely dormant. Furthermore, "vaporware" concepts like `unit_conversion_rules` and `stock_quants` still pollute documentation and legacy mental models, despite not existing in the live remote database.

## 2. Current Inventory Architecture
The system employs a **Workspace-first** operational flow backed by a **Ledger-based** valuation engine.
- **Master Data:** `items`, `warehouses`, `item_categories`.
- **Transaction Log:** `inventory_movements` (Authoritative source of all stock history).
- **Valuation & Balances:** `inventory_balances` (An asynchronously healed snapshot table providing O(1) reads for the current stock state).
- **Financial Integration:** An outbox pattern (`inventory_posting_outbox`) decouples physical stock movement from General Ledger journal entry generation.

## 3. Table-by-Table Analysis

| Table Name | Purpose & Lifecycle | Status | Financial Implications |
| :--- | :--- | :--- | :--- |
| `items` | Canonical item master. Defines accounting rules (PPG/IPG) and costing behavior. | **ACTIVE** | High. Dictates how `inventory_movements` are costed and posted. |
| `inventory_movements`| Immutable append-only ledger for all physical stock transactions. | **ACTIVE** | High. Forms the basis of all COGS and inventory asset valuation. |
| `inventory_balances` | Snapshot table for O(1) balance lookups. Healed automatically on drift. | **ACTIVE** | Medium. Read-model only, but critical for concurrent stock validation. |
| `warehouses` | Defines physical or logical storage locations. | **ACTIVE** | Low. Used primarily for dimensional grouping. |
| `stock_quants` | Legacy concept for holding balances. | **DEAD** | None. Does not exist in the remote DB. |
| `item_units` | Intended for unit conversion definitions. | **DEAD** | None. Does not exist in the remote DB. |

## 4. Column-Level Findings (Special Focus on `items` & `inventory_movements`)

### `items` Table
- `track_lots` (INTEGER): Exists and defaults to 0. **Unexposed in UI.** Should dictate whether `batch_number` is required on movements.
- `package_type` / `package_capacity`: Exists. **Unexposed in UI.** Could solve the "1 box = 50kg" requirement natively without complex unit conversion tables.
- `costing_method`: Exists (default: `moving_average`). **Unexposed in UI.**
- `cogs_account_override`: Exists. **Unexposed in UI.** Crucial for agricultural multi-crop accounting.

### `inventory_movements` Table
- `batch_number` / `expiry_date`: Exists. **Unexposed in UI.** Currently dead data.
- `pack_capacity` / `pack_count`: Exists. Can be used to record movements in aggregate units (e.g., 5 boxes of 50kg).
- `zero_value_reason`: Exists and is actively enforced by API governance.
- `warehouse_id`: The canonical foreign key. Legacy `warehouse` (TEXT) still exists but should be deprecated.

## 5. Unit & Packaging Capability Analysis
**Current State:** The system does NOT have a dedicated `item_units` or `unit_conversion_rules` table. The ERP *cannot* currently handle complex UOM matrices (e.g., Purchase in Tonnes, Stock in KG, Sell in Grams).
**Latent Capability:** The `items` schema has `package_capacity`, and `inventory_movements` has `pack_count` and `pack_capacity`. 
**Recommendation:** Instead of building a complex, generic UOM conversion engine, use the existing packaging fields. If an item is "Fertilizer (50kg Bag)", the base unit is KG. `package_capacity` = 50. When receiving 10 bags, the user enters `pack_count` = 10, and the system computes `quantity` = 500 KG. This perfectly covers agricultural operations without over-engineering.

## 6. Inventory Flow Mapping

1. **GRN (Purchase Receipt):**
   - Flow: `MovementWorkspace` -> `POST /inventory/movements/batch` -> `inventory_movements` -> Outbox -> GL.
   - Flaw: Does not enforce Lot Tracking or Expiry Dates despite db support.
2. **ISSUE (Consumption/WIP):**
   - Flow: `MovementWorkspace` -> `POST /inventory/movements/batch`.
   - Flaw: **CRITICAL.** The generic batch endpoint bypasses the `wip_ledger`. Agricultural costs are not posted to crop cycles.
3. **TRANSFER:**
   - Flow: `MovementWorkspace` -> `POST /inventory/movements/transfer-batch`.
   - Generates paired `TRANSFER_OUT` and `TRANSFER_IN` rows. Works well.
4. **ADJUSTMENT:**
   - Flow: `PhysicalCountPage` -> Bypasses Workspace -> injects arbitrary JSON payload.

## 7. Legacy/Duplicate Flow Detection
- **`src/api/inventory/issues.ts`**: **LEGACY/DUPLICATE**. Contains correct WIP logic but is bypassed by the new Workspace.
- **`src/api/inventory/receipts.ts`**: **LEGACY/DUPLICATE**. PO enrichment logic that should be moved to the canonical batch endpoint.
- **Legacy UI Modals (`AddInventoryBatchModal`, `InternalTransferModal`)**: **DEAD**. Already excised from the frontend route tree.

## 8. Financial Integrity Risks
1. **WIP Bypass:** Using the generic Workspace for `ISSUE` movements completely bypasses agricultural cost allocation (`wip_ledger`), causing massive PnL drift.
2. **Missing Optimistic Locking:** `upsertInventoryBalance` lacks a `WHERE version = ?` check, allowing silent overwrites during concurrent stock movements.

## 9. Underutilized Existing Capabilities
- **Lot/Batch Traceability:** The DB is 100% ready for it (`items.track_lots`, `inventory_movements.batch_number`). The UI just needs the input fields.
- **COGS Overrides:** The DB supports item-level COGS account routing, which is essential for splitting costs between different crop types. The UI `ItemMasterPage` does not expose this field.

## 10. Recommended Canonical Inventory Model
- **Base Unit Only + Packaging:** Abandon the idea of generic UOM conversions. Standardize on the smallest operational unit (e.g., KG, Liter) and use `pack_count` * `pack_capacity` for data entry convenience.
- **Strict Ledger Append-Only:** `inventory_movements` must never be updated (except for status/reversal metadata). 
- **Universal Outbox:** Every movement must flow through `inventory_posting_outbox`. No synchronous GL writes.

## 11. Recommended UI/Workspace Simplification
- **Un-stub the Grid:** `LineRow.tsx` currently renders quantity and price as `<div>` placeholders. Convert these to active `<input>` fields immediately.
- **Dynamic Columns:** If the selected item has `track_lots = 1`, the workspace grid should dynamically render `Batch #` and `Expiry` columns.
- **WIP Enforcement:** If a `season_id` or `field_id` is selected in the Dimension Strip, the `wip_ledger` integration MUST be triggered on save.

## 12. Safe Cleanup Candidates
- Delete `web/src/legacy/inventory/` entirely.
- Drop `vw_stock_balances` view from the database (replaced by `inventory_balances` table).

## 13. Dangerous Cleanup Candidates
- **DO NOT** delete `src/api/inventory/issues.ts` yet. The WIP logic inside it must be carefully extracted and merged into `movements.ts` before the file can be safely removed.

## 14. Required Schema Changes
No immediate structural additions are needed. The schema is actually ahead of the application. However, minor cleanups are recommended:
- `ALTER TABLE inventory_movements DROP COLUMN warehouse;` (After ensuring `warehouse_id` is universally populated, to prevent split-brain logic).

## 15. Recommended Next 30-Day Execution Plan
1. **Week 1 (Integrity & Recovery):** Implement Optimistic Locking in `inventory_posting.ts`. Un-stub `LineRow.tsx` so users can actually type quantities.
2. **Week 2 (WIP Convergence):** Port the `wip_ledger` integration logic from `issues.ts` into the canonical `movements.ts` batch endpoint.
3. **Week 3 (Master Data Surface):** Update `ItemMasterPage` (specifically `AccountingEditModal`) to expose `track_lots`, `costing_method`, `cogs_account_override`, and `package_capacity`.
4. **Week 4 (Traceability Rollout):** Update `MovementWorkspacePage` to capture `batch_number` and `expiry_date` during GRN if the item requires lot tracking.