# ADR-003: Synchronous-Primary, Outbox-Fallback GL Posting

**Status:** Accepted  
**Date:** 2026-05-19  
**Deciders:** Architecture team

---

## Context

GL posting must be reliable — a business operation completing without a corresponding journal entry is a silent financial defect. However, GL failures (period closed, dimension missing, account not found) must not block the business operation that caused them. Two conflicting requirements: reliability and non-blocking.

## Decision

GL posting uses a two-path model:

**Primary path (synchronous):** Every business operation that triggers a GL event calls `postFromBusinessEvent()` synchronously within the same HTTP request. If the post succeeds, the journal entry is written atomically with the business record in the same D1 transaction where possible.

**Fallback path (outbox):** If the synchronous post fails (GL validation error, transient DB error), the failure is recorded in `outbox_jobs` with the original business event payload. A background scanner retries outbox jobs at a configured interval.

```
Business operation completes
  → postFromBusinessEvent() called
    ↓ success → journal_entry written, gl_posting_status='posted'
    ↓ failure → outbox_jobs row inserted, gl_posting_status='failed'
                background scanner picks up and retries
```

The `gl_posting_status` column on the source record (`inventory_movements`, `supplier_transactions`, `cash_transactions`) is the observable state: `draft | posted | failed`.

## Consequences

- The outbox is a **recovery queue**, not a message bus. Zero outbox jobs is the correct steady state.
- A non-zero outbox count is a monitoring alert condition, not normal throughput.
- The scanner retry rate (currently 2s polling for `queued/processing` states via `useFinancialVisibility`) should not be the primary trigger — it is the tail-latency safety net.
- Business operations are never blocked by GL failures. This means it is possible (briefly) for a movement to exist without a journal entry — `gl_posting_status='failed'` surfaces this.

## Enforcement

Architecture invariant: no route handler may `await` a GL posting result and return an HTTP error based on GL failure. GL errors are always handled by recording to outbox.
