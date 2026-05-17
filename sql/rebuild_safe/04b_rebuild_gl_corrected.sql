-- Step 4b Rebuild (CORRECTED v2): Recreate business_events with actual schema
-- Fixes schema mismatch: transaction_date→event_date, amount→payload JSON
-- Company: 1, Date: 2026-05-09

-- Phase 1a: Create business_events from supplier_transactions
INSERT INTO business_events (
  company_id, source_module, source_id, event_type, 
  event_date, payload, status, created_at
)
SELECT 
  company_id,
  'suppliers',
  id,
  'SUPPLIER_TRANSACTION',
  transaction_date,
  json_object(
    'supplier_code', supplier_code,
    'amount', amount,
    'entry_type', entry_type,
    'description', COALESCE(description, '')
  ),
  'posted',
  COALESCE(created_at, datetime('now'))
FROM supplier_transactions
WHERE company_id = 1
  AND status = 'posted'
  AND id NOT IN (SELECT source_id FROM business_events WHERE company_id = 1 AND source_module = 'suppliers')
ON CONFLICT DO NOTHING;

-- Phase 1b: Create business_events from cash_transactions
INSERT INTO business_events (
  company_id, source_module, source_id, event_type, 
  event_date, payload, status, created_at
)
SELECT 
  company_id,
  'cash',
  id,
  'CASH_TRANSACTION',
  transaction_date,
  json_object(
    'account_code', expense_code,
    'amount', amount,
    'direction', direction,
    'narration', COALESCE(narration, '')
  ),
  'posted',
  COALESCE(created_at, datetime('now'))
FROM cash_transactions
WHERE company_id = 1
  AND status = 'posted'
  AND id NOT IN (SELECT source_id FROM business_events WHERE company_id = 1 AND source_module = 'cash')
ON CONFLICT DO NOTHING;

-- Phase 1c: Create business_events from inventory_movements
INSERT INTO business_events (
  company_id, source_module, source_id, event_type, 
  event_date, payload, status, created_at
)
SELECT 
  company_id,
  'inventory',
  id,
  'INVENTORY_MOVEMENT',
  movement_date,
  json_object(
    'item_code', item_code,
    'quantity', quantity,
    'unit_price', unit_price,
    'value_in', value_in,
    'value_out', value_out,
    'movement_type', movement_type
  ),
  'posted',
  COALESCE(created_at, datetime('now'))
FROM inventory_movements
WHERE company_id = 1
  AND status = 'posted'
  AND movement_type IN ('GRN', 'ISSUE')
  AND id NOT IN (SELECT source_id FROM business_events WHERE company_id = 1 AND source_module = 'inventory')
ON CONFLICT DO NOTHING;

-- Phase 2: Verification and Summary
SELECT 
  'REBUILD_COMPLETE' as status,
  (SELECT COUNT(*) FROM business_events WHERE company_id=1 AND source_module='suppliers') as supplier_events,
  (SELECT COUNT(*) FROM business_events WHERE company_id=1 AND source_module='cash') as cash_events,
  (SELECT COUNT(*) FROM business_events WHERE company_id=1 AND source_module='inventory') as inventory_events,
  (SELECT COUNT(*) FROM business_events WHERE company_id=1) as total_events;
