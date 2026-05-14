-- Full clean reseed wipe for company_id = 1
-- Purpose: reset operational and transactional data to allow clean re-entry.
-- Keeps schema, governance setup, service taxonomy, posting rules, and chart structures.

-- Child/bridge and trace tables
DELETE FROM source_document_links;
DELETE FROM source_documents;
DELETE FROM posting_rule_resolutions;
DELETE FROM posting_trace_log;
DELETE FROM trace_reconciliation_state;
DELETE FROM batch_post_job_items;
DELETE FROM batch_post_jobs;
DELETE FROM inventory_posting_outbox;
DELETE FROM inventory_adjustment_lines;
DELETE FROM inventory_adjustments;
DELETE FROM supplier_invoice_items;
DELETE FROM purchase_order_items;
DELETE FROM work_order_equipment;
DELETE FROM work_tasks;

-- Primary operational transactions
DELETE FROM bank_reconciliations;
DELETE FROM bank_statements;
DELETE FROM cash_transactions WHERE company_id = 1;
DELETE FROM supplier_transactions WHERE company_id = 1;
DELETE FROM inventory_transactions WHERE company_id = 1;
DELETE FROM inventory_movements WHERE company_id = 1;
DELETE FROM supplier_invoices WHERE company_id = 1;
DELETE FROM purchase_orders WHERE company_id = 1;
DELETE FROM work_orders WHERE company_id = 1;
DELETE FROM business_events WHERE company_id = 1;

-- GL and balances
UPDATE journal_entries
SET is_posted = 0
WHERE company_id = 1;

DELETE FROM journal_entry_lines WHERE company_id = 1;
DELETE FROM journal_entries WHERE company_id = 1;
DELETE FROM account_balances WHERE company_id = 1;
DELETE FROM period_account_balances WHERE company_id = 1;
DELETE FROM supplier_balance_snapshots WHERE company_id = 1;
DELETE FROM inventory_balances WHERE company_id = 1;
DELETE FROM stock_quants WHERE company_id = 1;
DELETE FROM wip_balances WHERE company_id = 1;

-- Master operational data to be re-entered cleanly
DELETE FROM suppliers WHERE company_id = 1;
DELETE FROM items WHERE company_id = 1;
