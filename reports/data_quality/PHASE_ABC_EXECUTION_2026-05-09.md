# Phase A/B/C Execution Report (2026-05-09)

## Scope

- Phase A: close 4 missing labor supplier dimensions to 100%.
- Phase B: expand cash narration mapping for highest buckets ("مخزون", "مستخلص اعمال رقم(...)").
- Phase C: ratchet data-quality thresholds upward while keeping enforce_gates=1.
- Additional: check potential posting gaps.

## Baseline (Before Execution)

- supplier center coverage: 68.37%
- supplier expense coverage: 68.37%
- cash center coverage: 20.29%
- cash expense coverage: 10.14%

## Phase A Applied

Updated rows in supplier_transactions:
- 3744 -> center_code=1006005, expense_category=عمالة
- 3809 -> center_code=1006005, expense_category=عمالة
- 3815 -> center_code=1006011, expense_category=عمالة
- 3849 -> center_code=1006005, expense_category=عمالة

Rows changed: 4

Labor suppliers subset after Phase A:
- total: 18
- center complete: 18/18
- expense complete: 18/18
- unit complete: 18/18
- quantity complete: 18/18
- unit_price complete: 18/18

## Phase B Applied

Mapping rules applied on cash_transactions where dimensions were missing:

1) narration = "مخزون"
- center_code: supplier-based default (implemented default center=1006003)
- expense_code: 35001
- rows changed: 33

2) narration LIKE "مستخلص اعمال رقم(%"
- center_code: 1006011
- expense_code: 33067
- rows changed: 21

## KPI After A+B

- supplier center coverage: 69.65% (up from 68.37%)
- supplier expense coverage: 69.65% (up from 68.37%)
- cash center coverage: 98.55% (up from 20.29%)
- cash expense coverage: 88.41% (up from 10.14%)

Residual cash gaps:
- total rows with missing center or expense: 8
- buckets:
  - direction=د, narration="طايل مشحوت عرفة": 5
  - direction=د, narration="جهاز مستقبل مصر للتنمية المستدامة": 2
  - direction=م, narration="شراء لاب توب ديل": 1

## Phase C Ratchet Applied

data_quality_control updated to:
- min_supplier_center_pct = 69
- min_supplier_expense_pct = 69
- min_cash_center_pct = 90
- min_cash_expense_pct = 80
- enforce_gates = 1

Policy pass check after ratchet:
- PASS (1)

## Posting Integrity Check

Core integrity checks:
- broken journal links across source tables: 0
- orphan journal lines: 0
- unbalanced journal entries: 0
- header account lines used in journal: 0

Potential posting gap discovered:
- supplier_transactions with status='posted' and journal_entry_id IS NULL: 135
- All 135 rows are explicitly flagged in notes with NEEDS_POSTING_LINK:supplier_journal
- Type split:
  - entry_type='د': 112
  - entry_type='م': 23
- Date range: 2026-01-11 to 2026-12-31

Interpretation:
- This is not a hidden corruption case; it is an explicit deferred-posting queue that still needs controlled backfill posting.

## Strict Policy Risk Note

For cash_expense_pct strict target 90:
- current = 88.41%
- inflow rows (direction='د') with expense_code NULL = 7
- outflow rows missing expense_code = 1

If inflows are intentionally kept without expense_code, 90% strict may become structurally hard to reach unless denominator logic is adjusted or inflow expense policy is defined.
