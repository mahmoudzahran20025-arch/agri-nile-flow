# Executable Audit Backlog

Date: 2026-05-02
Scope: End-to-end ERP trust chain (Input -> Processing -> GL -> Reports -> UX)
Status: Ready for execution

Latest execution artifacts:
- AUDIT_EXECUTION_REPORT_2026-05-01.md
- AUDIT_EXECUTION_SNAPSHOT_2026-05-02.md

## Owner Legend
- FIN: Finance Lead
- BE: Backend Engineer
- FE: Frontend Engineer
- QA: QA Engineer

## Ticket Template
Each ticket includes:
- Objective
- Scope
- Checks (SQL/API)
- Exit criteria
- Owner(s)

---

## AUD-001: Subledger -> GL Linkage Coverage
Objective: Ensure all posted operational transactions are linked to GL journal entries.

Scope:
- Tables: inventory_movements, cash_transactions, supplier_transactions, payroll_runs
- Tables: journal_entries, journal_entry_lines
- APIs: /api/gl/integrity (if available), /api/gl/entries

Checks:
```sql
-- Inventory linkage %
SELECT COUNT(*) AS total,
       SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS linked
FROM inventory_movements
WHERE company_id = 1 AND status = 'posted';

-- Cash linkage %
SELECT COUNT(*) AS total,
       SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS linked
FROM cash_transactions
WHERE company_id = 1 AND status = 'posted';

-- Supplier linkage %
SELECT COUNT(*) AS total,
       SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS linked
FROM supplier_transactions
WHERE company_id = 1 AND status = 'posted';

-- Payroll linkage %
SELECT COUNT(*) AS total,
       SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS linked
FROM payroll_runs
WHERE company_id = 1 AND status = 'posted';
```

API checks:
- GET /api/gl/entries -> 200, non-empty historical set
- GET /api/gl/integrity -> 200, linkage-related checks pass

Exit criteria:
- >= 99.5% linkage for each core module; justified exceptions documented.

Owner(s): BE, QA, FIN

---

## AUD-002: Journal Integrity Guardrails
Objective: Validate accounting integrity invariants.

Scope:
- Tables: journal_entries, journal_entry_lines, chart_of_accounts
- APIs: /api/gl/integrity, /api/gl/reports/trial-balance

Checks:
```sql
-- Unbalanced entries
SELECT COUNT(*) AS unbalanced
FROM (
  SELECT je.id
  FROM journal_entries je
  JOIN journal_entry_lines jel ON jel.entry_id = je.id
  WHERE je.company_id = 1
  GROUP BY je.id
  HAVING ABS(ROUND(SUM(jel.debit),2) - ROUND(SUM(jel.credit),2)) > 0.01
) t;

-- Orphan lines
SELECT COUNT(*) AS orphans
FROM journal_entry_lines jel
WHERE jel.company_id = 1
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je WHERE je.id = jel.entry_id
  );

-- Missing account codes
SELECT COUNT(*) AS missing_accounts
FROM journal_entry_lines jel
WHERE jel.company_id = 1
  AND NOT EXISTS (
    SELECT 1
    FROM chart_of_accounts coa
    WHERE coa.company_id = jel.company_id
      AND coa.code = jel.account_code
  );
```

API checks:
- GET /api/gl/integrity -> 200, no critical failures
- GET /api/gl/reports/trial-balance -> total_debit == total_credit

Exit criteria:
- unbalanced = 0
- orphans = 0
- missing_accounts = 0

Owner(s): BE, QA

---

## AUD-003: Workflow State Consistency (Draft/Posted/Reversed)
Objective: Ensure workflow states are valid and consistent across modules and UI.

Scope:
- Tables: cash_transactions, supplier_transactions, inventory_movements, journal_entries
- Screens: Cash Journal, Supplier Statement, Journal Entries
- APIs: module list endpoints + /api/gl/entries

Checks:
```sql
-- Draft rows should not appear in official posted report totals
SELECT COUNT(*) AS draft_cash FROM cash_transactions WHERE company_id=1 AND status='draft';
SELECT COUNT(*) AS draft_supplier FROM supplier_transactions WHERE company_id=1 AND status='draft';

-- Reversal consistency: posted reversal entry points to original
SELECT COUNT(*) AS broken_reversal_links
FROM journal_entries je
WHERE je.company_id=1
  AND je.reversal_entry_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries original
    WHERE original.id = je.reversal_entry_id
  );
```

API checks:
- GET /api/gl/entries?status=posted -> excludes drafts
- POST reversal endpoint -> creates valid reversal with link chain

Exit criteria:
- No broken reversal chains
- Posted reports exclude drafts by default

Owner(s): BE, FE, QA, FIN

---

## AUD-004: Date/Period Filter Parity Across Reports
Objective: Ensure all financial pages compute numbers using identical date and period semantics.

Scope:
- APIs: /api/gl/reports/trial-balance, /api/gl/reports/income-statement, /api/gl/reports/balance-sheet, /api/gl/entries
- Screens: Financial Statements, Dashboard, Journal list

Checks:
```sql
-- Control aggregate for given period
SELECT ROUND(SUM(jel.debit),2) AS debit_sum,
       ROUND(SUM(jel.credit),2) AS credit_sum
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.entry_id
WHERE je.company_id = 1
  AND je.is_posted = 1
  AND je.entry_date >= '2025-01-01'
  AND je.entry_date <= '2026-12-31';
```

API checks:
- Same date range on all report endpoints -> internally consistent totals
- Report totals reconcile with SQL control query

Exit criteria:
- 0 unexplained variance between report pages and SQL baseline

Owner(s): BE, FE, QA, FIN

---

## AUD-005: Dimension Completeness (Season/Center/Field)
Objective: Raise analytical reliability by enforcing and measuring dimension quality.

Scope:
- Tables: cash_transactions, supplier_transactions, inventory_movements, journal_entry_lines
- Screens: Cost analysis / pivot pages / season reports

Checks:
```sql
-- Null-rate in source tables
SELECT
  ROUND(100.0 * SUM(CASE WHEN season_id IS NULL THEN 1 ELSE 0 END) / COUNT(*),2) AS season_null_pct,
  ROUND(100.0 * SUM(CASE WHEN center_code IS NULL THEN 1 ELSE 0 END) / COUNT(*),2) AS center_null_pct
FROM supplier_transactions
WHERE company_id=1 AND status='posted';

SELECT
  ROUND(100.0 * SUM(CASE WHEN season_id IS NULL THEN 1 ELSE 0 END) / COUNT(*),2) AS season_null_pct,
  ROUND(100.0 * SUM(CASE WHEN center_code IS NULL THEN 1 ELSE 0 END) / COUNT(*),2) AS center_null_pct,
  ROUND(100.0 * SUM(CASE WHEN field_id IS NULL THEN 1 ELSE 0 END) / COUNT(*),2) AS field_null_pct
FROM cash_transactions
WHERE company_id=1 AND status='posted';

-- Propagation to GL lines
SELECT COUNT(*) AS posted_lines_missing_dimensions
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.entry_id
WHERE jel.company_id=1
  AND je.is_posted=1
  AND (jel.season_id IS NULL OR jel.center_code IS NULL);
```

API checks:
- Analytical report endpoints with season/center filters return consistent non-zero where data exists

Exit criteria:
- Mandatory dimensions policy defined per transaction type
- Null-rates reduced to target (<2% where mandatory)

Owner(s): FIN, BE, FE, QA

---

## AUD-006: Account Role Mapping Coverage & Resolution Accuracy
Objective: Guarantee role-to-account policy is complete and deterministic.

Scope:
- Tables: account_role_mappings, md_account_roles, chart_of_accounts
- APIs: /api/gl/account-role-policy, /coverage, /resolve/:role

Checks:
```sql
-- Coverage %
SELECT
  (SELECT COUNT(*) FROM md_account_roles WHERE is_active=1) AS total_roles,
  (SELECT COUNT(DISTINCT role_code) FROM account_role_mappings WHERE company_id=1 AND is_active=1) AS mapped_roles;

-- Active mappings with missing account
SELECT COUNT(*) AS broken_mappings
FROM account_role_mappings arm
LEFT JOIN chart_of_accounts coa
  ON coa.company_id = arm.company_id
 AND coa.code = arm.account_code
WHERE arm.company_id=1 AND arm.is_active=1
  AND coa.code IS NULL;
```

API checks:
- GET /api/gl/account-role-policy/coverage -> coverage_pct meets threshold
- GET /api/gl/account-role-policy/resolve/CASH|BANK|AR|AP|INVENTORY -> deterministic expected accounts

Exit criteria:
- 100% of required roles mapped
- 0 broken mappings
- resolve endpoint deterministic for priority ties

Owner(s): BE, FIN, QA

---

## AUD-007: UI-API Trust Alignment on Final Numbers
Objective: Ensure what users see on pages exactly matches API outputs and ledger truth.

Scope:
- Screens: JournalEntriesPage, FinancialStatementsPage, Dashboard, Supplier/Cash analysis pages
- APIs: corresponding report/list endpoints

Checks:
- UI test checklist:
  - Default filters visible and explicit
  - “Posted only” behavior clear
  - Empty state explains why (no data vs filter mismatch)
- API parity checks:
  - Compare page totals with direct API responses for same filters

SQL spot checks:
```sql
-- Spot-check account ledger total shown in UI
SELECT ROUND(SUM(jel.debit - jel.credit),2) AS net
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.entry_id
WHERE jel.company_id=1
  AND jel.account_code='2110'
  AND je.is_posted=1
  AND je.entry_date BETWEEN '2025-01-01' AND '2026-12-31';
```

Exit criteria:
- 100% sampled pages pass UI/API parity checks
- No unexplained zero-value displays when underlying posted data exists

Owner(s): FE, QA, FIN

---

## AUD-008: Error Observability & Triage Readiness
Objective: Make runtime failures detectable, actionable, and owned.

Scope:
- Tables: system_error_logs (or equivalent)
- Middleware/global error handling
- Operational runbook

Checks:
```sql
SELECT COUNT(*) AS total_errors_7d
FROM system_error_logs
WHERE created_at >= datetime('now', '-7 day');

SELECT error_type, COUNT(*) AS n
FROM system_error_logs
WHERE created_at >= datetime('now', '-7 day')
GROUP BY error_type
ORDER BY n DESC;
```

API checks:
- Trigger controlled 4xx/5xx scenarios in staging and validate logs include route + company + user context

Exit criteria:
- Error classes categorized (data, auth, business rule, infra)
- Owner and SLA assigned per severity

Owner(s): BE, QA

---

## AUD-009: Security & RBAC Mutation Coverage
Objective: Confirm role-based controls are enforced on all mutation endpoints.

Scope:
- Auth middleware and role guards
- GL, treasury, suppliers, inventory, master-data mutations

Checks:
- API matrix (minimum):
  - No token -> 401
  - Invalid token -> 401
  - Valid token wrong role -> 403
  - Correct role -> 2xx

SQL support checks:
```sql
-- Optional: audit log action coverage
SELECT action, COUNT(*) AS n
FROM audit_logs
WHERE created_at >= datetime('now', '-30 day')
GROUP BY action;
```

Exit criteria:
- 100% critical mutation endpoints tested against role matrix
- No privilege escalation path found

Owner(s): BE, QA

---

## AUD-010: Production Readiness Gate (Release Blocker)
Objective: Convert audits into hard go/no-go gate before release.

Scope:
- CI/manual release checklist
- Performance, integrity, security, UX parity

Checks:
- Must pass before release:
  - AUD-001, AUD-002, AUD-004, AUD-009
- Performance checks (API):
  - POST journal entry p95 < 120ms
  - Batch resolve p95 < 50ms (target scenario)

Exit criteria:
- Gate document signed by FIN + QA + BE + FE
- Release tagged with audit evidence artifacts

Owner(s): QA, BE, FE, FIN

---

## Suggested Execution Order (2-week sprint)
1. AUD-001
2. AUD-002
3. AUD-004
4. AUD-006
5. AUD-005
6. AUD-007
7. AUD-009
8. AUD-008
9. AUD-010

## Deliverables Per Ticket
- SQL result snapshot (timestamped)
- API test evidence (request/response)
- Defect list (if any) with severity
- Sign-off note from assigned owner(s)
