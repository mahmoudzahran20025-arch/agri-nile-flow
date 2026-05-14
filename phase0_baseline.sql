-- Phase 0: Baseline capture (Split to avoid compound SELECT limits)
SELECT 'suppliers' as t, COUNT(*) as count FROM suppliers WHERE company_id=1;
SELECT 'supplier_transactions' as t, COUNT(*) as count FROM supplier_transactions WHERE company_id=1;
SELECT 'cash_transactions' as t, COUNT(*) as count FROM cash_transactions WHERE company_id=1;
SELECT 'inventory_movements' as t, COUNT(*) as count FROM inventory_movements WHERE company_id=1;
SELECT 'business_events' as t, COUNT(*) as count FROM business_events WHERE company_id=1;
SELECT 'journal_entries' as t, COUNT(*) as count FROM journal_entries WHERE company_id=1;
SELECT 'journal_entry_lines' as t, COUNT(*) as count FROM journal_entry_lines WHERE company_id=1;

-- Confirm GL balance = 0 before wipe
SELECT SUM(debit)-SUM(credit) as gl_balance
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id=jel.entry_id
WHERE je.company_id=1;
