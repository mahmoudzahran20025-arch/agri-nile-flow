# COA Leaf-With-Children Fix Report (2026-05-08)

## Problem
- Remaining high anomaly after phase 1/2:
  - leaf_with_children = 1
- Affected node:
  - code 2110 (posting account, has historical posted lines)
  - child: 21100001

## Risk-aware decision
- Do NOT flip 2110 to header to avoid turning historical posted lines into posted_to_header violations.
- Re-parent child 21100001 to existing valid header 2120 (موردون).

## Change applied
- SQL: sql/coa_remediation_phase3_leaf_with_children.sql
- Update:
  - 21100001.parent_code: 2110 -> 2120

## Expected result
- leaf_with_children = 0
- posted_to_header remains 0
- No impact on historical journal lines posted to 2110

## Operational gate
- Deploy pipeline now requires COA verification before deploy.
