-- ============================================================================
-- SMOKE TEST: INSERT 5 SCENARIOS
-- ============================================================================

-- SCENARIO 1: PURCHASE INVOICE WITH VAT
INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by)
VALUES (1, 5, 'SMOKE-PINV-001', '2026-04-30', 'Smoke Test: Purchase Seeds with VAT', 'supplier_transaction', 9991, 0, 1);

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '14070103', 5000.00, 0, 'Seeds inventory', 1006001, 'supplier');

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '14040711', 700.00, 0, 'VAT Input 14%', 1006001, 'supplier');

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '21100001', 0, 5700.00, 'Accounts Payable', 1006001, 'supplier');

-- SCENARIO 2: ISSUE TO WIP
INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by)
VALUES (1, 5, 'SMOKE-ISSUE-001', '2026-04-30', 'Smoke Test: Issue to WIP', 'inventory_movement', 9992, 0, 1);

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '13500001', 3000.00, 0, 'WIP - Seeds issued', 1006001, 'inventory');

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '14070103', 0, 3000.00, 'Inventory out', 1006001, 'inventory');

-- SCENARIO 3: HARVEST (WIP → FINISHED GOODS)
INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by)
VALUES (1, 5, 'SMOKE-HRV-001', '2026-04-30', 'Smoke Test: Harvest WIP to Finished', 'inventory_movement', 9993, 0, 1);

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '14070401', 8000.00, 0, 'Finished goods - Beet harvest', 1006001, 'harvest');

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '13500001', 0, 8000.00, 'WIP clearance', 1006001, 'harvest');

-- SCENARIO 4: SALE WITH VAT
INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by)
VALUES (1, 5, 'SMOKE-SALE-001', '2026-04-30', 'Smoke Test: Sale with VAT', 'cash_transaction', 9994, 0, 1);

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '14030001', 11400.00, 0, 'AR - Customer', 1006001, 'cash');

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '41010001', 0, 10000.00, 'Revenue - Beet sales', 1006001, 'cash');

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '21060001', 0, 1400.00, 'VAT Output 14%', 1006001, 'cash');

-- SCENARIO 5: COGS RECOGNITION
INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by)
VALUES (1, 5, 'SMOKE-COGS-001', '2026-04-30', 'Smoke Test: COGS Recognition', 'inventory_movement', 9995, 0, 1);

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '55010001', 4000.00, 0, 'COGS - Beet sold', 1006001, 'inventory');

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '14070401', 0, 4000.00, 'Finished goods out', 1006001, 'inventory');

SELECT '5 SMOKE TEST SCENARIOS INSERTED' as status;
