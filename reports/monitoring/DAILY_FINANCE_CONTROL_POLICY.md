# Daily Finance Control Policy

Date: 2026-05-11
Status: Active
Applies to: company_id = 1 operational posting stream

## 1) Permanent Cutoff Control

Posting must always run with an explicit cutoff date.

Control rule:
- postable_now: source_date <= cutoff_date
- future_blocked: source_date > cutoff_date

Operational requirement:
- Never run posting without cutoff_date context.
- Keep cutoff_date equal to business date unless approved exception.

## 2) Daily Numeric Monitoring

Run one daily query pack and capture these counters:
- actionable_supplier_nonfuture
- actionable_inventory_nonfuture
- future_blocked_supplier
- future_blocked_inventory
- unbalanced_supplier_entries
- unbalanced_inventory_entries
- posted_supplier_null_service_type
- grn_issue_null_service_type

Alert conditions:
- Any actionable_nonfuture > 0
- Any unbalanced > 0
- Any null_service_type > 0

## 3) Future-Blocked Release Rule (Current 52 Rows)

Current policy: KEEP BLOCKED
- 6 supplier rows + 46 inventory rows = 52 future-blocked rows.

Release paths:
1. Automatic by date:
   - Row is released when source_date becomes <= cutoff_date.
2. Exceptional early release:
   - Requires documented change approval.
   - Must include reason, approver, scope, and execution timestamp.

## 4) Finance Scope Isolation from Large Frontend Changes

To avoid accidental coupling:
- Keep finance remediation and posting controls in dedicated scope/PR.
- Defer broad navigation/UI archival changes to separate scope/PR.
- Do not bundle posting policy changes with frontend restructuring.

## 5) Audit Trail Requirements

For every daily run:
- Save query output snapshot.
- Record cutoff_date used.
- Record operator and run timestamp.
- Record go/no-go decision.

## 6) Standard Execution Artifact

Use:
- sql/governance/03_daily_finance_control_query_pack.sql
as the single daily monitoring source.
