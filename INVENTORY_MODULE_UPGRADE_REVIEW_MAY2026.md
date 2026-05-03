# Inventory Module Upgrade Review (May 2026)

## Scope
This document captures the latest inventory module upgrade for professional ERP operation (Dynamics/SAP style), including implementation status, architectural rationale, and production adoption notes.

## Implemented in This Cycle

### 1) Inventory Landing Page upgraded to ERP cockpit
- File: web/src/pages/inventory/WarehouseBalancesPage.tsx
- The page now acts as a module home, not only a balances list.

#### Added cockpit blocks
- Operational KPIs:
  - active warehouses
  - active items in stock balances
  - total stock quantity
  - total stock value
  - negative balance count
- Master-data risk KPIs:
  - items without standard_cost
  - items without PPG
  - items without IPG
  - items below reorder threshold
- Financial linkage strip:
  - posting setup coverage percent
  - non-zero unlinked movements (real GL gap)
  - zero-value unlinked movements (informational)
  - current negative balance rows
- Quick action tiles:
  - inventory movements
  - posting health
  - items master

### 2) New backend endpoint: inventory health summary
- File: src/api/inventory/governance.ts
- New route: GET /api/inventory/health-summary

#### What this endpoint aggregates (full dataset, no frontend sampling)
- movement:
  - total movements
  - unlinked_total
  - unlinked_non_zero
  - unlinked_zero
- posting:
  - total_combos
  - covered
  - missing_setup
  - health_pct
- item_risk:
  - active_items
  - items_without_standard_cost
  - items_without_ppg
  - items_without_ipg
  - items_without_reorder_threshold
  - below_reorder_count
- stock_risk:
  - negative_balance_rows
  - negative_balance_items

### 3) Frontend API extension
- File: web/src/api/inventory.ts
- Added method: inventoryApi.healthSummary()

## Why This Is Better (ERP View)

### Before
- Health indicators partially derived from small movement snapshots.
- Main inventory page was mostly a balances explorer.
- Risk posture (master data + accounting linkage) needed cross-navigation.

### After
- Inventory home behaves like an ERP cockpit (operations + accounting + master data quality in one place).
- Financial linkage indicators are computed on backend over full data.
- Decision points become immediate:
  - fix posting setup
  - fix item master data
  - act on reorder and negative balances

## Integration Position (Inventory x Finance)
The current integration posture is strong and production-viable:
- posting-health exists and is now represented in the inventory home.
- non-zero unlinked movements are explicitly separated from zero-value informational movements.
- dimensions (season, center, work order) remain in transaction flow.

Remaining strategic enhancement (recommended next):
- Introduce Outbox-based posting mode for optional decoupling:
  - strict sync mode (today behavior)
  - async reliable mode (event/outbox worker)
  - decoupled mode (for selective organizations/phases)

## Module Isolation and Controlled Coupling (Best Practice)

Recommended target architecture:
- Inventory Core Module:
  - owns stock movement lifecycle, valuation, reservations
- Inventory Accounting Adapter:
  - maps inventory events to posting blueprints
- Financial Posting Engine:
  - consumes posting events (sync or async)

Contract boundary:
- inventory event payload should be versioned and idempotent.
- posting outcome should feed back via status link (posted/failed/retry).

This keeps modules independent while preserving deterministic integration when needed.

## Production Adoption Checklist
- [x] Frontend type-check passed after upgrade
- [ ] Validate /api/inventory/health-summary on remote environment
- [ ] Add role matrix validation for inventory/read screens
- [ ] Confirm baseline KPI values in production data
- [ ] Add dashboard drill-down links for each risk tile (phase 2)

## Recommended Immediate Next Sprint
1. Add drill-down filters for each risk card (click to open movements/items with relevant filter).
2. Add reservation layer for work orders (planned vs consumed quantity).
3. Add inventory period close controls and lock rules.
4. Add zero-value movement policy enforcement (reason + approver role).

## Files Changed in This Cycle
- src/api/inventory/governance.ts
- web/src/api/inventory.ts
- web/src/pages/inventory/WarehouseBalancesPage.tsx
- INVENTORY_MODULE_UPGRADE_REVIEW_MAY2026.md
