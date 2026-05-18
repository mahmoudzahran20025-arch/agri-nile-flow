# Baseline Daily Control Snapshot

Date: 2026-05-11
System: agri-nile-flow-data-lake (remote D1)
Scope: company_id = 1
Source: live query execution via Wrangler

## Baseline Metrics

| Metric | Value | Expected State |
|---|---:|---|
| actionable_supplier_nonfuture | 0 | Must remain 0 |
| actionable_inventory_nonfuture | 0 | Must remain 0 |
| future_blocked_supplier | 6 | Informational, policy-blocked |
| future_blocked_inventory | 46 | Informational, policy-blocked |
| total_future_blocked | 52 | Informational, policy-blocked |
| unbalanced_supplier_entries | 0 | Must remain 0 |
| unbalanced_inventory_entries | 0 | Must remain 0 |
| posted_supplier_null_service_type | 0 | Must remain 0 |
| grn_issue_null_service_type | 0 | Must remain 0 |

## Go/No-Go Gates for Daily Run

1. Stop and investigate if either actionable_nonfuture metric > 0.
2. Stop and investigate if either unbalanced metric > 0.
3. Stop and investigate if either null_service_type metric > 0.
4. future_blocked metrics are allowed by policy and should only change by date progression or approved exception.

## Reference Cutoff Policy

Posting cutoff date controls whether a source row is considered postable now or future-blocked.
- Source date <= cutoff: eligible for posting.
- Source date > cutoff: remain future-blocked.

## Baseline Signature

- Baseline owner: Finance Data Integrity Track
- Baseline approved at: 2026-05-11
- Baseline use: daily variance comparison and alerting
