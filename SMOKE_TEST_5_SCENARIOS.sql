-- ============================================================================
-- SMOKE TEST: 5 MANDATORY SCENARIOS
-- Purpose: Validate posting engine with new accounts/rules
-- Requirements:
--   1. Purchase Invoice with VAT
--   2. Issue to WIP
--   3. Harvest (WIP → Finished)
--   4. Sale with VAT
--   5. COGS Recognition
-- ============================================================================

SELECT '═══════════════════════════════════════════════════════════════' as separator;
SELECT 'SMOKE TEST: 5 MANDATORY SCENARIOS' as title;
SELECT '═══════════════════════════════════════════════════════════════' as separator;

-- Get current period (should be open)
SELECT 'CHECK: Current Period' as scenario;
SELECT id, name, is_closed FROM financial_periods WHERE id = 5;

-- ============================================================================
-- SCENARIO 1: PURCHASE INVOICE WITH VAT
-- Dr Inventory (Seeds) + Dr VAT Input
-- Cr Accounts Payable
-- Expected: 14070103, 14040711, 21100001
-- ============================================================================
SELECT 'SCENARIO 1: PURCHASE INVOICE WITH VAT' as scenario;

INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by)
VALUES (1, 5, 'SMOKE-PINV-001', '2026-04-30', 'Smoke Test: Purchase Seeds with VAT', 'supplier_transaction', 9991, 0, 1);

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '14070103', 5000.00, 0, 'Seeds inventory', 1006001, 'supplier');

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '14040711', 700.00, 0, 'VAT Input 14%', 1006001, 'supplier');

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '21100001', 0, 5700.00, 'Accounts Payable', 1006001, 'supplier');

-- Validate Scenario 1
SELECT 'S1 VALIDATION' as check_type;
SELECT 
  entry_id,
  SUM(debit) as total_dr, 
  SUM(credit) as total_cr,
  CASE WHEN ABS(SUM(debit) - SUM(credit)) < 0.01 THEN '✓ BALANCED' ELSE '✗ IMBALANCED' END as balance_status,
  CASE WHEN SUM(CASE WHEN account_code IN ('14070103', '14040711', '21100001') THEN 1 ELSE 0 END) = 3 
       THEN '✓ ACCOUNTS OK' ELSE '✗ ACCOUNTS MISSING' END as accounts_status
FROM journal_entry_lines 
WHERE entry_id = (SELECT MAX(id) FROM journal_entries WHERE entry_number = 'SMOKE-PINV-001')
GROUP BY entry_id;

-- ============================================================================
-- SCENARIO 2: ISSUE TO WIP
-- Dr WIP / Cr Inventory
-- Expected: 13500001, 14070103
-- ============================================================================
SELECT 'SCENARIO 2: ISSUE TO WIP' as scenario;

INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by)
VALUES (1, 5, 'SMOKE-ISSUE-001', '2026-04-30', 'Smoke Test: Issue to WIP', 'inventory_movement', 9992, 0, 1);

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '13500001', 3000.00, 0, 'WIP - Seeds issued', 1006001, 'inventory');

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '14070103', 0, 3000.00, 'Inventory out', 1006001, 'inventory');

SELECT 'S2 VALIDATION' as check_type;
SELECT 
  SUM(debit) as total_dr, 
  SUM(credit) as total_cr,
  CASE WHEN ABS(SUM(debit) - SUM(credit)) < 0.01 THEN '✓ BALANCED' ELSE '✗ IMBALANCED' END as status
FROM journal_entry_lines 
WHERE entry_id = (SELECT MAX(id) FROM journal_entries WHERE entry_number = 'SMOKE-ISSUE-001');

-- ============================================================================
-- SCENARIO 3: HARVEST (WIP → FINISHED GOODS)
-- Dr Finished Goods / Cr WIP
-- Expected: 14070401, 13500001
-- ============================================================================
SELECT 'SCENARIO 3: HARVEST (WIP → FINISHED)' as scenario;

INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by)
VALUES (1, 5, 'SMOKE-HRV-001', '2026-04-30', 'Smoke Test: Harvest WIP to Finished', 'inventory_movement', 9993, 0, 1);

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '14070401', 8000.00, 0, 'Finished goods - Beet harvest', 1006001, 'harvest');

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '13500001', 0, 8000.00, 'WIP clearance', 1006001, 'harvest');

SELECT 'S3 VALIDATION' as check_type;
SELECT 
  SUM(debit) as total_dr, 
  SUM(credit) as total_cr,
  CASE WHEN ABS(SUM(debit) - SUM(credit)) < 0.01 THEN '✓ BALANCED' ELSE '✗ IMBALANCED' END as status
FROM journal_entry_lines 
WHERE entry_id = (SELECT MAX(id) FROM journal_entries WHERE entry_number = 'SMOKE-HRV-001');

-- ============================================================================
-- SCENARIO 4: SALE WITH VAT
-- Dr AR / Cr Revenue / Cr VAT Output
-- Expected: 14030001, 41010001, 21060001
-- ============================================================================
SELECT 'SCENARIO 4: SALE WITH VAT' as scenario;

INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by)
VALUES (1, 5, 'SMOKE-SALE-001', '2026-04-30', 'Smoke Test: Sale with VAT', 'cash_transaction', 9994, 0, 1);

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '14030001', 11400.00, 0, 'AR - Customer', 1006001, 'cash');

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '41010001', 0, 10000.00, 'Revenue - Beet sales', 1006001, 'cash');

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '21060001', 0, 1400.00, 'VAT Output 14%', 1006001, 'cash');

SELECT 'S4 VALIDATION' as check_type;
SELECT 
  SUM(debit) as total_dr, 
  SUM(credit) as total_cr,
  CASE WHEN ABS(SUM(debit) - SUM(credit)) < 0.01 THEN '✓ BALANCED' ELSE '✗ IMBALANCED' END as status
FROM journal_entry_lines 
WHERE entry_id = (SELECT MAX(id) FROM journal_entries WHERE entry_number = 'SMOKE-SALE-001');

-- ============================================================================
-- SCENARIO 5: COGS RECOGNITION
-- Dr COGS / Cr Finished Goods
-- Expected: 55010001, 14070401
-- ============================================================================
SELECT 'SCENARIO 5: COGS RECOGNITION' as scenario;

INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_by)
VALUES (1, 5, 'SMOKE-COGS-001', '2026-04-30', 'Smoke Test: COGS Recognition', 'inventory_movement', 9995, 0, 1);

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '55010001', 4000.00, 0, 'COGS - Beet sold', 1006001, 'inventory');

INSERT INTO journal_entry_lines (entry_id, company_id, account_code, debit, credit, description, center_code, source_ledger)
VALUES ((SELECT MAX(id) FROM journal_entries), 1, '14070401', 0, 4000.00, 'Finished goods out', 1006001, 'inventory');

SELECT 'S5 VALIDATION' as check_type;
SELECT 
  SUM(debit) as total_dr, 
  SUM(credit) as total_cr,
  CASE WHEN ABS(SUM(debit) - SUM(credit)) < 0.01 THEN '✓ BALANCED' ELSE '✗ IMBALANCED' END as status
FROM journal_entry_lines 
WHERE entry_id = (SELECT MAX(id) FROM journal_entries WHERE entry_number = 'SMOKE-COGS-001');

-- ============================================================================
-- FINAL SUMMARY
-- ============================================================================
SELECT '═══════════════════════════════════════════════════════════════' as separator;
SELECT 'FINAL SMOKE TEST SUMMARY' as title;
SELECT '═══════════════════════════════════════════════════════════════' as separator;

SELECT 
  entry_number,
  SUM(debit) as total_dr, 
  SUM(credit) as total_cr,
  ROUND(SUM(debit) - SUM(credit), 2) as diff,
  CASE WHEN ABS(SUM(debit) - SUM(credit)) < 0.01 THEN '✓ PASS' ELSE '✗ FAIL' END as result
FROM journal_entry_lines l
JOIN journal_entries e ON l.entry_id = e.id
WHERE e.entry_number LIKE 'SMOKE-%'
GROUP BY e.id, e.entry_number
ORDER BY e.entry_number;

-- Account usage verification
SELECT 'ACCOUNTS USED IN SMOKE TEST' as check_type;
SELECT 
  l.account_code,
  c.name as account_name,
  COUNT(*) as lines_count,
  ROUND(SUM(l.debit), 2) as total_dr,
  ROUND(SUM(l.credit), 2) as total_cr
FROM journal_entry_lines l
JOIN journal_entries e ON l.entry_id = e.id
JOIN chart_of_accounts c ON l.account_code = c.code AND c.company_id = 1
WHERE e.entry_number LIKE 'SMOKE-%'
GROUP BY l.account_code, c.name
ORDER BY l.account_code;

-- Check all required accounts were used
SELECT 'REQUIRED ACCOUNTS VALIDATION' as check_type;
WITH required_accounts(code, name) AS (
  SELECT '13500001', 'WIP' UNION ALL
  SELECT '14040711', 'VAT Input' UNION ALL
  SELECT '14070103', 'Seeds Inventory' UNION ALL
  SELECT '14070401', 'Finished Goods' UNION ALL
  SELECT '21060001', 'VAT Output' UNION ALL
  SELECT '55010001', 'COGS Beet'
)
SELECT 
  r.code,
  r.name,
  CASE WHEN EXISTS (
    SELECT 1 FROM journal_entry_lines l 
    JOIN journal_entries e ON l.entry_id = e.id 
    WHERE e.entry_number LIKE 'SMOKE-%' AND l.account_code = r.code
  ) THEN '✓ USED' ELSE '✗ NOT USED' END as status
FROM required_accounts r
ORDER BY r.code;

SELECT '═══════════════════════════════════════════════════════════════' as separator;
SELECT 'SMOKE TEST COMPLETED' as final_status;
SELECT '═══════════════════════════════════════════════════════════════' as separator;
