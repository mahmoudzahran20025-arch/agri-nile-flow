PRAGMA foreign_keys = OFF;
UPDATE journal_entries SET is_posted = 0 WHERE company_id = 1;

DELETE FROM journal_entry_lines WHERE company_id = 1;
DELETE FROM journal_entries WHERE company_id = 1;
DELETE FROM posting_rule_resolutions WHERE company_id = 1;
DELETE FROM business_events WHERE company_id = 1;

DELETE FROM inventory_balances WHERE company_id = 1;
DELETE FROM stock_quants WHERE company_id = 1;
DELETE FROM inventory_movements WHERE company_id = 1;
DELETE FROM supplier_transactions WHERE company_id = 1;
DELETE FROM cash_transactions WHERE company_id = 1;

DELETE FROM items WHERE company_id = 1;
PRAGMA foreign_keys = ON;
