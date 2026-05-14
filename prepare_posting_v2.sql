-- 1. Create missing Business Events for Inventory GRN Movements
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
WHERE company_id = 1 
  AND movement_type = 'GRN' 
  AND journal_entry_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM business_events be 
    WHERE be.source_module='inventory' AND be.source_id=inventory_movements.id
  );

-- 2. Create missing Business Events for Supplier Transactions (safety)
INSERT INTO business_events (company_id, event_type, event_date, source_module, source_id, payload, status, created_at)
SELECT 
  company_id, 
  'supplier_transaction', 
  transaction_date, 
  'suppliers', 
  id, 
  json_object('amount', amount, 'supplier_code', supplier_code),
  'pending',
  datetime('now')
FROM supplier_transactions
WHERE company_id = 1 
  AND journal_entry_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM business_events be 
    WHERE be.source_module='suppliers' AND be.source_id=supplier_transactions.id
  );

-- 3. Ensure status is 'posted'
UPDATE inventory_movements SET status = 'posted' WHERE company_id = 1 AND status = 'pending';
