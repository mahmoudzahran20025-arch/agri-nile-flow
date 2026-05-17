-- Phase 3 controlled wipe scope for company_id = 1
-- Scope: transactional + bridge/trace tables only.
-- Does NOT touch governance tables, posting rules, COA structure, or system configuration.

-- Bridge/link tables first
DELETE FROM source_document_links WHERE company_id = 1;
DELETE FROM source_documents WHERE company_id = 1;
DELETE FROM posting_rule_resolutions WHERE company_id = 1;

-- Operational tables that may still point to journal entries
DELETE FROM work_order_equipment WHERE company_id = 1;
DELETE FROM work_tasks WHERE company_id = 1;
DELETE FROM cash_transactions WHERE company_id = 1;
DELETE FROM supplier_transactions WHERE company_id = 1;
DELETE FROM inventory_movements WHERE company_id = 1;

-- GL/event trail
UPDATE journal_entries
SET is_posted = 0
WHERE company_id = 1
	AND is_posted = 1;

DELETE FROM journal_entry_lines WHERE company_id = 1;
DELETE FROM journal_entries WHERE company_id = 1;
DELETE FROM business_events WHERE company_id = 1;
