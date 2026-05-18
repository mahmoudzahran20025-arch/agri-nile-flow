# ADR-004: Stored Snapshot Balances (Not SUM Aggregation)

**Status:** Accepted  
**Date:** 2026-05-19  
**Deciders:** Architecture team

---

## Context

Computing inventory balance via `SUM(movements WHERE item=X AND warehouse=Y AND date <= T)` is O(N) per query and becomes unacceptably slow as movement history grows. Agricultural businesses can have thousands of movements per item-warehouse pair per season.

## Decision

`inventory_balances` stores a running balance snapshot per `(company_id, item_code, warehouse_id)`. Every movement write updates this snapshot atomically. Balance queries read a single row — O(1).

The `inventory_balances` table is the **sole authoritative source** for current stock levels. `inventory_movements.running_balance` is an audit trail field only — it is never read for operational decisions.

**Backdating:** When a movement is inserted with a date earlier than existing movements, a propagation function (`src/lib/inventory/propagator.ts`) re-walks all subsequent movements for that item-warehouse pair and re-applies the running balance forward. This is the most expensive operation in the system and is bounded by the number of movements after the backdated date.

**Future-negative check:** Before any outbound movement is committed, the system checks that the resulting `inventory_balances.balance_qty` will not go negative. If it would, the movement is rejected with HTTP 422.

## Consequences

- Balance reads are always O(1) regardless of history depth.
- Backdating is O(M) where M = movements after the backdated date — acceptable for agricultural workflows where backdating is rare and bounded by season length.
- `SUM(inventory_movements)` for a balance in production code is a defect.
- Direct edits to `inventory_balances` outside the propagator are a defect.
- Physical count adjustments (`ADJUSTMENT_PROFIT` / `ADJUSTMENT_LOSS`) are the only legitimate way to correct a balance discrepancy.

## Enforcement

Frozen rule (see `docs/governance/SEMANTIC_GOVERNANCE.md` §2): "`inventory_balances` is the authoritative running balance. Never compute balance from `SUM(movements)` in production code."
