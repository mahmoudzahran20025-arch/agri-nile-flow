# ADR-006: Supplier AP Mirror on Cash Payments

**Status:** Accepted  
**Date:** 2026-05-19  
**Deciders:** Architecture team

---

## Context

When a supplier cash payment is made, two distinct accounting events occur simultaneously:
1. Cash leaves the treasury (DR accounts_payable / CR cash).
2. The supplier's AP balance is reduced (the "mirror" entry).

Early implementations only posted the treasury-side cash movement, leaving AP balances stale. Supplier aging reports were inaccurate as a result.

## Decision

Every supplier cash payment produces a **mirror entry** in `supplier_transactions` that records the AP reduction alongside the cash movement. This mirror is created by `prepareCashMovement()` in `src/lib/finance/cash_movement.ts` as a shadow record — it does not require a separate user action.

The GL blueprint for a supplier payment therefore produces two paired entries:

```
DR  accounts_payable       [supplier dimension]
CR  cash / bank account    [treasury dimension]

--- mirror ---
DR  accounts_payable       [supplier_transactions row]
CR  (settled against open AP invoices in supplier ledger)
```

The mirror entry carries the same `season_id` and `field_id` as the originating cash transaction context.

**Known limitation:** The AP mirror shadow entry does not create a `business_events` row of its own. Supplier traceability queries (e.g., "show me all GL entries for supplier X") return ~67% coverage — the cash payment treasury leg has a business event, the mirror leg does not. This is by design: the mirror is a derived accounting record, not an independent business event. It is surfaced via the `supplier_transactions` table, not via `business_events`.

## Consequences

- Supplier AP aging is accurate without any manual reconciliation step.
- `supplier_transactions` is the authoritative AP ledger — do not recompute AP from raw GL lines.
- The "67% business_event coverage" for supplier payments is not a defect — it is the expected steady state.
- Future improvement: add a `business_event_id` FK to the mirror `supplier_transactions` row to enable full traceability without changing the core architecture.

## Enforcement

`prepareCashMovement()` and `commitCashDrafts()` must always pass `season_id` and `field_id` to `resolveCashLedger()`. Any caller that omits these will produce dimension-incomplete GL lines (caught by ADR-005 validation).
