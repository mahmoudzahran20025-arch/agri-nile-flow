-- Step 4 Wipe (Surgical)
-- Unpost first to avoid triggers
UPDATE journal_entries SET is_posted = 0 
WHERE company_id = 1 AND ref_type = 'inventory_movement';

DELETE FROM inventory_balances WHERE company_id=1;

DELETE FROM journal_entry_lines
WHERE entry_id IN (
  SELECT id FROM journal_entries WHERE ref_type = 'inventory_movement' AND company_id = 1
);

DELETE FROM journal_entries 
WHERE ref_type = 'inventory_movement' AND company_id = 1;

DELETE FROM business_events 
WHERE source_module='inventory' AND company_id=1;

DELETE FROM inventory_movements WHERE company_id=1;
