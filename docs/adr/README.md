# Architecture Decision Records

Binding decisions that govern the system. Each ADR is frozen unless explicitly superseded by a new ADR that references it.

| ADR | Title | Status |
|---|---|---|
| [ADR-001](ADR-001-gl-four-layer-architecture.md) | Four-Layer GL Posting Architecture | Accepted |
| [ADR-002](ADR-002-wac-only-inventory-valuation.md) | WAC-Only Inventory Valuation | Accepted |
| [ADR-003](ADR-003-outbox-driven-posting.md) | Synchronous-Primary, Outbox-Fallback GL Posting | Accepted |
| [ADR-004](ADR-004-stored-snapshot-balances.md) | Stored Snapshot Balances (Not SUM Aggregation) | Accepted |
| [ADR-005](ADR-005-mandatory-dimensions.md) | Mandatory Dimensions on All Posted Transactions | Accepted |
| [ADR-006](ADR-006-supplier-ap-mirror.md) | Supplier AP Mirror on Cash Payments | Accepted |

## How to add a new ADR

1. Copy the template of an existing ADR.
2. Number it sequentially (`ADR-007-...`).
3. Set Status to `Proposed` until reviewed.
4. Add it to the table above.
5. If it supersedes an existing ADR, update the superseded ADR's Status to `Superseded by ADR-NNN`.
