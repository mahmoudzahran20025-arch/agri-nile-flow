-- Migration 0054: GL Source Ledger Tracking Backfill (FIXED for D1 SQLite)
--
-- Purpose: Link existing journal_entry_lines to their operational sources
-- Strategy: Match by amount and date using subqueries (D1 SQLite compatible)

-- ═══════════════════════════════════════════════════════════════════
-- STEP 1: Link cash_transactions
-- ═══════════════════════════════════════════════════════════════════

-- Match by: amount and date (within same day)
UPDATE journal_entry_lines
SET source_ledger = 'cash', source_record_id = (
  SELECT ct.id FROM cash_transactions ct
  WHERE ct.company_id = 1
    AND (ABS(ct.amount) = ABS(journal_entry_lines.debit) OR ABS(ct.amount) = ABS(journal_entry_lines.credit))
    AND DATE(ct.transaction_date) = DATE((SELECT je.entry_date FROM journal_entries je WHERE je.id = journal_entry_lines.journal_entry_id))
  LIMIT 1
)
WHERE journal_entry_lines.source_ledger = 'manual'
  AND journal_entry_lines.account_code IN (
    SELECT account_code FROM chart_of_accounts
    WHERE account_type = 'Asset'
      AND (account_name LIKE '%نقد%' OR account_name LIKE '%cash%' OR account_name LIKE '%bank%')
    LIMIT 10
  )
  AND EXISTS (
    SELECT 1 FROM cash_transactions ct
    WHERE (ABS(ct.amount) = ABS(journal_entry_lines.debit) OR ABS(ct.amount) = ABS(journal_entry_lines.credit))
  );

-- ═══════════════════════════════════════════════════════════════════
-- STEP 2: Link supplier_transactions
-- ═══════════════════════════════════════════════════════════════════

UPDATE journal_entry_lines
SET source_ledger = 'supplier', source_record_id = (
  SELECT st.id FROM supplier_transactions st
  WHERE st.company_id = 1
    AND (ABS(st.amount) = ABS(journal_entry_lines.debit) OR ABS(st.amount) = ABS(journal_entry_lines.credit) OR ABS(st.debit + st.credit) = ABS(journal_entry_lines.debit) OR ABS(st.debit + st.credit) = ABS(journal_entry_lines.credit))
    AND DATE(st.transaction_date) = DATE((SELECT je.entry_date FROM journal_entries je WHERE je.id = journal_entry_lines.journal_entry_id))
  LIMIT 1
)
WHERE journal_entry_lines.source_ledger = 'manual'
  AND journal_entry_lines.account_code IN (
    SELECT DISTINCT account_code FROM posting_rules
    WHERE company_id = 1 AND rule_slot = 'accounts_payable'
    LIMIT 10
  )
  AND EXISTS (
    SELECT 1 FROM supplier_transactions st
    WHERE (ABS(st.amount) = ABS(journal_entry_lines.debit) OR ABS(st.amount) = ABS(journal_entry_lines.credit))
  );

-- ═══════════════════════════════════════════════════════════════════
-- STEP 3: Link inventory_movements
-- ═══════════════════════════════════════════════════════════════════

UPDATE journal_entry_lines
SET source_ledger = 'inventory', source_record_id = (
  SELECT im.id FROM inventory_movements im
  WHERE im.company_id = 1
    AND (ABS(im.value) = ABS(journal_entry_lines.debit) OR ABS(im.value) = ABS(journal_entry_lines.credit))
    AND DATE(im.movement_date) = DATE((SELECT je.entry_date FROM journal_entries je WHERE je.id = journal_entry_lines.journal_entry_id))
  LIMIT 1
)
WHERE journal_entry_lines.source_ledger = 'manual'
  AND journal_entry_lines.account_code IN (
    SELECT DISTINCT account_code FROM posting_rules
    WHERE company_id = 1 AND rule_slot IN ('inventory', 'cogs')
    LIMIT 10
  )
  AND EXISTS (
    SELECT 1 FROM inventory_movements im
    WHERE (ABS(im.value) = ABS(journal_entry_lines.debit) OR ABS(im.value) = ABS(journal_entry_lines.credit))
  );

-- ═══════════════════════════════════════════════════════════════════
-- STEP 4: All remaining entries are marked as 'manual' (already set by default)
-- ═══════════════════════════════════════════════════════════════════
-- No action needed — source_ledger defaults to 'manual' from schema

-- Expected distribution after backfill:
-- - cash: ~69 lines
-- - supplier: ~274 lines
-- - inventory: ~654 lines
-- - manual: ~851 lines (opening balances, adjustments, unmatched)
-- Total: 1,848 lines

-- To verify results, run after migration:
-- SELECT source_ledger, COUNT(*) as count, COUNT(DISTINCT source_record_id) as unique_sources
-- FROM journal_entry_lines
-- GROUP BY source_ledger
-- ORDER BY count DESC;
