-- Migration 0054: GL Source Ledger Tracking Backfill
--
-- Purpose: Link existing journal_entry_lines to their operational sources
-- This creates the audit trail for all existing GL entries
--
-- Strategy:
-- 1. Match GL entries to cash_transactions by amount, date, and account type
-- 2. Match GL entries to supplier_transactions by amount, date, and account type
-- 3. Match GL entries to inventory_movements by amount, date, and account type
-- 4. Mark remaining entries as 'manual'
--
-- Expected Results:
-- - ~69 lines linked to cash_transactions (source_ledger='cash')
-- - ~274 lines linked to supplier_transactions (source_ledger='supplier')
-- - ~654 lines linked to inventory_movements (source_ledger='inventory')
-- - ~851 lines marked as manual (source_ledger='manual')
-- - Total: ~1,848 lines (all journal_entry_lines)

-- ═══════════════════════════════════════════════════════════════════
-- STEP 1: Link cash_transactions
-- ═══════════════════════════════════════════════════════════════════

-- Match by: account type = Asset/Cash, amount, date proximity
UPDATE journal_entry_lines jel
SET source_ledger = 'cash', source_record_id = ct.id
FROM (
  SELECT ct.id, ct.transaction_date, ABS(ct.amount) as amt
  FROM cash_transactions ct
  WHERE ct.company_id = 1  -- Adjust company_id as needed
) ct
JOIN journal_entries je ON je.id = jel.journal_entry_id
WHERE jel.source_ledger = 'manual'  -- Only update unmarked entries
  AND je.company_id = 1
  AND (
    -- Match by amount and date
    (ABS(jel.debit) = ct.amt AND DATE(je.entry_date) = DATE(ct.transaction_date))
    OR
    (ABS(jel.credit) = ct.amt AND DATE(je.entry_date) = DATE(ct.transaction_date))
  )
  AND jel.account_code IN (
    -- Cash/Bank accounts (adjust codes based on actual COA)
    SELECT account_code FROM chart_of_accounts
    WHERE company_id = 1
      AND (account_type = 'Asset' OR account_name LIKE '%نقد%' OR account_name LIKE '%Cash%' OR account_name LIKE '%Bank%')
      LIMIT 10
  );

-- ═══════════════════════════════════════════════════════════════════
-- STEP 2: Link supplier_transactions
-- ═══════════════════════════════════════════════════════════════════

-- Match by: account type = Liability/A/P, amount, date proximity
UPDATE journal_entry_lines jel
SET source_ledger = 'supplier', source_record_id = st.id
FROM (
  SELECT st.id, st.transaction_date, ABS(COALESCE(st.amount, st.debit + st.credit)) as amt
  FROM supplier_transactions st
  WHERE st.company_id = 1
) st
JOIN journal_entries je ON je.id = jel.journal_entry_id
WHERE jel.source_ledger = 'manual'  -- Only update unmarked entries
  AND je.company_id = 1
  AND (
    -- Match by amount and date
    (ABS(jel.debit) = st.amt AND DATE(je.entry_date) = DATE(st.transaction_date))
    OR
    (ABS(jel.credit) = st.amt AND DATE(je.entry_date) = DATE(st.transaction_date))
  )
  AND jel.account_code IN (
    -- Accounts Payable accounts (adjust based on posting rules)
    SELECT account_code FROM posting_rules
    WHERE company_id = 1 AND rule_slot = 'accounts_payable'
    LIMIT 10
  );

-- ═══════════════════════════════════════════════════════════════════
-- STEP 3: Link inventory_movements
-- ═══════════════════════════════════════════════════════════════════

-- Match by: account type = Asset/Inventory, amount/value, date proximity
UPDATE journal_entry_lines jel
SET source_ledger = 'inventory', source_record_id = im.id
FROM (
  SELECT im.id, im.movement_date, ABS(COALESCE(im.value, im.qty * im.unit_price)) as amt
  FROM inventory_movements im
  WHERE im.company_id = 1
) im
JOIN journal_entries je ON je.id = jel.journal_entry_id
WHERE jel.source_ledger = 'manual'  -- Only update unmarked entries
  AND je.company_id = 1
  AND (
    -- Match by amount and date
    (ABS(jel.debit) = im.amt AND DATE(je.entry_date) = DATE(im.movement_date))
    OR
    (ABS(jel.credit) = im.amt AND DATE(je.entry_date) = DATE(im.movement_date))
  )
  AND jel.account_code IN (
    -- Inventory accounts (adjust based on posting rules)
    SELECT account_code FROM posting_rules
    WHERE company_id = 1 AND rule_slot IN ('inventory', 'cogs')
    LIMIT 10
  );

-- ═══════════════════════════════════════════════════════════════════
-- STEP 4: Verify and Report
-- ═══════════════════════════════════════════════════════════════════

-- After backfill, all entries should have source_ledger assigned
-- Manual entries (source_ledger='manual') are expected for:
-- - Opening balances
-- - Manual journal adjustments
-- - System-generated entries not traced to operational source

-- Expected distribution (from EXCEL_DATA_INVENTORY.md):
-- - cash: ~69 rows (from cash_transactions)
-- - supplier: ~274 rows (from supplier_transactions, ~2 lines per transaction)
-- - inventory: ~654 rows (from inventory_movements, 1-2 lines per movement)
-- - manual: ~851 rows (opening balances, adjustments)
-- Total: 1,848 lines

-- To verify, run after migration:
-- SELECT source_ledger, COUNT(*) as count FROM journal_entry_lines GROUP BY source_ledger;
