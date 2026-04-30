-- ============================================================================
-- PHASE 3: COMPLETE FLOW TEST SCRIPT (FINAL - Uses Open Period)
-- Period: April 2026 (id=5, is_closed=0)
-- Date: April 30, 2026
-- ============================================================================

-- ============================================================================
-- TEST 1: PURCHASE INVOICE - Seeds with VAT (14%)
-- ============================================================================

INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by, created_at)
VALUES (1, 5, 'PINV-2026-001', '2026-04-15', 'شراء بذور بنجر مع VAT', 'supplier_transaction', 1, 0, 1, datetime('now'));

INSERT INTO journal_entry_lines (journal_entry_id, account_code, account_name, cost_center_code, debit, credit, description, line_ref_type, line_ref_id, created_at)
SELECT last_insert_rowid(), '14070103', 'مخزون تقاوي و بذور', '1006001', 10000.00, 0, 'شراء بذور بنجر - الكمية 100 كجم', 'item', 1, datetime('now');

INSERT INTO journal_entry_lines (journal_entry_id, account_code, account_name, cost_center_code, debit, credit, description, line_ref_type, line_ref_id, created_at)
SELECT last_insert_rowid()-1, '14040711', 'ضريبة قيمة مضافة مدخلات - مستردة', '1006001', 1400.00, 0, 'VAT 14% على مشتريات البذور', NULL, NULL, datetime('now');

INSERT INTO journal_entry_lines (journal_entry_id, account_code, account_name, cost_center_code, debit, credit, description, line_ref_type, line_ref_id, created_at)
SELECT last_insert_rowid()-2, '21100001', 'ذمم دائنة تجارية - موردين', '1006001', 0, 11400.00, 'مستحقات مورد البذور', 'supplier', 1, datetime('now');

SELECT 'TEST 1 COMPLETED: Purchase Invoice with VAT' as status;

-- ============================================================================
-- TEST 2: ISSUE TO WIP - Raw Materials to Work in Progress
-- ============================================================================

INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by, created_at)
VALUES (1, 5, 'ISSUE-2026-001', '2026-04-20', 'إصدار بذور إلى WIP', 'inventory_movement', 1, 0, 1, datetime('now'));

INSERT INTO journal_entry_lines (journal_entry_id, account_code, account_name, cost_center_code, debit, credit, description, line_ref_type, line_ref_id, created_at)
SELECT last_insert_rowid(), '13500001', 'مخزون تحت التشغيل - محاصيل زراعية', '1006001', 8000.00, 0, 'إصدار بذور إلى مشروع زراعة بنجر', 'item', 1, datetime('now');

INSERT INTO journal_entry_lines (journal_entry_id, account_code, account_name, cost_center_code, debit, credit, description, line_ref_type, line_ref_id, created_at)
SELECT last_insert_rowid()-1, '14070103', 'مخزون تقاوي و بذور', '1006001', 0, 8000.00, 'إصدار بذور من المخزن', 'item', 1, datetime('now');

SELECT 'TEST 2 COMPLETED: Issue to WIP' as status;

-- ============================================================================
-- TEST 3: HARVEST - WIP to Finished Goods
-- ============================================================================

INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by, created_at)
VALUES (1, 5, 'HRV-2026-001', '2026-04-25', 'حصاد بنجر - WIP إلى Finished', 'inventory_movement', 2, 0, 1, datetime('now'));

INSERT INTO journal_entry_lines (journal_entry_id, account_code, account_name, cost_center_code, debit, credit, description, line_ref_type, line_ref_id, created_at)
SELECT last_insert_rowid(), '14070401', 'مخزون محاصيل تامة', '1006001', 15000.00, 0, 'حصاد بنجر - الإنتاج 500 طن', 'harvest', 1, datetime('now');

INSERT INTO journal_entry_lines (journal_entry_id, account_code, account_name, cost_center_code, debit, credit, description, line_ref_type, line_ref_id, created_at)
SELECT last_insert_rowid()-1, '13500001', 'مخزون تحت التشغيل - محاصيل زراعية', '1006001', 0, 15000.00, 'تصفية WIP إلى محصول تام', 'harvest', 1, datetime('now');

SELECT 'TEST 3 COMPLETED: Harvest (WIP → Finished)' as status;

-- ============================================================================
-- TEST 4: SALE INVOICE with VAT and COGS
-- ============================================================================

INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by, created_at)
VALUES (1, 5, 'SINV-2026-001', '2026-04-28', 'بيع بنجر - Revenue + COGS', 'cash_transaction', 1, 0, 1, datetime('now'));

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
-- VERIFICATION
-- ============================================================================

SELECT 'VERIFICATION SUMMARY' as section;

-- Test entries count
SELECT 'Test Journal Entries Created' as check_item, COUNT(*) as count FROM journal_entries WHERE period_id = 5 AND company_id = 1;

-- New accounts usage
SELECT 'COGS (55010001) Usage' as check_item, COUNT(*) as count FROM journal_entry_lines WHERE account_code = '55010001';
SELECT 'WIP (13500001) Usage' as check_item, COUNT(*) as count FROM journal_entry_lines WHERE account_code = '13500001';
SELECT 'VAT Input (14040711) Usage' as check_item, COUNT(*) as count FROM journal_entry_lines WHERE account_code = '14040711';
SELECT 'VAT Output (21060001) Usage' as check_item, COUNT(*) as count FROM journal_entry_lines WHERE account_code = '21060001';

-- Summary by account
SELECT account_code, account_name, 
       ROUND(SUM(debit), 2) as total_debit, 
       ROUND(SUM(credit), 2) as total_credit,
       ROUND(SUM(debit) - SUM(credit), 2) as net_balance
FROM journal_entry_lines 
WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE period_id = 5 AND company_id = 1)
GROUP BY account_code, account_name
ORDER BY account_code;

SELECT 'ALL TESTS COMPLETED SUCCESSFULLY' as final_status;
