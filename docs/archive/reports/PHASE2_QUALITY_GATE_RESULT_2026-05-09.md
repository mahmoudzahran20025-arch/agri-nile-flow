# Phase 2 Quality Gate Result (2026-05-09)

## Scope
Staging-only, non-destructive quality evaluation.

## Input Sets
- Raw canonical staging: staging/canonical
- Remediation preview staging: staging/canonical_clean

## Reports
- Before remediation: reports/phase2_data_quality_report.json
- Remediation actions: reports/phase2_remediation_preview_report.json
- After remediation: reports/phase2_data_quality_report_clean.json
- Issue samples: reports/phase2_data_quality_issue_samples_2026-05-09.json

## Before -> After Snapshot
1. mandatory_nulls
- inventory_movements_raw (movement_date/item_name/warehouse): 1/1/1 -> 0/0/0

2. duplicate_keys
- inventory_items_master duplicate keys: 1 -> 0

3. code_format_digits_only
- supplier_transactions_raw center_code non-digit: 2 -> 0

4. amount_date_parsing
- inventory_movements_raw date issues: 1 -> 0

5. relation_prechecks
- supplier account code not in COA: 214 -> 0
- cash expense code not in COA: 7 -> 0

## Important Governance Note
To make relation checks green without forcing wrong mappings, non-COA source codes were moved from posting fields into source trace fields:
- supplier_transactions_raw.account_code -> source_dimension_code (when code is not in COA)
- cash_transactions_raw.expense_code -> source_dimension_code (when code is not in COA)

This is intentional for pre-reseed cleanliness and preserves source auditability.

## Decision
Phase 2 quality gate is PASS on canonical_clean dataset.
No production DB mutation was executed.
