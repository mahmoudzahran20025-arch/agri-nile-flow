SELECT 
  (SELECT SUM(debit)-SUM(credit) 
   FROM journal_entry_lines jel 
   JOIN journal_entries je ON je.id=jel.entry_id 
   WHERE je.company_id=1) as gl_balance,
  (SELECT COUNT(*) FROM journal_entries WHERE company_id=1) as total_je,
  (SELECT COUNT(*) FROM items WHERE company_id=1 
   AND name NOT LIKE 'صنف %') as real_named_items,
  (SELECT COUNT(*) FROM inventory_movements WHERE company_id=1) as total_movements,
  (SELECT COUNT(*) FROM supplier_transactions WHERE company_id=1) as total_supplier_txns,
  (SELECT COUNT(*) FROM cash_transactions WHERE company_id=1) as total_cash_txns;

-- Check for any unposted GRN movements
SELECT COUNT(*) as unposted_grn
FROM inventory_movements 
WHERE company_id=1 AND movement_type='GRN' AND journal_entry_id IS NULL;

-- Check for any unposted supplier transactions (with amount > 0)
SELECT COUNT(*) as unposted_supplier
FROM supplier_transactions
WHERE company_id=1 AND journal_entry_id IS NULL AND (amount > 0 OR credit > 0 OR debit > 0);

-- Check for any unposted cash transactions (with amount > 0)
SELECT COUNT(*) as unposted_cash
FROM cash_transactions
WHERE company_id=1 AND journal_entry_id IS NULL AND amount > 0;
