# Detect all records created after 2026-04-25 (test data boundary)
- Query inventory_movements, journal_entries, business_events, cash_transactions, supplier_invoices WHERE created_at > '2026-04-25'.
- Output counts per table. Flag any that look like test rows (e.g. notes contain 'test', 'TEST', document_number like 'TEST%').
- Do NOT delete yet — just produce the list and save to archive/data_audit_post25apr.txt.
Verification:
- List exists with counts. Zero rows have document_number = 'TEST%' still in non-archived state.
