# Canonical Data Audit Report
Date: 2026-05-10
Database: agri-nile-flow-data-lake (remote D1)
Scope: company_id = 1

## 1) What was executed
- Canonical audit SQL: sql/0083_canonical_data_audit.sql
- Canonical remediation SQL: sql/0084_canonical_data_remediation.sql
- Mode: remote D1 only
- Remediation method: update existing records only (no compensating journal entries)

## 2) Canonical audit KPI snapshot
- coa_total: 347
- coa_duplicate_codes: 0
- jel_orphan_account_code: 0
- jel_header_account_usage: 0
- jel_inactive_account_usage: 0
- journal_duplicate_by_source: 0
- manual_reclass_entries_detected: 0

Supplier integrity:
- supplier_posted_total: 313
- supplier_posted_missing_supplier_master: 0
- supplier_posted_missing_supplier_code: 0
- supplier_posted_missing_journal_link: 0
- supplier_master_missing_gl_account: 0
- supplier_master_gl_not_in_coa: 0

Treasury integrity:
- cash_posted_total: 69
- cash_posted_missing_journal_link: 0
- cash_posted_invalid_center_code: 0

Inventory integrity:
- inventory_posted_total: 700
- inventory_posted_missing_journal_link: 0
- inventory_receipt_missing_supplier: 66
- inventory_consumption_missing_center: 0
- inventory_transfer_missing_wh_dim: 0
- inventory_missing_warehouse_id_total (before remediation): 700
- inventory_missing_warehouse_id_resolvable_by_name: 700

## 3) Posting Dimension Policy Matrix (validated)
Policy used:
- Purchase Receipt => supplier_code required
- Inventory Consumption => center_code required
- Asset Purchase => supplier_code + equipment required
- Treasury Payment => treasury dimension (financial_account_id or expense_code in current schema)
- Supplier Payment => supplier_code required
- Inventory Transfer => from_wh + to_wh required

Critical governance finding:
- 66 GRN rows have value_in > 0 and supplier_code is NULL.
- These rows were historically tagged with NEEDS_DIMENSION:center_code, which is architecturally wrong for purchase receipts.

## 4) Remediation applied (already executed)
Applied by sql/0084_canonical_data_remediation.sql:
1. Backfilled inventory_movements.warehouse_id from warehouses.name (deterministic exact-name mapping).
2. Corrected governance tags on receipt rows:
   - from NEEDS_DIMENSION:center_code
   - to NEEDS_DIMENSION:supplier_code

## 5) Post-remediation verification
- inventory_missing_warehouse_id_after: 0 (was 700)
- inventory_receipt_missing_supplier_after: 66 (still pending manual supplier assignment)
- inventory_notes_need_center_on_grn_after: 0
- inventory_notes_need_supplier_dimension_after: 88

Interpretation:
- Warehouse dimension canonicalization is complete.
- Governance rule is now correctly aligned for purchase receipts.
- Remaining gap is true supplier attribution for 66 GRN rows.

## 6) Why 66 rows remain unresolved automatically
For missing-supplier GRN rows:
- purchase_delivery_id present: 0
- invoice_number present: 0
- po_number present: 0
- auto-inference from AP lines yields multiple supplier matches (not deterministic)

Conclusion:
- Automatic backfill is not safe without an explicit source-to-supplier mapping artifact.

## 7) Next correct step (actionable)
Execute controlled manual remediation for the remaining 66 rows:
1. Produce a mapping sheet keyed by movement_id -> supplier_code from source documents.
2. Apply single update patch to inventory_movements.supplier_code for only those movement_id values.
3. Verify no unresolved receipt row remains.
4. Re-run sql/0083_canonical_data_audit.sql and freeze snapshot.

## 8) Ready-to-run SQL for final closure
Use this once mapping is prepared:
- Update existing rows only:
  UPDATE inventory_movements
  SET supplier_code = <mapped_supplier_code>
  WHERE company_id = 1
    AND id = <movement_id>
    AND supplier_code IS NULL;

- Verify closure:
  SELECT COUNT(*)
  FROM inventory_movements
  WHERE company_id = 1
    AND status = 'posted'
    AND COALESCE(value_in, 0) > 0
    AND COALESCE(qty_in, 0) > 0
    AND (movement_type = 'اضافة' OR UPPER(movement_type) IN ('RECEIPT', 'GRN'))
    AND supplier_code IS NULL;
