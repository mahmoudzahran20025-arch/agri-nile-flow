-- FINANCIAL CONSISTENCY VALIDATION
-- Run against D1 database to audit inventory↔GL, suppliers↔GL, cash↔GL

-- ============================================================================
-- STEP 1: INVENTORY ↔ GL VALIDATION
-- ============================================================================

-- Total inventory value from operational table
SELECT
  'inventory_movements' AS source,
  COUNT(*) AS row_count,
  SUM(balance_value) AS total_balance_value,
  MIN(movement_date) AS earliest_date,
  MAX(movement_date) AS latest_date
FROM inventory_movements;

-- GL inventory account balance
SELECT
  'journal_entry_lines (GL)' AS source,
  COUNT(*) AS line_count,
  SUM(CASE WHEN debit_amount > 0 THEN debit_amount ELSE 0 END) AS total_debits,
  SUM(CASE WHEN credit_amount > 0 THEN credit_amount ELSE 0 END) AS total_credits,
  SUM(debit_amount - credit_amount) AS net_balance
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.journal_entry_id
WHERE jel.account_code IN (
  SELECT account_code FROM gl_mappings WHERE mapping_key = 'inventory'
);

-- ============================================================================
-- STEP 2: SUPPLIERS ↔ GL VALIDATION
-- ============================================================================

-- Total supplier balance from operational table
SELECT
  'supplier_transactions' AS source,
  COUNT(*) AS row_count,
  COUNT(DISTINCT supplier_code) AS unique_suppliers,
  SUM(balance_with_checks) AS total_balance_with_checks,
  SUM(balance_no_checks) AS total_balance_no_checks,
  SUM(debit) AS total_debits,
  SUM(credit) AS total_credits
FROM supplier_transactions;

-- GL accounts payable balance
SELECT
  'journal_entry_lines (GL)' AS source,
  COUNT(*) AS line_count,
  COUNT(DISTINCT account_code) AS unique_accounts,
  SUM(CASE WHEN debit_amount > 0 THEN debit_amount ELSE 0 END) AS total_debits,
  SUM(CASE WHEN credit_amount > 0 THEN credit_amount ELSE 0 END) AS total_credits,
  SUM(debit_amount - credit_amount) AS net_balance
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.journal_entry_id
WHERE jel.account_code IN (
  SELECT account_code FROM gl_mappings WHERE mapping_key = 'accounts_payable'
);

-- Top 10 suppliers by balance (operational table)
SELECT
  supplier_code,
  COUNT(*) AS txn_count,
  MAX(transaction_date) AS latest_txn,
  SUM(balance_with_checks) AS final_balance
FROM supplier_transactions
GROUP BY supplier_code
ORDER BY final_balance DESC
LIMIT 10;

-- ============================================================================
-- STEP 3: CASH ↔ GL VALIDATION
-- ============================================================================

-- Final running balance from operational table
SELECT
  'cash_transactions' AS source,
  COUNT(*) AS row_count,
  MAX(running_balance) AS final_running_balance,
  MAX(transaction_date) AS latest_date,
  SUM(CASE WHEN direction = 'م' THEN amount ELSE -amount END) AS total_net_movement
FROM cash_transactions;

-- GL cash/bank account balance
SELECT
  'journal_entry_lines (GL)' AS source,
  COUNT(*) AS line_count,
  SUM(CASE WHEN debit_amount > 0 THEN debit_amount ELSE 0 END) AS total_debits,
  SUM(CASE WHEN credit_amount > 0 THEN credit_amount ELSE 0 END) AS total_credits,
  SUM(debit_amount - credit_amount) AS net_balance
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.journal_entry_id
WHERE jel.account_code IN (
  SELECT account_code FROM gl_mappings WHERE mapping_key IN ('cash', 'bank')
);

-- ============================================================================
-- STEP 4: TRACE COMPLETENESS CHECK
-- ============================================================================

-- Inventory movements with business events
SELECT
  'Inventory → business_events' AS trace_segment,
  COUNT(DISTINCT im.id) AS total_movements,
  COUNT(DISTINCT be.id) AS linked_events,
  COUNT(DISTINCT im.id) - COUNT(DISTINCT be.id) AS orphan_count,
  ROUND(100.0 * COUNT(DISTINCT be.id) / NULLIF(COUNT(DISTINCT im.id), 0), 2) AS coverage_pct
FROM inventory_movements im
LEFT JOIN business_events be ON be.source_id = im.id AND be.source_module = 'inventory'
WHERE im.company_id IS NOT NULL;

-- business_events → journal_entries (inventory)
SELECT
  'business_events → journal_entries (inventory)' AS trace_segment,
  COUNT(DISTINCT be.id) AS total_events,
  COUNT(DISTINCT je.id) AS linked_entries,
  COUNT(DISTINCT be.id) - COUNT(DISTINCT je.id) AS orphan_count,
  ROUND(100.0 * COUNT(DISTINCT je.id) / NULLIF(COUNT(DISTINCT be.id), 0), 2) AS coverage_pct
FROM business_events be
LEFT JOIN journal_entries je ON je.business_event_id = be.id
WHERE be.source_module = 'inventory';

-- Supplier transactions with business events
SELECT
  'supplier_transactions → business_events' AS trace_segment,
  COUNT(DISTINCT st.id) AS total_transactions,
  COUNT(DISTINCT be.id) AS linked_events,
  COUNT(DISTINCT st.id) - COUNT(DISTINCT be.id) AS orphan_count,
  ROUND(100.0 * COUNT(DISTINCT be.id) / NULLIF(COUNT(DISTINCT st.id), 0), 2) AS coverage_pct
FROM supplier_transactions st
LEFT JOIN business_events be ON be.source_id = st.id AND be.source_module IN ('supplier_invoice', 'supplier_payment')
WHERE st.company_id IS NOT NULL;

-- business_events → journal_entries (suppliers)
SELECT
  'business_events → journal_entries (supplier)' AS trace_segment,
  COUNT(DISTINCT be.id) AS total_events,
  COUNT(DISTINCT je.id) AS linked_entries,
  COUNT(DISTINCT be.id) - COUNT(DISTINCT je.id) AS orphan_count,
  ROUND(100.0 * COUNT(DISTINCT je.id) / NULLIF(COUNT(DISTINCT be.id), 0), 2) AS coverage_pct
FROM business_events be
LEFT JOIN journal_entries je ON je.business_event_id = be.id
WHERE be.source_module IN ('supplier_invoice', 'supplier_payment');

-- Cash transactions with business events
SELECT
  'cash_transactions → business_events' AS trace_segment,
  COUNT(DISTINCT ct.id) AS total_transactions,
  COUNT(DISTINCT be.id) AS linked_events,
  COUNT(DISTINCT ct.id) - COUNT(DISTINCT be.id) AS orphan_count,
  ROUND(100.0 * COUNT(DISTINCT be.id) / NULLIF(COUNT(DISTINCT ct.id), 0), 2) AS coverage_pct
FROM cash_transactions ct
LEFT JOIN business_events be ON be.source_id = ct.id AND be.source_module = 'cash'
WHERE ct.company_id IS NOT NULL;

-- business_events → journal_entries (cash)
SELECT
  'business_events → journal_entries (cash)' AS trace_segment,
  COUNT(DISTINCT be.id) AS total_events,
  COUNT(DISTINCT je.id) AS linked_entries,
  COUNT(DISTINCT be.id) - COUNT(DISTINCT je.id) AS orphan_count,
  ROUND(100.0 * COUNT(DISTINCT je.id) / NULLIF(COUNT(DISTINCT be.id), 0), 2) AS coverage_pct
FROM business_events be
LEFT JOIN journal_entries je ON je.business_event_id = be.id
WHERE be.source_module = 'cash';

-- ============================================================================
-- STEP 5: DATA QUALITY CHECKS
-- ============================================================================

-- Items missing posting groups
SELECT
  'Items missing prod_posting_group_code' AS issue,
  COUNT(*) AS count
FROM items
WHERE prod_posting_group_code IS NULL
UNION ALL
SELECT
  'Items missing inv_posting_group_code',
  COUNT(*)
FROM items
WHERE inv_posting_group_code IS NULL;

-- Orphan journal lines
SELECT
  'journal_entry_lines without business_event' AS issue,
  COUNT(*) AS count
FROM journal_entry_lines jel
LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
LEFT JOIN business_events be ON be.id = je.business_event_id
WHERE be.id IS NULL AND je.source_module NOT IN ('manual', 'adjustment');
