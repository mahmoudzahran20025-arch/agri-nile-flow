# ADR-001: Four-Layer GL Posting Architecture

**Status:** Accepted  
**Date:** 2026-05-19  
**Deciders:** Architecture team

---

## Context

Inventory and treasury operations must produce auditable GL journal entries without coupling business logic to accounting rules. Early implementations had posting logic scattered across route handlers, leading to inconsistent GL output and difficult-to-test accounting behavior.

## Decision

All GL posting follows a strict four-layer model:

```
Layer 1 — Business Event
  A domain-level fact: "GRN received", "cash paid", "sale dispatched"
  Produced by route handlers; stored as a business_event row with payload.

Layer 2 — Blueprint
  Pure function: BusinessEvent → JournalEntryBlueprint[]
  No I/O. Deterministic. Independently testable.
  Lives in src/lib/finance/blueprints/

Layer 3 — Orchestrator
  Validates blueprint (dimension completeness, period open, balance sufficiency).
  Writes journal_entry + journal_entry_lines atomically.
  Lives in src/lib/finance/posting_engine.ts → postFromBusinessEvent()

Layer 4 — Outbox (recovery only)
  outbox_jobs table holds failed postings for retry.
  The outbox is NOT the primary posting path — it is the failure-recovery path.
  Primary posting is synchronous within the HTTP request.
```

Entry point: `postFromBusinessEvent(businessEvent, db)` in `src/lib/finance/posting_engine.ts`.

## Consequences

- GL failures never block business operations (posting is non-blocking by design).
- Blueprint functions are pure and unit-testable without a database.
- Adding a new movement type requires only: a new blueprint function + registration in the dispatcher.
- The outbox scanning rate is a lagging indicator of GL health, not throughput.

## Enforcement

Architecture invariant: `posting_engine.ts` is the sole writer of `journal_entries`. No route handler may write GL rows directly.
