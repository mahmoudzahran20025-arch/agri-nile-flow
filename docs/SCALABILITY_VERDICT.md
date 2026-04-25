# Scalability Verdict

## Executive Verdict
Verdict: Conditionally ready for 100+ concurrent companies.

Current architecture can support the target if the mandatory guardrails below are completed before broad rollout. The codebase already has strong foundations: company_id scoping, role-based route hardening, and transactional finance flows.

Readiness score:
- Functional readiness: 82/100
- Isolation readiness: 78/100
- Operational readiness: 71/100
- Final enterprise readiness for 100+ companies: 77/100 (go with mitigations)

---

## Evidence Snapshot
Strengths observed:
- Multi-tenant predicates are now enforced in high-risk API joins.
- Finance posting moved toward shared transactional core.
- Harvest-to-GL bridge now posts operational deltas into journal entries.
- Role guards are added across critical modules (finance, treasury, HR, GL, operations, suppliers).

Outstanding risk zones:
- Remaining API modules still need a full tenant-join sweep.
- Absence of explicit per-tenant rate limiting and workload quotas.
- Limited formal background job orchestration for heavy month-end routines.
- Observability requires stronger SLO metrics and tenant-level dashboards.

---

## Required Mitigations Before 100+ Scale

### M1. Tenant Isolation Completion
- Run a full SQL join audit across all src/api modules.
- Standardize join pattern: joined_table.company_id = base_table.company_id.
- Add CI lint rule to block joins without explicit tenant predicate on tenant tables.

### M2. Performance Hardening
- Ensure all critical composite indexes exist and are monitored.
- Add keyset pagination for large list endpoints.
- Introduce query timing telemetry and slow-query alerts.

### M3. Workload Controls
- Apply per-company quotas for burst-heavy routes (imports, payroll, batch postings).
- Add idempotency keys on all write-heavy integration endpoints.
- Introduce retry-safe workers for scheduled close jobs.

### M4. Operational Resilience
- Define SLOs: API p95 latency, posting error rate, and reconciliation lag.
- Add tenant-aware dashboards and alert routing.
- Formalize backup/restore drills and migration rollback playbooks.

---

## Capacity Model (Practical)
Assumptions for 100 companies:
- 5 to 20 active users per company.
- Moderate transaction volume with month-end peaks.
- Shared worker runtime and D1 backend.

Expected behavior after mitigations:
- Normal operations: stable.
- Peak month-end close: stable with queued job orchestration.
- Failure domains: isolated per company using idempotency and scoped retries.

---

## BI/Intelligence Readiness Notes

### Cash Flow Category Mapping Feasibility
Supported with current ledger design by mapping account ranges to:
- Operating
- Investing
- Financing

Implementation path:
1. Maintain cash_flow_category on chart_of_accounts or mapping table.
2. Classify journal lines by cash account counter-lines.
3. Aggregate by period and company.

### Budget vs Actual Feasibility
Supported with modest schema extension.
Recommended additions:
- budgets (header by company, year, scenario)
- budget_lines (account_code, center_code, period, amount)

Then compare:
- actuals from journal_entries + journal_entry_lines
- budgets from budget_lines
- variance amount and variance percentage.

---

## Go/No-Go Criteria
Go for 100+ companies when all are true:
1. Tenant-join audit reaches zero critical findings.
2. Index and slow-query baseline validated in production-like load tests.
3. Idempotent job orchestration in place for payroll/depreciation/heavy postings.
4. Tenant-level SLO dashboards and alerting are active.

Current status:
- Not no-go.
- Go with constraints and mitigation plan execution.
