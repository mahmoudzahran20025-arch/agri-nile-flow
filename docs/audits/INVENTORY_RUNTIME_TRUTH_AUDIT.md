# Inventory Runtime Truth Audit

## 1. Executive Summary

The Agri-Nile Flow Inventory domain is in a structurally sound but functionally stalled transitional state. The backend database and APIs have been successfully modernized to support advanced agricultural governance, lot tracking, WIP accounting, and outbox-based asynchronous posting. However, the frontend migration is incomplete. The new `MovementWorkspacePage` is a visual shell blocked by incomplete data-entry components (stubbed line items), while the legacy modals have already been excised from the routing tree. Consequently, users are currently unable to operationally process multi-item inventory movements (GRN/Issue) through the modern UI. The system is not dangerous, but it is operationally bottlenecked until the Workspace grid is un-stubbed.

---

## 2. Database Truth (Verified Live)

*Verified via remote D1 PRAGMA queries against `agri-nile-flow-data-lake`.*

| Entity | Live Status | Evidence / Notes |
| :--- | :--- | :--- |
| **items** | **ACTIVE** | `costing_method` (default 'moving_average'), `track_lots` (INTEGER), `package_capacity` (REAL), `cogs_account_override` (TEXT) exist physically. |
| **inventory_movements** | **ACTIVE** | Uses `warehouse_id` (INTEGER). Arabic movement types are gone. `batch_number` and `expiry_date` exist (TEXT). `zero_value_reason` exists. |
| **inventory_balances** | **ACTIVE** | Used for authoritative snapshot balances. |
| **inventory_posting_outbox**| **ACTIVE (Empty)**| Physically exists but contains 0 rows in production. |
| **crop_cycles** | **ACTIVE (Empty)**| Physically exists but contains 0 rows in production. |
| **wip_ledger** | **ACTIVE (Empty)**| Physically exists but contains 0 rows in production. |
| **harvest_settlements** | **ACTIVE (Empty)**| Physically exists but contains 0 rows in production. |
| **item_units** | **MISSING** | Does not exist in the remote database. |
| **unit_conversion_rules** | **MISSING** | Does not exist in the remote database. Unit conversion is currently vaporware. |
| **stock_quants** | **MISSING** | Does not exist in the remote database. Orphaned concept. |

---

## 3. Backend Runtime Truth

*Verified by caller tracing in `src/api/inventory/*.ts`.*

| Endpoint | Classification | Details |
| :--- | :--- | :--- |
| `POST /movements` | **ACTIVE_PRODUCTION**| Called for single movements. Hardcodes GL linkage for cash mirroring. Bypasses unified posting outbox. Migration risk: Moderate (needs outbox transition). |
| `POST /movements/batch` | **TRANSITIONAL** | Accepts both flat `movements[]` and structured `items[]`. Writes directly to `inventory_movements` rather than utilizing the pure outbox pattern. |
| `POST /movements/transfer-batch`| **ACTIVE_PRODUCTION**| Handles atomic transfers (`TRANSFER_OUT` + `TRANSFER_IN`). |
| `POST /adjustments/:id/post` | **ACTIVE_PRODUCTION**| Only functional for adjustment headers. Correctly enqueues via `enqueueInventoryPostingOutbox`. |
| `POST /gl-preview` | **ACTIVE_PRODUCTION**| Evaluates `posting_rules` to simulate GL lines. Pure read-only. |

---

## 4. Frontend Runtime Truth

*Verified by component rendering analysis.*

*   **MovementWorkspacePage:** **VISUAL SHELL**. The page is accessible but non-operational.
    *   **DimensionStrip:** Operational grid for headers and dimensions (WIP, Season).
    *   **LineEditor / LineRow:** **PLACEHOLDER UI**. Quantity, pack count, and unit price are hardcoded `div` elements rendering string placeholders (`{line.quantity ?? '—'}`).
    *   **Draft Engine:** Operational locally (IndexedDB) via `useMovementDraft`, but users cannot enter data to save.
    *   **Conclusion:** Users **cannot** submit standard movements (GRN, Issue, Transfers) through the Workspace today.
*   **PhysicalCountPage:** **OPERATIONAL (HACKED)**. Bypasses the standardized draft engine to inject raw JSON directly into the backend batch endpoint. Forces `payment_method: 'credit'` arbitrarily on inventory adjustments.
*   **Legacy Modals (`AddInventoryBatchModal`, `InternalTransferModal`):** **DEAD**. Zero imports across the `web/src` tree. Unreachable.

---

## 5. Route Topology

*Verified by `App.tsx` and import tracing.*

| Route | Component | Status | Notes |
| :--- | :--- | :--- | :--- |
| `/inventory/items` | `ItemMasterPage` | Canonical (Sidebar) | Mutation capable (Edit Modal), but missing DB fields. |
| `/inventory/workspace/create` | `MovementWorkspacePage` | Deep-link / FAB | Visual shell; operational capability blocked by LineRow. |
| `/inventory/physical-count` | `PhysicalCountPage` | Active (Sidebar) | Mutation capable. |
| `/inventory/posting-health` | `InventoryPostingHealthPage` | Canonical (Sidebar) | Critical governance dashboard; Read-only. |
| `/inventory/movements` | `InventoryMovementsPage` | Active (Sidebar) | Read-only historical view. |
| `/inventory/setup` | `WarehousesPage` | Active (Sidebar) | Basic master data. |

---

## 6. Real Gaps (Evidence-Based)

| Capability | Status | Evidence |
| :--- | :--- | :--- |
| **WIP Dimensions** | **IMPLEMENTED** | `DimensionStrip.tsx` actively maps `season_id`, `field_id`, `work_order_id`. |
| **Zero-value Governance** | **IMPLEMENTED** | API enforces `zero_value_reason`; DB supports it. |
| **Lot Tracking** | **BACKEND_ONLY** | `batch_number`, `track_lots` exist in schema. 0% UI exposure. |
| **Costing Methods** | **BACKEND_ONLY** | DB has `costing_method` enum. `AccountingEditModal` omits it. |
| **Packaging** | **BACKEND_ONLY** | DB has `package_capacity`. Frontend `LineRow.tsx` explicitly stubs it. |
| **Offline Drafts** | **FRONTEND_ONLY** | Client-side IndexedDB works. No backend synchronization API. |
| **Unit Conversion** | **PLANNED_ONLY** | No DB schema, no Frontend UI. |

---

## 7. Safe Deletion Candidates

The following files have been proven unreachable by import tracing and route traversal and can be deleted immediately:

1.  `web/src/legacy/inventory/AddInventoryBatchModal.tsx`
2.  `web/src/legacy/inventory/InternalTransferModal.tsx`

---

## 8. Required Migration Work

**P0 — Operational Blockers:**
*   Un-stub `web/src/components/workspace/LineRow.tsx` to utilize actual `<input>` fields for `quantity`, `unit_price`, and `item_code`. The system is blocked until users can type data into this grid.

**P1 — Transition Completion:**
*   Expand `AccountingEditModal` in `ItemMasterPage.tsx` to expose `track_lots`, `costing_method`, and `cogs_account_override`.
*   Refactor `PhysicalCountPage` to dispatch standard `MovementDraft` payloads rather than injecting raw JSON payloads.

**P2 — Future Enhancements:**
*   Migrate `POST /movements/batch` and `POST /movements` to exclusively use `inventory_posting_outbox` for GL separation.

---

## 9. Final Architectural Verdict

*   **Is inventory operational today?** Barely. Master data and adjustments work, but core GRN/Issue/Transfer flows are blocked by the incomplete `MovementWorkspacePage`.
*   **Is Workspace canonical yet?** Architecturally yes, but functionally no. It is the only intended route for movements, but its data grid is a read-only stub.
*   **Is the backend ahead of frontend?** Yes, by roughly 40%. The DB supports lot tracking, WIP allocations, and advanced costing that the frontend is completely blind to.
*   **Is the system dangerous or simply transitional?** It is simply transitional. The "dangerous" legacy modals (which bypassed modern controls) have already been disconnected from the UI. The current issue is a lack of capability, not a risk of corruption.
*   **Which previous audit claims were inaccurate?** Previous audits assumed the legacy modals (`AddInventoryBatchModal`) were still actively polluting the database. Runtime import tracing proves they are dead code. Previous docs assumed `unit_conversion_rules` and `stock_quants` existed; remote D1 queries prove they are hallucinated/orphaned concepts.