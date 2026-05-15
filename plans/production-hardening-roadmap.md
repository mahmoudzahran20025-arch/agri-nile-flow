# Production Hardening & Business Domain Implementation Plan
**Date:** May 15, 2026
**Status:** PROPOSED (Ready for Execution)

## 1. Physical Schema Hardening (Completed & Verified)
- [x] **Items**: Composite PK `(code, company_id)`, redundant posting columns dropped.
- [x] **Inventory**: TEXT-based warehouse joins removed, Doc numbers recast to `TEXT`.
- [x] **Traceability**: `source_link_id` added to GL for 1:1 sub-ledger mapping.
- [x] **Indexing**: 5 high-performance compound indexes applied.

## 2. Business Domain Implementation (The "Empty DB" Opportunity)

### 2.1 Unit Conversion Engine (UOM)
- **Table**: `unit_conversions`
- **Columns**: `from_unit`, `to_unit`, `factor`, `item_code` (optional).
- **Goal**: Ton -> KG (1000) scaling in GRN/Issue logic.

### 2.2 Packaging Hierarchies
- **Table**: `item_packaging_tiers`
- **Goal**: Define 'Case of 12' or 'Sack of 50kg' for warehouse operators.

### 2.3 AP Integrity: Item-Level Invoicing (3-Way Match)
- **Problem**: Current `supplier_transactions` is a document-level header. We cannot verify if we were over-invoiced for 'Fertilizer' vs 'Seeds' in the same document.
- **Proposed Table**: `supplier_transaction_lines`
  - `txn_id` (FK to `supplier_transactions`)
  - `item_code`, `qty`, `unit_price`, `po_line_id`.
- **Goal**: Full PO -> GRN -> Invoice item-level variance reporting.

### 2.4 Cost Center Hierarchy
- **Column**: `parent_code` in `cost_centers`.
- **Goal**: Recursive rollups (e.g., sum of all fields in "West Sector").

## 3. Frontend API Path Realignment (BLOCKING)

| Logic Area | Frontend Call | New Backend Target |
| :--- | :--- | :--- |
| **AP Aging** | `/finance/ap-aging` | `/suppliers/aging-summary` |
| **3-Way Match** | `/finance/purchase-orders/:id/match` | `/suppliers/purchase-orders/:id/match` (RESTORED) |
| **PO Invoice** | `/finance/purchase-orders/:poId/invoices` | `/suppliers/purchase-orders/:poId/invoices` (RESTORED) |
| **PO Receive** | `/inventory/receive-po/:id` | `/inventory/receive-po/:id` (STAYS) |

## 4. Execution Roadmap (Migration 0121)
1.  **DDL**: Create `supplier_transaction_lines`.
2.  **DDL**: Create `unit_conversions` (Corrected FK).
3.  **DDL**: Create `item_packaging_tiers` (Corrected FK).
4.  **Logic**: Implement `GET /suppliers/purchase-orders/:id/match` in `invoices.ts`.
5.  **Logic**: Implement `POST /suppliers/purchase-orders/:poId/invoices` in `invoices.ts`.
6.  **Frontend**: Batch update `web/src/api/finance.ts` to match new routes.

**DBRE Recommendation**: Proceed with DDL implementation now while the database is empty to ensure 100% referential integrity.
