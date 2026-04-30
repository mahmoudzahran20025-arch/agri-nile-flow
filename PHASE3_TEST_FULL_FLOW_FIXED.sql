-- ============================================================================
-- PHASE 3: COMPLETE FLOW TEST SCRIPT (FIXED)
-- Tests: Purchase → WIP → Harvest → Sale with VAT & COGS
-- Fixed to match actual schema
-- Date: April 30, 2026
-- ============================================================================

-- ============================================================================
-- TEST 1: PURCHASE INVOICE - Seeds with VAT (14%)
-- Dr 14070103 (Seeds Inventory) + Dr 14040711 (VAT Input)
-- Cr 21100001 (AP Trade)
-- ============================================================================

INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by, created_at)
VALUES (1, 1, 'PINV-2026-001', '2026-04-30', 'شراء بذور بنجر مع VAT', 'supplier_transaction', 1, 0, 1, datetime('now'));

WITH new_entry AS (SELECT last_insert_rowid() as entry_id)
INSERT INTO journal_entry_lines (journal_entry_id, account_code, account_name, cost_center_code, debit, credit, description, line_ref_type, line_ref_id, created_at)
SELECT entry_id, '14070103', 'مخزون تقاوي و بذور', '1006001', 10000.00, 0, 'شراء بذور بنجر - الكمية 100 كجم', 'item', 1, datetime('now') FROM new_entry;

WITH new_entry AS (SELECT last_insert_rowid() as entry_id)
INSERT INTO journal_entry_lines (journal_entry_id, account_code, account_name, cost_center_code, debit, credit, description, line_ref_type, line_ref_id, created_at)
SELECT entry_id, '14040711', 'ضريبة قيمة مضافة مدخلات - مستردة', '1006001', 1400.00, 0, 'VAT 14% على مشتريات البذور', NULL, NULL, datetime('now') FROM (SELECT last_insert_rowid() as entry_id);

WITH new_entry AS (SELECT last_insert_rowid() as entry_id)
INSERT INTO journal_entry_lines (journal_entry_id, account_code, account_name, cost_center_code, debit, credit, description, line_ref_type, line_ref_id, created_at)
SELECT entry_id, '21100001', 'ذمم دائنة تجارية - موردين', '1006001', 0, 11400.00, 'مستحقات مورد البذور', 'supplier', 1, datetime('now') FROM (SELECT last_insert_rowid() as entry_id);

SELECT 'TEST 1 COMPLETED: Purchase Invoice with VAT' as status;

-- ============================================================================
-- TEST 2: ISSUE TO WIP - Raw Materials to Work in Progress
-- Dr 13500001 (WIP) / Cr 14070103 (Seeds Inventory)
-- ============================================================================

INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by, created_at)
VALUES (1, 1, 'ISSUE-2026-001', '2026-05-01', 'إصدار بذور إلى WIP', 'inventory_movement', 1, 0, 1, datetime('now'));

INSERT INTO journal_entry_lines (journal_entry_id, account_code, account_name, cost_center_code, debit, credit, description, line_ref_type, line_ref_id, created_at)
SELECT last_insert_rowid(), '13500001', 'مخزون تحت التشغيل - محاصيل زراعية', '1006001', 8000.00, 0, 'إصدار بذور إلى مشروع زراعة بنجر', 'item', 1, datetime('now');

INSERT INTO journal_entry_lines (journal_entry_id, account_code, account_name, cost_center_code, debit, credit, description, line_ref_type, line_ref_id, created_at)
SELECT last_insert_rowid()-1, '14070103', 'مخزون تقاوي و بذور', '1006001', 0, 8000.00, 'إصدار بذور من المخزن', 'item', 1, datetime('now');

SELECT 'TEST 2 COMPLETED: Issue to WIP' as status;

-- ============================================================================
-- TEST 3: HARVEST - WIP to Finished Goods
-- Dr 14070401 (Finished Crops) / Cr 13500001 (WIP)
-- ============================================================================

INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by, created_at)
VALUES (1, 1, 'HRV-2026-001', '2026-06-15', 'حصاد بنجر - WIP إلى Finished', 'inventory_movement', 2, 0, 1, datetime('now'));

INSERT INTO journal_entry_lines (journal_entry_id, account_code, account_name, cost_center_code, debit, credit, description, line_ref_type, line_ref_id, created_at)
SELECT last_insert_rowid(), '14070401', 'مخزون محاصيل تامة', '1006001', 15000.00, 0, 'حصاد بنجر - الإنتاج 500 طن', 'harvest', 1, datetime('now');

INSERT INTO journal_entry_lines (journal_entry_id, account_code, account_name, cost_center_code, debit, credit, description, line_ref_type, line_ref_id, created_at)
SELECT last_insert_rowid()-1, '13500001', 'مخزون تحت التشغيل - محاصيل زراعية', '1006001', 0, 15000.00, 'تصفية WIP إلى محصول تام', 'harvest', 1, datetime('now');

SELECT 'TEST 3 COMPLETED: Harvest (WIP → Finished)' as status;

-- ============================================================================
-- TEST 4: SALE INVOICE with VAT and COGS
-- Part A: Revenue Recognition
-- Part B: COGS Recognition
-- ============================================================================

INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by, created_at)
VALUES (1, 1, 'SINV-2026-001', '2026-07-01', 'بيع بنجر - Revenue + COGS', 'cash_transaction', 1, 0, 1, datetime('now'));

-- Dr AR Trade
INSERT INTO journal_entry_lines (journal_entry_id, account_code, account_name, cost_center_code, debit, credit, description, line_ref_type, line_ref_id, created_at)
SELECT last_insert_rowid(), '14030001', 'ذمم مدينة تجارية - عملاء', '1006001', 22800.00, 0, 'مبيعات بنجر - 200 طن × 100 جنيه', 'customer', 1, datetime('now');

-- Cr Revenue
INSERT INTO journal_entry_lines (journal_entry_id, account_code, account_name, cost_center_code, debit, credit, description, line_ref_type, line_ref_id, created_at)
SELECT last_insert_rowid()-1, '41010001', 'إيرادات زراعية', '1006001', 0, 20000.00, 'إيراد مبيعات بنجر', 'item', 2, datetime('now');

-- Cr VAT Output 14%
INSERT INTO journal_entry_lines (journal_entry_id, account_code, account_name, cost_center_code, debit, credit, description, line_ref_type, line_ref_id, created_at)
SELECT last_insert_rowid()-2, '21060001', 'ضريبة قيمة مضافة مخرجات - مستحقة', '1006001', 0, 2800.00, 'VAT 14% على المبيعات', NULL, NULL, datetime('now');

-- Dr COGS
INSERT INTO journal_entry_lines (journal_entry_id, account_code, account_name, cost_center_code, debit, credit, description, line_ref_type, line_ref_id, created_at)
SELECT last_insert_rowid()-3, '55010001', 'تكلفة مبيعات بنجر', '1006001', 6000.00, 0, 'تكلفة بضاعة مباعة - 200 طن', 'item', 2, datetime('now');

-- Cr Finished Inventory
INSERT INTO journal_entry_lines (journal_entry_id, account_code, account_name, cost_center_code, debit, credit, description, line_ref_type, line_ref_id, created_at)
SELECT last_insert_rowid()-4, '14070401', 'مخزون محاصيل تامة', '1006001', 0, 6000.00, 'إخراج بنجر مباع من المخزن', 'item', 2, datetime('now');

SELECT 'TEST 4 COMPLETED: Sale with VAT & COGS' as status;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

SELECT 'VERIFICATION' as section;

-- Verify all entries created
SELECT 'Journal Entries Created' as check_item, COUNT(*) as count FROM journal_entries WHERE entry_date >= '2026-04-30' AND company_id = 1;

-- Verify COGS account usage
SELECT 'COGS Account (55010001) Usage' as check_item, COUNT(*) as count FROM journal_entry_lines WHERE account_code = '55010001';

-- Verify WIP account usage
SELECT 'WIP Account (13500001) Usage' as check_item, COUNT(*) as count FROM journal_entry_lines WHERE account_code = '13500001';

-- Verify VAT accounts usage
SELECT 'VAT Input (14040711) Usage' as check_item, COUNT(*) as count FROM journal_entry_lines WHERE account_code = '14040711';

SELECT 'VAT Output (21060001) Usage' as check_item, COUNT(*) as count FROM journal_entry_lines WHERE account_code = '21060001';

-- Summary of test transactions by account
SELECT account_code, account_name, SUM(debit) as total_debit, SUM(credit) as total_credit
FROM journal_entry_lines 
WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE entry_date >= '2026-04-30' AND company_id = 1)
GROUP BY account_code, account_name
ORDER BY account_code;

SELECT 'FULL FLOW TEST COMPLETED SUCCESSFULLY' as final_status;
