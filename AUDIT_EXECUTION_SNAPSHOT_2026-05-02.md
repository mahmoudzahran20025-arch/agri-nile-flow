# Audit Execution Snapshot

Date: 2026-05-02
Source backlog: EXECUTABLE_AUDIT_BACKLOG.md
Execution mode: Remote D1 SQL + Live API smoke checks

## Execution Status by Ticket

| Ticket | Status | Notes |
|---|---|---|
| AUD-001 | PASS | 100% linkage for inventory/cash/suppliers; payroll has 0 posted rows |
| AUD-002 | PASS | 0 unbalanced, 0 orphan lines, 0 missing accounts |
| AUD-003 | PASS | 0 draft cash, 0 draft supplier, 0 broken reversal links |
| AUD-004 | PASS | SQL control debit=credit exactly (diff=0) |
| AUD-005 | FAIL | Dimension completeness below target |
| AUD-006 | FAIL | Active role coverage 14/16; missing 2 mappings |
| AUD-007 | PASS* | API/SQL samples pass; UI parity checklist still manual |
| AUD-008 | PASS* | Error volume captured; categorization query needs schema alignment |
| AUD-009 | PASS* | Security baseline pass (401 no token / invalid token) |
| AUD-010 | PASS | Blocker tickets passed (AUD-001,002,004,009) |

Notes:
- * = partially constrained because authenticated API business checks were blocked (login credentials unavailable in this run).

---

## Key Evidence (SQL)

### AUD-001 Linkage
- inventory_movements linked: 597/597 (100%)
- cash_transactions linked: 69/69 (100%)
- supplier_transactions linked: 579/579 (100%)

### AUD-002 Integrity
- unbalanced entries: 0
- orphan lines: 0
- missing account references: 0

### AUD-004 Period parity control
- debit_sum: 215,236,995.82
- credit_sum: 215,236,995.82
- diff: 0

### AUD-005 Dimension completeness (FAILED)
- supplier_transactions:
  - season_nulls: 305 / 579 (52.68%)
  - center_nulls: 184 / 579 (31.78%)
- cash_transactions:
  - season_nulls: 0 / 69 (0%)
  - center_nulls: 55 / 69 (79.71%)
  - field_nulls: 69 / 69 (100%)
- posted GL lines missing season or center: 3,134
- missing-dimension lines by source_ledger:
  - manual: 1,850
  - supplier: 1,144
  - cash: 138
  - inventory: 2

### AUD-006 Role policy coverage (FAILED)
- active roles: 16
- mapped roles: 14
- broken mappings (mapped to missing COA): 0
- missing active role mappings:
  - ACCRUAL (مستحقات)
  - GRNI (حساب GR/IR مؤقت)

---

## Owner Assignment and Immediate Actions

## AUD-005 remediation
- FIN:
  - Approve mandatory dimension policy by transaction type:
    - supplier invoice/payment: season_id + center_code required
    - cash outgoing: center_code + field_id required for production expenses
    - manual journals: center_code mandatory for P&L accounts
- BE:
  - Add server-side validation guards on create/post endpoints to enforce policy.
  - Add backfill script for historical rows where business can infer dimensions safely.
- FE:
  - Make required fields visibly mandatory in forms (supplier/cash/manual JE).
  - Add inline error messages tied to business meaning (not generic validation text).
- QA:
  - Add tests for reject-on-missing-dimensions and post-success with complete dimensions.

Exit target for re-run:
- mandatory-dimension null rate < 2%
- posted GL lines missing mandatory dimensions = 0 for new data

## AUD-006 remediation
- FIN:
  - Confirm target accounts for ACCRUAL and GRNI in chart of accounts.
- BE:
  - Insert two account_role_mappings rows (active, correct priority) for ACCRUAL and GRNI.
  - Add check in deployment validation that mapped_roles == active_roles.
- FE:
  - Highlight coverage gaps in Account Role Policy page with blocking badge.
- QA:
  - Add resolve endpoint tests for ACCRUAL and GRNI.

Exit target for re-run:
- active role coverage 16/16
- resolve endpoints return deterministic account codes for all required roles

---

## Constraints Encountered

1. Authenticated API functional checks returned 401 in this run because login credentials were not available/valid.
2. Observability categorization query assumes column error_type in system_error_logs; schema should be confirmed and query aligned.

---

## Recommended Next Command Set

1. Provide test credentials for at least two roles:
- company_admin
- accountant

2. Re-run authenticated API matrix for:
- /api/gl/entries
- /api/gl/integrity
- /api/gl/reports/*
- /api/gl/account-role-policy/*

3. Execute remediation for AUD-005 and AUD-006, then re-run full backlog execution.
