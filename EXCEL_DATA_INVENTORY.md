# EXCEL Data Inventory

## Scope
- Objective: Inventory and decode all source Excel files for production import.
- Company: `company_id=1` (نواة المستقبل)
- Season: `season_id=1` (الموسم الشتوي 2025-2026)

## Source Files
1. `الموردين والعملاء نواة المستقبل2025-2026.xlsx`
- Sheet `الكود`: supplier master records.
- Sheet `البيان`: supplier transactions.
- Parsed rows:
  - Supplier master total rows: 29
  - Valid supplier masters imported: 10
  - Supplier transactions total rows: 15,565
  - Valid supplier transaction rows (date-filtered): 313

2. `خزينة نواة المستقبل 2025-2026.xlsx`
- Sheet `البيان`: treasury/cash transactions.
- Parsed rows:
  - Total rows: 19,914
  - Valid transaction rows (date-filtered): 69

3. `مخازن نواة المستقبل2025-2026.xlsx`
- Sheet `البيانات`: items + inventory movements.
- Parsed rows:
  - Unique items extracted: 61
  - Valid inventory movement rows (date-filtered): 700

4. `شجرة نواة المستقبل (1).xlsx`
- Chart of accounts source.
- Status: already imported before this run (used as pre-existing master structure).

## Date Encoding Discovery (Critical)
- All transaction sheets store dates as Excel serial numbers (not `YYYY/MM/DD` strings).
- Conversion used:

```js
new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000)
```

- Validation rule used:
  - Numeric date accepted when serial is between 40000 and 55000.
  - String date fallback remains supported.

## Column Mapping Highlights
- Supplier master (`الكود`):
  - Code: first column
  - Name: second column
  - Activity: third column
  - Notes: fourth column

- Treasury (`البيان`):
  - Date: first column (`د`)
  - Direction: second column (`م`)
  - Amount: `__EMPTY_12`

- Supplier transactions (`البيان`):
  - Date: `__EMPTY`
  - Direction/type: second column (`د`)
  - Supplier code: `__EMPTY_1`
  - Amount: `__EMPTY_18`

- Inventory movements (`البيانات`):
  - Date: `__EMPTY_3`
  - Warehouse: `__EMPTY_4`
  - Supplier code: `__EMPTY_8`
  - Item code: `__EMPTY_10`
  - Quantity: `__EMPTY_22`
  - Movement type: column named `اضافة`

## Final Extraction Totals
- Suppliers: 10
- Items: 61
- Inventory movements: 700
- Cash transactions: 69
- Supplier transactions: 313
- Total generated inserts: 1,153
