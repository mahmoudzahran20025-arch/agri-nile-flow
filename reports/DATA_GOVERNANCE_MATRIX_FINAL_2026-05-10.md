# Data Governance Matrix (Final)
Date: 2026-05-10
Scope: Treasury, Suppliers, Inventory, Operations (GL-impacting flows)
Status: Approved as implementation baseline

## 1) Executive Summary
- Master suppliers are clean (10/10 active, no missing name/activity).
- Main governance gaps are transactional, not master-data:
  - inventory_movements has high missing supplier/document context for inbound receipts.
  - supplier_transactions mixes business statement with technical notes.
  - treasury/cash keeps good narration but lacks unified service taxonomy.
- Recommended sequence:
  1. Lock required fields by movement type.
  2. Standardize service type taxonomy.
  3. Bind taxonomy to posting rules / COA control mapping.
  4. Backfill legacy rows into the new canonical structure.

## 2) Canonical Governance Dimensions
Use these dimensions for all financial movements:
1. Counterparty: supplier_code / partner_id / employee_id
2. Document: document_type, document_number, document_date
3. Business Statement: statement_text (human meaning)
4. Service Classification: service_type_code (taxonomy)
5. Operational Dimensions: season_id, center_code, field_id, work_order_id
6. Financial Settlement: financial_account_id, payment_method
7. Traceability: source_module, source_record_id, journal_entry_id
8. Internal Notes: notes_internal (non-accounting comments only)

## 3) Final Governance Matrix

| Module | Movement | Draft Required | Posted Required | GL Mapping (DR/CR) | Validation Rules |
|---|---|---|---|---|---|
| Treasury | Cash Outflow (direction=م) with Supplier | transaction_date, amount, narration, supplier_code | + season_id, center_code (when operational), financial_account_id | DR AP (or expense) / CR Cash-Bank | amount>0, narration>=3 chars, valid active center, open period |
| Treasury | Cash Outflow (direction=م) without Supplier/Partner | transaction_date, amount, narration, expense_code | + season_id, center_code, financial_account_id | DR Expense / CR Cash-Bank | expense_code mandatory, open period, active center |
| Treasury | Cash Inflow (direction=د) | transaction_date, amount, narration | + financial_account_id (recommended), dimensions by policy | DR Cash-Bank / CR Revenue or Equity | amount>0, open period, contra account resolvable |
| Suppliers | Supplier Invoice (entry_type=د) | transaction_date, amount, supplier_code | + season_id, center_code | DR Purchases/Service Expense / CR AP | supplier must exist+active, open period, AP resolvable |
| Suppliers | Supplier Payment (entry_type=م) | transaction_date, amount, supplier_code | + season_id, center_code, financial_account_id | DR AP / CR Cash-Bank | financial_account_id required, cash mirror must succeed or fail atomic flow |
| Suppliers | Equipment Owned Capital | equipment_type_id, equipment_usage_mode=owned | + posted only, season_id, center_code | DR Asset/Expense by rule / CR AP | owned+capital cannot stay draft, fixed asset link required |
| Inventory | GRN | movement_date, warehouse, item_code, quantity | + supplier_code, document_number, season_id, center_code policy | DR Inventory / CR AP (or Cash mirror if payment_method=cash) | supported movement_type, open period, lock date check, zero-value policy |
| Inventory | ISSUE | movement_date, warehouse, item_code, quantity | + season_id, center_code, statement/service reason | DR Expense/COGS / CR Inventory | stock sufficiency, no future negative stock, active center |
| Inventory | RETURN_SUPPLIER | movement_date, warehouse, item_code, quantity | + supplier_code, original document reference | DR AP or Cash / CR Inventory | supplier linkage mandatory, reversal trace required |
| Inventory | RETURN_CUSTOMER | movement_date, warehouse, item_code, quantity | + customer/counterparty policy | DR Inventory / CR COGS or liability | reverse-flow mapping consistency |
| Inventory | TRANSFER | movement_date, item_code, quantity, from_warehouse, to_warehouse | same + reason | DR Destination Inventory / CR Source Inventory | from!=to, stock sufficiency, lock date, open period |
| Operations | Work Order Labor | date, amount, work_order_id | + season_id, center_code | DR Labor Expense/COGS / CR Wages Payable | control accounts required (labor_expense, wages_payable) |
| Operations | Equipment Rental on WO | task_date, hours, cost_per_hour, supplier_code | + operation_id, season/center policy | DR Ops Expense/COGS / CR AP or Cash | idempotency enforced by operation_id, supplier required for rental |

## 4) Service Type Taxonomy (Mandatory)
Current data includes mixed labels/codes: "ميكنة", "عمالة", "31001", "33003".
Governance requires one canonical service_type_code.

### Canonical fields
- service_type_code (stable code, e.g. SRV_MECH)
- service_type_name_ar (e.g. ميكنة)
- service_group (MECHANIZATION, LABOR, SUPPLY, LOGISTICS, OTHER)
- default_expense_account_code
- default_ap_account_code (optional override)
- requires_supplier (0/1)
- requires_document (0/1)
- requires_center (0/1)
- is_active

### Suggested initial mapping
- SRV_MECH -> ميكنة -> expense role: mechanization expense
- SRV_LABOR -> عمالة -> expense role: labor expense
- SRV_SUPPLY -> توريد/مشتريات -> expense role: purchases
- SRV_LOGISTICS -> نقل/شحن -> expense role: logistics expense

## 5) Supplier Impact on COA
- Supplier subledger remains in supplier_transactions.
- GL control remains centralized under Accounts Payable.
- Optional: supplier-specific AP override via mapping table (only when required by policy).
- Never infer supplier from narration text; supplier_code is the authoritative key.

## 6) Mandatory Validation Rules (Implementation-Ready)
1. Reject posted supplier payment without financial_account_id.
2. Reject posted GRN without supplier_code and document_number.
3. Reject posted ISSUE without center_code and service_type_code.
4. Reject any posted movement missing statement_text.
5. Block technical tags (NEEDS_DIMENSION, NEEDS_POSTING_LINK) from business notes; move to governance flags.
6. Block unknown service_type_code.
7. Require open financial period for all posted financial movements.
8. Require active center_code when provided.

## 7) Data Quality KPIs
- % posted rows with supplier_code (where requires_supplier=1)
- % posted rows with document_number (where requires_document=1)
- % posted rows with service_type_code
- % posted rows with journal_entry_id
- % rows with notes containing technical governance tags (target: 0)

## 8) Rollout Plan
Phase A (Hard Validation):
- Enable required-field validation in APIs by movement type.
- Enforce service_type_code on new posted rows.

Phase B (Schema + Backfill):
- Add canonical governance columns.
- Backfill service_type_code from legacy expense_category/labels.
- Move technical note tags to dedicated governance flags.

Phase C (UI Alignment):
- Replace free text classification with controlled dropdowns.
- Add explicit Statement field in all entry forms.

## 9) Source of Truth in Code
- Treasury validations and posting: src/api/treasury.ts, src/lib/finance/resolvers/cash.ts
- Supplier validations and posting: src/api/suppliers.ts, src/lib/finance/resolvers/suppliers.ts
- Inventory validations and outbox posting: src/api/inventory/movements.ts, src/lib/finance/resolvers/inventory.ts
- Operations posting: src/lib/finance/resolvers/operations.ts
