# Verify every paid supplier invoice has a matching GL entry
- Query: SELECT si.id, si.amount FROM supplier_invoices si LEFT JOIN journal_entries je ON je.source_id=si.id AND je.source_type='supplier_invoice' WHERE si.status='paid' AND je.id IS NULL.
- If rows found: enqueue them via POST /gl/reconciliation/repair or log for manual review.
- Count before/after and document in archive/data_audit_supplier_gl.txt.
Verification:
- Query returns 0 after fix. reconciliation page shows no supplier GL gaps.
