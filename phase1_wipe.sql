-- Phase 1: Controlled Wipe (downstream only)
-- Step 0: Un-post all journal entries to bypass integrity triggers
UPDATE journal_entries SET is_posted = 0 WHERE company_id = 1;

-- Step 1: Wipe dependent operational tables first (FK order)
DELETE FROM cash_transactions WHERE company_id = 1;
DELETE FROM supplier_transactions WHERE company_id = 1;
DELETE FROM inventory_movements WHERE company_id = 1;
DELETE FROM stock_quants WHERE company_id = 1;
DELETE FROM inventory_balances WHERE company_id = 1;

-- Step 2: Wipe intermediate layers
DELETE FROM business_events WHERE company_id = 1;
DELETE FROM posting_rule_resolutions WHERE company_id = 1;

-- Step 3: Wipe GL layer
DELETE FROM journal_entry_lines WHERE company_id = 1;
DELETE FROM journal_entries WHERE company_id = 1;

-- Step 4: Items (will be re-seeded from JSON)
DELETE FROM items WHERE company_id = 1;

-- Verify wipe
SELECT COUNT(*) as journal_entries FROM journal_entries WHERE company_id = 1;
SELECT COUNT(*) as supplier_transactions FROM supplier_transactions WHERE company_id = 1;
SELECT COUNT(*) as inventory_movements FROM inventory_movements WHERE company_id = 1;
SELECT COUNT(*) as items FROM items WHERE company_id = 1;
