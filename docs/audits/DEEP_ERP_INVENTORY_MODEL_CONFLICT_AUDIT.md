# Deep ERP Inventory Model Conflict Audit

## 1. Executive Summary
The Agri-Nile Flow ERP inventory domain contains a latent **Semantic Quantity Conflict**. While the database schema is highly capable—supporting both normalized stock quantities and packaging dimensions—the API and frontend fail to enforce a strict relationship between them. This ambiguity creates a high risk of inventory valuation corruption, particularly where users confuse "Display Quantity" (e.g., 10 bags) with "Normalized Quantity" (e.g., 500 KG), leading to wildly inaccurate `unit_price` calculations. 

The system does not need a complex, over-engineered Unit of Measure (UOM) conversion engine. The existing fields (`pack_count`, `package_capacity`, `quantity`) are sufficient to handle agricultural, manufacturing, and retail needs, provided they are bound by strict mathematical invariants in the posting pipeline.

## 2. Detected Item Models
The ERP currently spreads item semantics across several tables:
1.  **`items`**: The canonical master. Contains base `unit` (TEXT), `package_type`, `package_capacity`, `track_lots`, and `costing_method`.
2.  **`purchase_order_items`**: Tracks `qty_ordered`, `qty_received`, `unit_price`, and `unit`.
3.  **`sales_contracts`**: Hardcodes crop semantics (`quantity_ton`).
4.  **`work_tasks`**: Uses generic `quantity`, `unit`, and `unit_cost` for agricultural operations.
5.  **`harvest_records`**: Uses `qty_tons` and `qty_feddan`.

**Conflict:** The definition of "Item" changes contextually. In sales/harvest, it is strongly typed to agricultural weight (`tons`). In POs and tasks, it relies on free-text `unit` strings, which may not match the base `unit` defined in the `items` master.

## 3. Detected Quantity Models
The ERP persists multiple interpretations of quantity:
-   **Normalized Stock Quantity:** `inventory_movements.quantity`, `qty_in`, `qty_out`, `balance_qty`. This is the canonical ledger value.
-   **Display/Packaging Quantity:** `inventory_movements.pack_count`.
-   **Valuation Quantity:** `inventory_movements.unit_price`. This dictates the financial effect (`quantity * unit_price`).

## 4. Packaging & UOM Findings
-   **Missing Vaporware:** There is no `item_units` or `unit_conversion_rules` table. The system does not support fractional multi-UOM matrices (e.g., 1 Box = 12 Units = 0.5 Pallets).
-   **Existing Capability:** The system natively supports a single-level packaging abstraction via `package_capacity` (e.g., 50) and `package_type` (e.g., "Sack"). 

**Scenario Analysis:** "10 bags × 50 KG"
-   *What should happen:* `pack_count` = 10, `pack_capacity` = 50. The normalized `quantity` = 500. `unit_price` must be calculated per 1 KG.
-   *What happens today:* The UI `LineRow.tsx` exposes `pack_count` and `quantity` as independent cells. There is no auto-computation. A user could enter `pack_count` = 10, `quantity` = 10, destroying stock accuracy.

## 5. Column-Level Semantic Conflicts
-   **`quantity` vs `pack_count`:** They are unlinked. The backend does not validate `quantity == pack_count * pack_capacity`.
-   **`unit_price` (The Valuation Trap):** If a user buys 10 bags of 50 KG for 1000 EGP each, the actual cost is 20 EGP/KG. If the user enters `quantity` = 500 (KG) and `unit_price` = 1000 (thinking per bag), the system records `value_in` = 500,000 EGP instead of 10,000 EGP. This is a catastrophic semantic collision.
-   **`unit` (TEXT):** Because `items.unit` is free-text, there is no enforcement preventing someone from typing "Bag" on an item that is costed in "KG".

## 6. Movement Payload Problems
-   `POST /movements/batch` accepts `quantity` and `unit_price`. 
-   It accepts `pack_count` and `pack_capacity` but does absolutely nothing with them functionally (they are just saved as metadata).
-   It calculates `movementValue = item.quantity * unit_price`. Because of the `unit_price` semantic trap mentioned above, payloads are highly ambiguous.

## 7. Inventory Balance Integrity Risks
The balance engine (`inventory_balances`) correctly sums `qty_in - qty_out` and `value_in - value_out`. 
However, if a semantic payload error occurs (mixing per-bag price with per-kg quantity), the `balance_value` is permanently corrupted. When subsequent `ISSUE` movements occur, they inherit this corrupted moving average, spreading the valuation error into the `wip_ledger` (COGS).

## 8. Legacy Quantity Logic
-   **`receipts.ts` (PO Receiving):** This endpoint maps `po_items.qty_received` directly to `inventory_movements.quantity`. If the PO was issued for "10 Bags" but the inventory is tracked in "KG", the system blindly posts 10 KG into stock. This implicit 1:1 conversion is highly dangerous.
-   **`inventory_adjustment_lines`:** Uses `theoretical_qty` vs `counted_qty`. It assumes these are in base units, but if users count in "boxes", the adjustment will post a massive false variance.

## 9. Existing Hidden Capabilities
-   **Native Packaging:** The schema already holds everything needed to solve the agricultural bulk-item problem (Fertilizers, Seeds, Chemicals) without a complex UOM engine.
-   **Strict Ledger:** The `inventory_movements` table is structurally sound for storing immutable normalized values.

## 10. Canonical Quantity Architecture Recommendation
1.  **Base Unit Supremacy:** Every item must have exactly one base `unit` (e.g., KG, Liter, Piece). All `inventory_movements.quantity` values MUST be in this base unit.
2.  **Strict Normalization Invariant:** The backend API must enforce:
    `IF pack_count IS NOT NULL AND pack_capacity IS NOT NULL THEN quantity MUST EQUAL pack_count * pack_capacity`
3.  **Total Value over Unit Price:** To eliminate the valuation trap, the API and UI should prioritize `total_value` for inbound movements. `unit_price` becomes a read-only computed field: `total_value / normalized_quantity`.

## 11. Canonical Packaging Architecture Recommendation
-   Abandon multi-UOM conversions.
-   Use a "Single Level Aggregate" model. 
-   **Item Master Definition:** An item is defined as "Ammonia Nitrate" -> `unit`: "KG", `package_type`: "Sack", `package_capacity`: 50.
-   **Workspace Entry:** The user enters `pack_count`: 10. The UI automatically locks and calculates `quantity`: 500 KG.

## 12. Required Schema Corrections
-   No tables need to be created. 
-   **Constraint:** Add a database trigger or application-level guard in `movements.ts`: `CHECK (pack_count IS NULL OR quantity = pack_count * pack_capacity)`.
-   **Normalization:** Convert `sales_contracts.quantity_ton` and `harvest_records.qty_tons` to generic `quantity` columns with an explicit `unit` reference, aligning them with the item master.

## 13. Safe Refactors
1.  **Workspace UI Calculation:** Update `LineEditor.tsx` / `LineRow.tsx` to automatically calculate `quantity = pack_count * package_capacity`.
2.  **Workspace Valuation:** Change the UI input from "Unit Price" to "Total Line Value" (الإجمالي) for inbound movements. Auto-compute the unit price.
3.  **Item Master Enforcement:** Make `package_capacity` required in the UI if `package_type` is provided.

## 14. Dangerous Refactors
1.  **Modifying `receipts.ts` blindly:** Fixing the PO receipt quantity mapping without checking existing POs. Existing POs might have been written assuming a 1:1 mapping despite the mismatch.
2.  **Retroactive Quantity Updates:** Do not run UPDATE statements on historical `inventory_movements` to fix unit pricing. Use canonical `ADJUSTMENT_VALUE` transactions.

## 15. Recommended Next Execution Plan
1.  **P0 (UI/UX Guardrails):** Modify the Movement Workspace grid to auto-calculate `quantity` from packaging inputs and switch cost entry to "Total Value" to prevent the `unit_price` semantic trap.
2.  **P1 (API Enforcement):** Add the mathematical invariant check (`quantity == pack_count * pack_capacity`) to `POST /movements/batch`.
3.  **P2 (PO Normalization):** Audit historical Purchase Orders to see if they were written in base units or package units, then rewrite `receipts.ts` to respect packaging capacities during GL/Stock mapping.
4.  **P3 (Master Data Cleanup):** Enforce strict enum values for `items.unit` instead of free-text to prevent normalization drift.