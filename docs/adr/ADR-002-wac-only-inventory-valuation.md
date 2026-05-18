# ADR-002: Weighted-Average Cost (WAC) as Sole Inventory Valuation Method

**Status:** Accepted  
**Date:** 2026-05-19  
**Deciders:** Architecture team

---

## Context

Multi-method costing (FIFO, LIFO, WAC) requires lot-tracking infrastructure, period-specific cost layers, and complex migration paths when switching methods mid-operation. The target market (Arab agricultural SMEs) does not require FIFO/LIFO for tax or regulatory compliance in the near term.

## Decision

Weighted-average cost (WAC) is the **only** supported inventory valuation method. No FIFO or LIFO until a migration workflow is built and a client explicitly requires it.

WAC calculation: when a receipt arrives, the new average unit cost is:

```
new_wac = (current_balance_qty × current_wac + received_qty × received_unit_cost)
          / (current_balance_qty + received_qty)
```

This WAC is written into `inventory_balances.wac` and propagated forward to all subsequent balance rows for that item-warehouse pair. Issue movements use the WAC at the time of issue.

## Consequences

- `inventory_balances` stores `wac` alongside `balance_qty`. Both are authoritative.
- Backdating a receipt triggers balance re-propagation for all subsequent movements (handled by the propagation function in `src/lib/inventory/propagator.ts`).
- `unit_price` on outbound movements reflects WAC at issue time — it is a snapshot, never recomputed.
- Adding a new costing method later requires: a `costing_method` flag on `companies`, a parallel WAC → new-method migration tool, and audit trails for the changeover.

## Enforcement

Frozen rule (see `docs/governance/SEMANTIC_GOVERNANCE.md` §3): "Weighted-average cost (WAC) only. No FIFO/LIFO until migration workflow exists."
