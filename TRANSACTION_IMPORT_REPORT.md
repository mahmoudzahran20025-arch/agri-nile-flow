# Transaction Import Report

## Scope
Phase 6 transaction import into remote D1 (`agri-nile-flow-data-lake`).

## Generated SQL (Phase 6)
- Inventory movements: `06a_inventory_movements_batch001..007.sql` (700 rows)
- Cash transactions: `06b_cash_transactions_batch001.sql` (69 rows)
- Supplier transactions: `06c_supplier_transactions_batch001..004.sql` (313 rows)

## Execution Result
- All Phase 6 files executed successfully in remote mode.
- Imported statement totals:
  - Inventory movements: 700
  - Cash transactions: 69
  - Supplier transactions: 313
  - Phase 6 total: 1,082

## Integrity Verification (Remote D1)
- Row counts:
  - `inventory_movements`: 700
  - `cash_transactions`: 69
  - `supplier_transactions`: 313

- Null/zero checks:
  - `inventory_movements` with null date: 0
  - `cash_transactions` with null/zero amount: 0
  - `supplier_transactions` with null/zero amount: 27

- Reference integrity checks:
  - Supplier FK missing from supplier transactions: 0
  - Item FK missing from inventory movements: 0

## Interpretation of 27 Zero-Amount Supplier Transactions
- These rows originate from source accounting entries with zero monetary amount (non-cash adjustments/memo-style records).
- They are preserved as-is for source fidelity.

## Duplicate Indicator Checks
Grouped duplicate-like signatures were detected in source-shaped data patterns:
- Supplier transactions grouped by `(supplier_code, transaction_date, amount)` include repeated keys (up to count 5).
- Inventory movements grouped by `(item_code, movement_date, quantity)` include repeated keys (up to count 10).

These are treated as potential business repeats unless a stronger document-level unique key policy is introduced.

## Conclusion
Phase 6 import is complete and consistent with decoded Excel source behavior.
