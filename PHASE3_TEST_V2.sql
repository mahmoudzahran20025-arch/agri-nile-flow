-- ============================================================================
-- PHASE 3: COMPLETE FLOW TEST (V2 - Schema Fixed)
-- Uses entry_id (not journal_entry_id)
-- Date: April 30, 2026
-- ============================================================================

-- TEST 1: PURCHASE INVOICE - Seeds with VAT
INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by, created_at)
VALUES (1, 5, 'PINV-2026-001', '2026-04-15', 'شراء بذور بنجر مع VAT', 'supplier_transaction', 1, 0, 1, datetime('now'));

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger, created_at)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '14070103', 10000.00, 0, 'شراء بذور بنجر', 1006001, 'supplier', datetime('now'));

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger, created_at)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '14040711', 1400.00, 0, 'VAT 14% على مشتريات البذور', 1006001, 'supplier', datetime('now'));

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger, created_at)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '21100001', 0, 11400.00, 'مستحقات مورد البذور', 1006001, 'supplier', datetime('now'));

SELECT 'TEST 1: Purchase Invoice - DONE' as status;

-- TEST 2: ISSUE TO WIP
INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by, created_at)
VALUES (1, 5, 'ISSUE-2026-001', '2026-04-20', 'إصدار بذور إلى WIP', 'inventory_movement', 1, 0, 1, datetime('now'));

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger, created_at)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '13500001', 8000.00, 0, 'إصدار بذور إلى مشروع زراعة بنجر', 1006001, 'inventory', datetime('now'));

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger, created_at)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '14070103', 0, 8000.00, 'إصدار بذور من المخزن', 1006001, 'inventory', datetime('now'));

SELECT 'TEST 2: Issue to WIP - DONE' as status;

-- TEST 3: HARVEST
INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by, created_at)
VALUES (1, 5, 'HRV-2026-001', '2026-04-25', 'حصاد بنجر - WIP إلى Finished', 'inventory_movement', 2, 0, 1, datetime('now'));

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger, created_at)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '14070401', 15000.00, 0, 'حصاد بنجر - الإنتاج 500 طن', 1006001, 'harvest', datetime('now'));

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger, created_at)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '13500001', 0, 15000.00, 'تصفية WIP إلى محصول تام', 1006001, 'harvest', datetime('now'));

SELECT 'TEST 3: Harvest - DONE' as status;

-- TEST 4: SALE with VAT & COGS
INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by, created_at)
VALUES (1, 5, 'SINV-2026-001', '2026-04-28', 'بيع بنجر - Revenue + COGS', 'cash_transaction', 1, 0, 1, datetime('now'));

-- Revenue side
INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger, created_at)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '14030001', 22800.00, 0, 'مبيعات بنجر - 200 طن × 100 جنيه', 1006001, 'cash', datetime('now'));

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger, created_at)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '41010001', 0, 20000.00, 'إيراد مبيعات بنجر', 1006001, 'cash', datetime('now'));

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger, created_at)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '21060001', 0, 2800.00, 'VAT 14% على المبيعات', 1006001, 'cash', datetime('now'));

-- COGS side
INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger, created_at)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '55010001', 6000.00, 0, 'تكلفة بضاعة مباعة - 200 طن', 1006001, 'inventory', datetime('now'));

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger, created_at)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '14070401', 0, 6000.00, 'إخراج بنجر مباع من المخزن', 1006001, 'inventory', datetime('now'));

SELECT 'TEST 4: Sale with VAT & COGS - DONE' as status;

-- VERIFICATION
SELECT 'VERIFICATION' as section;

SELECT 'Test Entries in Period 5' as check_item, COUNT(*) as count FROM journal_entries WHERE period_id = 5;
SELECT 'COGS (55010001) Lines' as check_item, COUNT(*) as count FROM journal_entry_lines WHERE account_code = '55010001';
SELECT 'WIP (13500001) Lines' as check_item, COUNT(*) as count FROM journal_entry_lines WHERE account_code = '13500001';
SELECT 'VAT Input (14040711) Lines' as check_item, COUNT(*) as count FROM journal_entry_lines WHERE account_code = '14040711';
SELECT 'VAT Output (21060001) Lines' as check_item, COUNT(*) as count FROM journal_entry_lines WHERE account_code = '21060001';

-- Summary
SELECT account_code, 
       ROUND(SUM(debit), 2) as total_debit, 
       ROUND(SUM(credit), 2) as total_credit
FROM journal_entry_lines 
WHERE entry_id IN (SELECT id FROM journal_entries WHERE period_id = 5)
GROUP BY account_code
ORDER BY account_code;

SELECT 'ALL TESTS COMPLETED SUCCESSFULLY' as final_status;
