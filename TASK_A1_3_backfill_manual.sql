-- ============================================
-- TASK A1.3: MANUAL BACKFILL SQL
-- Backfill GL Links for Cash & Supplier Transactions
-- Execute commands one by one
-- ============================================

-- STEP 1: Check current status
-- Cash transactions
SELECT COUNT(*) as total, COUNT(CASE WHEN journal_entry_id IS NULL THEN 1 END) as missing FROM cash_transactions WHERE company_id=1 AND status='posted';

-- Supplier transactions  
SELECT COUNT(*) as total, COUNT(CASE WHEN journal_entry_id IS NULL THEN 1 END) as missing FROM supplier_transactions WHERE company_id=1 AND status='posted';

-- ============================================
-- STEP 2: Get sample cash transaction for testing
-- ============================================
SELECT id, created_at, amount, debit, credit, document_type FROM cash_transactions WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL LIMIT 1;

-- ============================================
-- STEP 3: Create Journal Entry for Cash Transaction
-- (Replace 419 with actual transaction ID from step 2)
-- ============================================
-- For Receipt (credit > 0): DR Cash 14010101, CR Revenue 41010001
-- For Payment (debit > 0): DR Expense 51200034, CR Cash 14010101

-- Create JE Header
INSERT INTO journal_entries (company_id, entry_date, description, ref_type, ref_id, is_posted, created_at) 
VALUES (1, '2026-04-27', 'Cash Receipt 1000000', 'cash', 419, 1, datetime('now'));

-- Get the JE ID (run this after insert)
SELECT last_insert_rowid() as je_id;

-- Create DR line (Cash for receipt, Expense for payment)
INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, source_ledger, source_record_id, created_at)
VALUES (JE_ID_HERE, 1, '14010101', 1000000, 0, 'Cash Receipt 1000000', 'cash', 419, datetime('now'));

-- Create CR line (Revenue for receipt, Cash for payment)
INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, source_ledger, source_record_id, created_at)
VALUES (JE_ID_HERE, 1, '41010001', 0, 1000000, 'Cash Receipt 1000000', 'cash', 419, datetime('now'));

-- Link transaction to JE
UPDATE cash_transactions SET journal_entry_id = JE_ID_HERE WHERE id = 419;

-- ============================================
-- STEP 4: Verify the link
-- ============================================
SELECT id, journal_entry_id FROM cash_transactions WHERE id = 419;

-- ============================================
-- STEP 5: Check JE was created
-- ============================================
SELECT * FROM journal_entries WHERE ref_type = 'cash' AND ref_id = 419;

-- ============================================
-- STEP 6: Check JE lines were created
-- ============================================
SELECT * FROM journal_entry_lines WHERE entry_id = JE_ID_HERE;

-- ============================================
-- STEP 7: Repeat for remaining transactions
-- ============================================
-- Get next transaction needing backfill
SELECT id, created_at, amount, debit, credit, document_type 
FROM cash_transactions 
WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL 
LIMIT 1;

-- ============================================
-- STEP 8: Verify final status
-- ============================================
SELECT 
  'Cash' as type, 
  COUNT(*) as total, 
  COUNT(CASE WHEN journal_entry_id IS NULL THEN 1 END) as missing,
  ROUND(100.0 * COUNT(CASE WHEN journal_entry_id IS NOT NULL THEN 1 END) / COUNT(*), 1) as pct_linked
FROM cash_transactions WHERE company_id=1 AND status='posted'
UNION ALL
SELECT 
  'Supplier' as type, 
  COUNT(*) as total, 
  COUNT(CASE WHEN journal_entry_id IS NULL THEN 1 END) as missing,
  ROUND(100.0 * COUNT(CASE WHEN journal_entry_id IS NOT NULL THEN 1 END) / COUNT(*), 1) as pct_linked
FROM supplier_transactions WHERE company_id=1 AND status='posted';
