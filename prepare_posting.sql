-- 1. Create Business Events for Supplier Transactions
INSERT INTO business_events (company_id, event_type, event_date, source_module, source_id, payload, status, created_at)
SELECT 
  company_id, 
  'supplier_transaction', 
  transaction_date, 
  'suppliers', 
  id, 
  json_object('amount', amount, 'supplier_code', supplier_code, 'service_type_code', service_type_code),
  'pending',
  datetime('now')
FROM supplier_transactions
WHERE company_id = 1 AND journal_entry_id IS NULL;

-- 2. Create Business Events for Cash Transactions
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
WHERE company_id = 1 AND journal_entry_id IS NULL;

-- 3. Create Business Events for Inventory GRN Movements
INSERT INTO business_events (company_id, event_type, event_date, source_module, source_id, payload, status, created_at)
SELECT 
  company_id, 
  'inventory_movement', 
  movement_date, 
  'inventory', 
  id, 
  json_object('item_code', item_code, 'quantity', quantity, 'movement_type', movement_type),
  'pending',
  datetime('now')
FROM inventory_movements
WHERE company_id = 1 AND movement_type = 'GRN' AND journal_entry_id IS NULL;

-- 4. Update status to 'posted' so execute_posting_job.js picks them up
UPDATE supplier_transactions SET status = 'posted' WHERE company_id = 1 AND status = 'pending';
UPDATE cash_transactions SET status = 'posted' WHERE company_id = 1 AND status = 'pending';
UPDATE inventory_movements SET status = 'posted' WHERE company_id = 1 AND status = 'pending';
