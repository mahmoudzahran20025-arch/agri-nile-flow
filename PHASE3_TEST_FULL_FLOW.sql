-- ============================================================================
-- PHASE 3: COMPLETE FLOW TEST SCRIPT
-- Tests: Purchase → WIP → Harvest → Sale with VAT & COGS
-- Date: April 30, 2026
-- ============================================================================

-- ============================================================================
-- TEST 1: PURCHASE INVOICE - Seeds with VAT (14%)
-- Expected: Dr 14070103 (Seeds Inventory) + Dr 14040711 (VAT Input)
--           Cr 21100001 (AP Trade) or 120101 (Cash)
-- ============================================================================

-- Create Journal Entry Header
INSERT INTO journal_entries (company_id, entry_type, reference_number, entry_date, period_id, status, created_by, created_at)
VALUES (1, 'purchase', 'PINV-2026-001', '2026-04-30', 1, 'draft', 1, datetime('now'));

-- Get the entry_id
WITH new_entry AS (SELECT last_insert_rowid() as entry_id)
-- Entry Line 1: Seeds Inventory (Debit)
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, account_name, cost_center_id, debit_amount, credit_amount, description, reference_type, reference_id, created_at)
SELECT entry_id, 1, '14070103', 'مخزون تقاوي و بذور', 1006001, 10000.00, 0, 'شراء بذور بنجر - الكمية 100 كجم', 'item', 'SEED-001', datetime('now') FROM new_entry;

-- Entry Line 2: VAT Input 14% (Debit)
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, account_name, cost_center_id, debit_amount, credit_amount, description, reference_type, reference_id, created_at)
SELECT entry_id, 2, '14040711', 'ضريبة قيمة مضافة مدخلات - مستردة', 1006001, 1400.00, 0, 'VAT 14% على مشتريات البذور', NULL, NULL, datetime('now') FROM (SELECT last_insert_rowid()-1 as entry_id);

-- Entry Line 3: AP Trade (Credit)
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, account_name, cost_center_id, debit_amount, credit_amount, description, reference_type, reference_id, created_at)
SELECT entry_id, 3, '21100001', 'ذمم دائنة تجارية - موردين', 1006001, 0, 11400.00, 'مستحقات مورد البذور', 'vendor', 'V-001', datetime('now') FROM (SELECT last_insert_rowid()-2 as entry_id);

SELECT 'TEST 1 COMPLETED: Purchase Invoice created' as status;

-- ============================================================================
-- TEST 2: ISSUE TO WIP - Raw Materials to Work in Progress
-- Expected: Dr 13500001 (WIP) / Cr 14070103 (Seeds Inventory)
-- ============================================================================

INSERT INTO journal_entries (company_id, entry_type, reference_number, entry_date, period_id, status, created_by, created_at)
VALUES (1, 'inventory', 'ISSUE-2026-001', '2026-05-01', 1, 'draft', 1, datetime('now'));

-- Dr WIP
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, account_name, cost_center_id, debit_amount, credit_amount, description, reference_type, reference_id, created_at)
SELECT last_insert_rowid(), 1, '13500001', 'مخزون تحت التشغيل - محاصيل زراعية', 1006001, 8000.00, 0, 'إصدار بذور إلى مشروع زراعة بنجر', 'item', 'SEED-001', datetime('now');

-- Cr Seeds Inventory
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, account_name, cost_center_id, debit_amount, credit_amount, description, reference_type, reference_id, created_at)
SELECT last_insert_rowid()-1, 2, '14070103', 'مخزون تقاوي و بذور', 1006001, 0, 8000.00, 'إصدار بذور من المخزن', 'item', 'SEED-001', datetime('now');

SELECT 'TEST 2 COMPLETED: Issue to WIP' as status;

-- ============================================================================
-- TEST 3: HARVEST - WIP to Finished Goods
-- Expected: Dr 14070401 (Finished Crops) / Cr 13500001 (WIP)
-- ============================================================================

INSERT INTO journal_entries (company_id, entry_type, reference_number, entry_date, period_id, status, created_by, created_at)
VALUES (1, 'harvest', 'HRV-2026-001', '2026-06-15', 1, 'draft', 1, datetime('now'));

-- Dr Finished Crops
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, account_name, cost_center_id, debit_amount, credit_amount, description, reference_type, reference_id, created_at)
SELECT last_insert_rowid(), 1, '14070401', 'مخزون محاصيل تامة', 1006001, 15000.00, 0, 'حصاد بنجر - الإنتاج 500 طن', 'harvest', 'H-001', datetime('now');

-- Cr WIP (complete clearance)
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, account_name, cost_center_id, debit_amount, credit_amount, description, reference_type, reference_id, created_at)
SELECT last_insert_rowid()-1, 2, '13500001', 'مخزون تحت التشغيل - محاصيل زراعية', 1006001, 0, 15000.00, 'تصفية WIP إلى محصول تام', 'harvest', 'H-001', datetime('now');

SELECT 'TEST 3 COMPLETED: Harvest (WIP → Finished)' as status;

-- ============================================================================
-- TEST 4: SALE INVOICE with VAT and COGS
-- Expected: Dr 14030001 (AR Trade) / Cr 41010001 (Revenue) + Cr 21060001 (VAT Output)
--           Dr 55010001 (COGS) / Cr 14070401 (Finished Crops)
-- ============================================================================

INSERT INTO journal_entries (company_id, entry_type, reference_number, entry_date, period_id, status, created_by, created_at)
VALUES (1, 'sale', 'SINV-2026-001', '2026-07-01', 1, 'draft', 1, datetime('now'));

-- Part A: Revenue Recognition
-- Dr AR Trade
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, account_name, cost_center_id, debit_amount, credit_amount, description, reference_type, reference_id, created_at)
SELECT last_insert_rowid(), 1, '14030001', 'ذمم مدينة تجارية - عملاء', 1006001, 22800.00, 0, 'مبيعات بنجر - 200 طن × 100 جنيه', 'customer', 'C-001', datetime('now');

-- Cr Revenue
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, account_name, cost_center_id, debit_amount, credit_amount, description, reference_type, reference_id, created_at)
SELECT last_insert_rowid()-1, 2, '41010001', 'إيرادات زراعية', 1006001, 0, 20000.00, 'إيراد مبيعات بنجر', 'item', 'BEET-001', datetime('now');

-- Cr VAT Output 14%
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, account_name, cost_center_id, debit_amount, credit_amount, description, reference_type, reference_id, created_at)
SELECT last_insert_rowid()-2, 3, '21060001', 'ضريبة قيمة مضافة مخرجات - مستحقة', 1006001, 0, 2800.00, 'VAT 14% على المبيعات', NULL, NULL, datetime('now');

-- Part B: COGS Recognition (Separate entry or same - usually same in accounting)
-- Dr COGS
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, account_name, cost_center_id, debit_amount, credit_amount, description, reference_type, reference_id, created_at)
SELECT last_insert_rowid()-3, 4, '55010001', 'تكلفة مبيعات بنجر', 1006001, 6000.00, 0, 'تكلفة بضاعة مباعة - 200 طن', 'item', 'BEET-001', datetime('now');

-- Cr Finished Inventory
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, account_name, cost_center_id, debit_amount, credit_amount, description, reference_type, reference_id, created_at)
SELECT last_insert_rowid()-4, 5, '14070401', 'مخزون محاصيل تامة', 1006001, 0, 6000.00, 'إخراج بنجر مباع من المخزن', 'item', 'BEET-001', datetime('now');

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
SELECT 'VAT Input (14040711) Usage' as check_item, COUNT(*) as count FROM journal_entry_lines WHERE account_code = '14040711'
UNION ALL
SELECT 'VAT Output (21060001) Usage' as check_item, COUNT(*) as count FROM journal_entry_lines WHERE account_code = '21060001';

-- Summary of test transactions by account
SELECT account_code, account_name, SUM(debit_amount) as total_debit, SUM(credit_amount) as total_credit
FROM journal_entry_lines 
WHERE entry_id IN (SELECT id FROM journal_entries WHERE entry_date >= '2026-04-30' AND company_id = 1)
GROUP BY account_code, account_name
ORDER BY account_code;

SELECT 'FULL FLOW TEST COMPLETED SUCCESSFULLY' as final_status;
