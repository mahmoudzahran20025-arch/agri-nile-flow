SELECT 'supplier_transactions' as tbl, COUNT(*) as total,
  SUM(CASE WHEN posting_status='posted' THEN 1 ELSE 0 END) as posted,
  SUM(CASE WHEN posting_status='pending' THEN 1 ELSE 0 END) as pending,
  SUM(CASE WHEN posting_status='future_blocked' THEN 1 ELSE 0 END) as future_blocked,
  SUM(CASE WHEN posting_status NOT IN ('posted','pending','future_blocked','cancelled') THEN 1 ELSE 0 END) as other
FROM supplier_transactions
UNION ALL
SELECT 'inventory_movements', COUNT(*),
  SUM(CASE WHEN posting_status='posted' THEN 1 ELSE 0 END),
  SUM(CASE WHEN posting_status='pending' THEN 1 ELSE 0 END),
  SUM(CASE WHEN posting_status='future_blocked' THEN 1 ELSE 0 END),
  SUM(CASE WHEN posting_status NOT IN ('posted','pending','future_blocked','cancelled') THEN 1 ELSE 0 END)
FROM inventory_movements
UNION ALL
SELECT 'cash_transactions', COUNT(*),
  SUM(CASE WHEN posting_status='posted' THEN 1 ELSE 0 END),
  SUM(CASE WHEN posting_status='pending' THEN 1 ELSE 0 END),
  SUM(CASE WHEN posting_status='future_blocked' THEN 1 ELSE 0 END),
  SUM(CASE WHEN posting_status NOT IN ('posted','pending','future_blocked','cancelled') THEN 1 ELSE 0 END)
FROM cash_transactions
UNION ALL
SELECT 'journal_entries', COUNT(*),
  SUM(CASE WHEN status='posted' THEN 1 ELSE 0 END),
  SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),
  SUM(CASE WHEN status='future_blocked' THEN 1 ELSE 0 END),
  SUM(CASE WHEN status NOT IN ('posted','pending','future_blocked','cancelled') THEN 1 ELSE 0 END)
FROM journal_entries
UNION ALL
SELECT 'journal_entry_lines', COUNT(*), NULL, NULL, NULL, NULL FROM journal_entry_lines
UNION ALL
SELECT 'business_events', COUNT(*), NULL, NULL, NULL, NULL FROM business_events
UNION ALL
SELECT 'suppliers', COUNT(*), NULL, NULL, NULL, NULL FROM suppliers
UNION ALL
SELECT 'items', COUNT(*), NULL, NULL, NULL, NULL FROM items
UNION ALL
SELECT 'service_types', COUNT(*), NULL, NULL, NULL, NULL FROM service_types
UNION ALL
SELECT 'posting_rules', COUNT(*), NULL, NULL, NULL, NULL FROM posting_rules;
