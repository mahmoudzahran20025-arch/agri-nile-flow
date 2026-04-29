-- Backfill GL Links for Cash and Supplier Transactions
-- This script re-posts transactions to GL that were posted before GL integration

-- ============================================
-- PART 1: Backfill Cash Transactions
-- ============================================

-- For each cash transaction without a GL link, create a journal entry
-- Using the posting rules we configured

-- Note: This is a simplified backfill. In production, you might want to:
-- 1. Use the actual posting engine logic
-- 2. Handle different transaction types (income vs expense)
-- 3. Use proper account codes from posting rules

-- First, let's check what we need to backfill
SELECT 
  'cash_transactions' as table_name,
  COUNT(*) as total_posted,
  SUM(CASE WHEN journal_entry_id IS NULL THEN 1 ELSE 0 END) as missing_gl
FROM cash_transactions 
WHERE company_id = 1 AND status = 'posted';

-- ============================================
-- PART 2: Backfill Supplier Transactions
-- ============================================

SELECT 
  'supplier_transactions' as table_name,
  COUNT(*) as total_posted,
  SUM(CASE WHEN journal_entry_id IS NULL THEN 1 ELSE 0 END) as missing_gl
FROM supplier_transactions 
WHERE company_id = 1 AND status = 'posted';

-- ============================================
-- PART 3: Create GL Entries for Missing Cash Transactions
-- ============================================

-- For each cash transaction, we need:
-- 1. Create journal entry header
-- 2. Create journal entry lines (debit/credit)
-- 3. Link the transaction to the journal entry

-- Example structure for a cash payment (expense):
-- Debit: Expense account (from posting rules)
-- Credit: Cash account (from posting rules)

-- Example structure for a cash receipt (income):
-- Debit: Cash account
-- Credit: Revenue account

-- ============================================
-- MANUAL BACKFILL STEPS (Recommended approach):
-- ============================================

/*

Since the transactions were imported before GL integration,
the safest approach is to:

1. Export the list of transactions without GL links:
   
   SELECT id, created_at, amount, debit, credit, description, 
          CASE WHEN debit > 0 THEN 'expense' ELSE 'income' END as tx_type
   FROM cash_transactions 
   WHERE company_id = 1 AND status = 'posted' AND journal_entry_id IS NULL;

2. For each transaction, create GL entry using the posting engine:
   - Use POST /api/gl/journal-entries endpoint
   - Or use the finance_core postToGL function
   - Pass proper account codes from posting_rules

3. Update the transaction with the new journal_entry_id:
   
   UPDATE cash_transactions 
   SET journal_entry_id = ? 
   WHERE id = ?;

4. Similar approach for supplier_transactions

*/

-- ============================================
-- QUICK FIX: Mark as needing re-post (Alternative)
-- ============================================

-- If you don't want to create GL entries immediately,
-- you can mark them for re-processing:

-- UPDATE cash_transactions 
-- SET status = 'draft' 
-- WHERE company_id = 1 
--   AND status = 'posted' 
--   AND journal_entry_id IS NULL;

-- Then use the application to re-post them through the normal flow
