-- 1. Create missing Business Events for ALL Inventory Movements (GRN and ISSUE)
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
  AND journal_entry_id IS NULL
  AND gl_posting_status != 'exempt_zero_value'
  AND NOT EXISTS (
    SELECT 1 FROM business_events be 
    WHERE be.source_module='inventory' AND be.source_id=inventory_movements.id
  );

-- 2. Ensure status is 'posted'
UPDATE inventory_movements SET status = 'posted' WHERE company_id = 1 AND status = 'pending';
