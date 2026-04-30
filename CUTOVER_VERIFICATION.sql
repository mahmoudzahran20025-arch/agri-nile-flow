-- ============================================================================
-- CUTOVER VERIFICATION CHECKLIST
-- Step 1: Verify New Accounts + Period + Balance
-- ============================================================================

-- 1. VERIFY NEW ACCOUNTS EXIST AND ARE ACTIVE
SELECT 'CHECK 1: NEW ACCOUNTS EXISTENCE' as check_item;
SELECT code, name, account_type, is_active 
FROM chart_of_accounts 
WHERE company_id = 1 
AND code IN ('13500001', '14040711', '14070107', '14070401', '21060001', '55010001', '55010002', '55010003', '55010004', '55010005')
ORDER BY code;

-- 2. VERIFY CURRENT PERIOD IS OPEN
SELECT 'CHECK 2: CURRENT PERIOD STATUS' as check_item;
SELECT id, name, start_date, end_date, is_closed 
FROM financial_periods 
WHERE company_id = 1 
AND start_date <= date('now') 
AND end_date >= date('now');

-- 3. VERIFY APRIL 2026 ENTRIES BALANCE (Debit = Credit)
SELECT 'CHECK 3: APRIL ENTRIES BALANCE' as check_item;
SELECT 
  ROUND(SUM(debit), 2) as total_debit,
  ROUND(SUM(credit), 2) as total_credit,
  ROUND(SUM(debit) - SUM(credit), 2) as difference,
  CASE WHEN ABS(SUM(debit) - SUM(credit)) < 0.01 THEN 'BALANCED ✓' ELSE 'IMBALANCED ✗' END as status
FROM journal_entry_lines l
JOIN journal_entries e ON l.entry_id = e.id
WHERE e.period_id = 5 AND e.company_id = 1;

-- 4. COUNT ENTRIES IN APRIL PERIOD
SELECT 'CHECK 4: APRIL ENTRIES COUNT' as check_item;
SELECT 
  COUNT(*) as total_entries,
  SUM(CASE WHEN is_posted = 1 THEN 1 ELSE 0 END) as posted,
  SUM(CASE WHEN is_posted = 0 THEN 1 ELSE 0 END) as unposted
FROM journal_entries 
WHERE period_id = 5 AND company_id = 1;

-- 5. VERIFY NEW ACCOUNTS USED IN APRIL TEST ENTRIES
SELECT 'CHECK 5: NEW ACCOUNTS USAGE IN APRIL' as check_item;
SELECT 
  l.account_code,
  c.name as account_name,
  COUNT(*) as line_count,
  ROUND(SUM(l.debit), 2) as total_debit,
  ROUND(SUM(l.credit), 2) as total_credit
FROM journal_entry_lines l
JOIN journal_entries e ON l.entry_id = e.id
JOIN chart_of_accounts c ON l.account_code = c.code AND c.company_id = 1
WHERE e.period_id = 5 AND e.company_id = 1
AND l.account_code IN ('13500001', '14040711', '14070103', '14070401', '21060001', '55010001')
GROUP BY l.account_code, c.name
ORDER BY l.account_code;

SELECT 'VERIFICATION COMPLETED' as status;
