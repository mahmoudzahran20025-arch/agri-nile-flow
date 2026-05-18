# ADR-005: Mandatory Dimensions on All Posted Transactions

**Status:** Accepted  
**Date:** 2026-05-19  
**Deciders:** Architecture team

---

## Context

Agricultural ERP reporting requires P&L and cost analysis sliced by season, field (crop cycle), and branch. Without enforced dimensions, GL lines accumulate without segment data, making management accounting reports impossible to produce after the fact.

## Decision

Every posted GL journal entry line **must** carry all applicable dimensions. The posting engine validates dimension completeness before writing any GL row. A missing mandatory dimension is a validation error that sends the posting to the outbox for retry after the dimension is resolved — it does not silently post with null dimensions.

The mandatory dimension set for this system:

| Dimension | Column | When required |
|---|---|---|
| Company | `company_id` | Always. Enforced by `getUser(c)` pattern on every query. |
| Season | `season_id` | All operational transactions (inventory, treasury, payroll). |
| Field / Crop Cycle | `field_id` | Inventory movements and costs tied to a specific field. |
| Branch | `branch_id` | POS and branch-scoped transactions. Optional for back-office. |
| Cost Center | `cost_center_code` | Overhead allocations and expense postings. |

Dimensions flow from the source document: a GRN inherits `season_id` from the PO header; a cash payment inherits `season_id` and `field_id` from the transaction context set at workspace open.

## Consequences

- Transactions missing `season_id` at posting time are rejected — the client must select an active season before transacting.
- `getUser(c)` always injects `company_id`; no route handler may construct a query without it.
- Reports sliced by season/field can be produced directly from `journal_entry_lines` without post-hoc attribution.
- Adding a new dimension (e.g., project, lot) requires: column on `journal_entry_lines`, update to dimension validation in the posting engine, migration for existing rows.

## Enforcement

Architecture invariant: the posting engine's dimension validator (`validateDimensions()`) must run before any GL write. No blueprint may produce lines with `null` season_id on operational transaction types.
