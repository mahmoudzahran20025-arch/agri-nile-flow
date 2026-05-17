-- ============================================================
-- SUPPLIER DATA AUDIT - May 2, 2026
-- ============================================================

-- CHECK 1: Orphaned transactions (supplier_code not in suppliers table)
SELECT DISTINCT st.supplier_code, 'ORPHANED - not in suppliers table' as issue
FROM supplier_transactions st
LEFT JOIN suppliers s ON st.supplier_code = s.code
WHERE s.code IS NULL;

-- CHECK 2: CUSTOMER record (10100192) has bus_posting_group_code = CUSTOMER (wrong table?)
SELECT code, name, activity, bus_posting_group_code, is_active
FROM suppliers
WHERE bus_posting_group_code = 'CUSTOMER';

-- CHECK 3: Inactive suppliers with transactions
SELECT st.supplier_code, s.name, COUNT(*) as tx_count, SUM(st.debit) as debit, SUM(st.credit) as credit
FROM supplier_transactions st
JOIN suppliers s ON st.supplier_code = s.code
WHERE s.is_active = 0
GROUP BY st.supplier_code;

-- CHECK 4: supplier_code_bridge - what is it?
SELECT * FROM supplier_code_bridge LIMIT 20;

-- CHECK 5: Transactions with NULL or 0 amounts
SELECT COUNT(*) as zero_amount_count FROM supplier_transactions WHERE amount = 0 AND debit = 0 AND credit = 0;

-- CHECK 6: Transactions where debit+credit both populated (should be one or other)
SELECT COUNT(*) as both_dr_cr FROM supplier_transactions WHERE debit > 0 AND credit > 0;

-- CHECK 7: Transactions with no journal_entry_id (unlinked to GL)
SELECT supplier_code, COUNT(*) as unlinked_count, SUM(debit) as debit, SUM(credit) as credit
FROM supplier_transactions
WHERE journal_entry_id IS NULL
GROUP BY supplier_code;

-- CHECK 8: Supplier invoices summary
SELECT COUNT(*) as total_invoices, COUNT(DISTINCT supplier_code) as unique_suppliers,
       SUM(total_amount) as total_value, COUNT(CASE WHEN status='posted' THEN 1 END) as posted,
       COUNT(CASE WHEN status='draft' THEN 1 END) as draft
FROM supplier_invoices;

-- CHECK 9: supplier_invoices schema check
PRAGMA table_info(supplier_invoices);
