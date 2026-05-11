# Zero-Value Exempt Review
Date: 2026-05-10
Database: agri-nile-flow-data-lake (company_id=1)
Scope: posted operational rows with no accounting value and no linked JE

## 1. Executive Result
- Total zero-value exempt rows reviewed: 85
- Supplier zero rows: 27
- Inventory zero rows (GRN/ISSUE): 58
- Cash zero rows: 0
- Actionable unresolved hidden inside exempt set: 0

Conclusion:
- The exempt set is consistent with zero-value behavior and is not masking posting failures.

## 2. Supplier Exempt Set (27)
Definition used:
- status='posted'
- journal_entry_id IS NULL
- amount=0 AND debit=0 AND credit=0

Categorization:
- NEEDS_DIMENSION:center_code: 24
- NEEDS_DIMENSION:equipment_type: 2
- blank note: 1

Sample rows:
- id 3688, supplier_code 20900151, date 2025-11-26, note NEEDS_DIMENSION:equipment_type
- id 3705, supplier_code 20900151, date 2025-12-13, note NEEDS_DIMENSION:equipment_type
- id 3777, supplier_code 20900151, date 2025-12-02, note NEEDS_DIMENSION:center_code
- id 3786, supplier_code 20900151, date 2025-12-18, note NEEDS_DIMENSION:center_code
- id 3816, supplier_code 20900151, date 2026-01-14, note NEEDS_DIMENSION:center_code

Assessment:
- All supplier exempt rows are explicit placeholders with zero accounting impact.

## 3. Inventory Exempt Set (58)
Definition used:
- status='posted'
- movement_type IN ('GRN','ISSUE')
- journal_entry_id IS NULL
- gl_posting_status IN ('exempt_zero_value','skipped_zero_value')

Status split:
- exempt_zero_value: 58
- skipped_zero_value: 0

Warehouse and movement split:
- ISSUE, warehouse تقاوي وبذور: 34
- GRN, warehouse تقاوي وبذور: 23
- ISSUE, warehouse شبكات ري: 1

Sample rows:
- id 6770, item 1030002, warehouse تقاوي وبذور, GRN, value_in=0, value_out=0, note NEEDS_DIMENSION:center_code
- id 6774, item 1030234, warehouse تقاوي وبذور, GRN, value_in=0, value_out=0, note NEEDS_DIMENSION:center_code
- id 6815, item 1030002, warehouse تقاوي وبذور, ISSUE, value_in=0, value_out=0
- id 6821, item 1030259, warehouse تقاوي وبذور, ISSUE, value_in=0, value_out=0
- id 6822, item 1030003, warehouse تقاوي وبذور, ISSUE, value_in=0, value_out=0

Assessment:
- Inventory exempt rows are operational zero-value records, correctly marked and traceable.

## 4. Control Implication
- KPI should continue to be evaluated as:
  linked + exempt_zero_value + unresolved_actionable = total operational events.
- Exempt rows should remain visible in monitoring but excluded from actionable-linkage SLA.

## 5. Final Decision
Zero-value exemption policy remains VALID.
No hidden actionable posting defects were found in the reviewed 85-row exempt population.
