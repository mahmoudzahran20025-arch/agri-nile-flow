# Final Reconciliation Report
Date: 2026-05-09
Database: agri-nile-flow-data-lake (company_id=1)
Scope: operational posting modules (suppliers, cash, inventory)

## 1. Final KPI Outcome
Formula enforced:
- linked + exempt_zero_value + unresolved_actionable = total_operational_events

Result:
- linked = 997
- exempt_zero_value = 85
- unresolved_actionable = 0
- total_operational_events = 1082

Validation:
- 997 + 85 + 0 = 1082

## 2. Module Breakdown
| Module | Total posted rows | Linked to JE | Exempt zero-value | Unresolved actionable |
|---|---:|---:|---:|---:|
| Supplier transactions | 313 | 286 | 27 | 0 |
| Cash transactions | 69 | 69 | 0 | 0 |
| Inventory movements (GRN/ISSUE scope) | 700 | 642 | 58 | 0 |
| Total | 1082 | 997 | 85 | 0 |

## 3. Posting Integrity Checks
| Check | Value |
|---|---:|
| journal_entries (operational chain) | 997 |
| posting_rule_resolutions | 997 |
| Unbalanced operational JEs | 0 |
| Source rows with broken JE pointer | 0 |

## 4. Exemption Classification Review
Exemption set contains only non-actionable zero-value rows:
- Supplier: 27 rows where amount=0, debit=0, credit=0 and no accounting impact.
- Inventory: 58 rows in GRN/ISSUE scope with exempt_zero_value or skipped_zero_value posting status.
- Cash: no zero-value exemptions required.

Conclusion:
- Exemption policy is consistent with accounting effect and does not hide unresolved posting defects.

## 5. Supplier Chart-of-Accounts Validation
| Check | Value |
|---|---:|
| Suppliers total | 10 |
| Suppliers with gl_account_code | 10 |
| Supplier gl_account_code existing in chart_of_accounts | 10 |

Conclusion:
- Supplier-level GL coding in COA is fully present for current supplier master set.

## 6. Sign-off
Reconciliation status: PASS

Actionable unresolved count is zero and posting chain integrity is balanced.
Strict monitoring can use this report as baseline for post-cutover controls.
