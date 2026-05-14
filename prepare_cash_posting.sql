-- 1. Create missing Business Events for Cash Transactions
INSERT INTO business_events (company_id, event_type, event_date, source_module, source_id, payload, status, created_at)
SELECT 
  company_id, 
  'cash_transaction', 
  transaction_date, 
  'cash', 
  id, 
  json_object('amount', amount, 'direction', direction, 'service_type_code', service_type_code),
  'pending',
  datetime('now')
FROM cash_transactions
WHERE company_id = 1 
  AND journal_entry_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM business_events be 
    WHERE be.source_module='cash' AND be.source_id=cash_transactions.id
  );

-- 2. Ensure status is 'posted'
UPDATE cash_transactions SET status = 'posted' WHERE company_id = 1 AND status = 'pending';
