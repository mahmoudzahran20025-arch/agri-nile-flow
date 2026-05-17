-- ============================================================================
-- TEST DATA & QUERIES FOR COMPREHENSIVE FINANCIAL OPERATIONS TESTING
-- ============================================================================
-- File: Test_Data_and_Verification_Queries.sql
-- Purpose: Ready-to-use test data and verification queries
-- Date: 2026-05-10
--
-- INSTRUCTION: Run each section in order
-- Section 1: Setup (verify environment)
-- Section 2: Create test records
-- Section 3: Verify operations
-- Section 4: Check GL mapping
-- Section 5: Final reconciliation
-- ============================================================================

-- ============================================================================
-- SECTION 1: ENVIRONMENT VERIFICATION
-- ============================================================================

-- 1.1: Verify suppliers exist
SELECT 'SUPPLIER VERIFICATION' as check_name;
SELECT 
    supplier_code,
    company_id,
    COUNT(*) as transaction_count,
    MAX(updated_at) as last_updated
FROM supplier_transactions
WHERE DATE(updated_at) >= '2026-05-01'
GROUP BY supplier_code
LIMIT 10;

-- 1.2: Verify GL accounts exist
SELECT 'GL ACCOUNT VERIFICATION' as check_name;
SELECT 
    account_code,
    account_name,
    account_type,
    COUNT(*) as line_count
FROM journal_entry_lines jel
LEFT JOIN chart_of_accounts coa ON jel.account_code = coa.code
WHERE DATE(jel.generated_at) >= '2026-05-01'
GROUP BY account_code
LIMIT 10;

-- 1.3: Verify centers exist
SELECT 'CENTER VERIFICATION' as check_name;
SELECT 
    center_code,
    COUNT(*) as movement_count
FROM inventory_movements
WHERE center_code IS NOT NULL
GROUP BY center_code
LIMIT 10;

-- ============================================================================
-- SECTION 2: CREATE TEST DATA (One operation at a time)
-- ============================================================================

-- ============================================================================
-- TEST 1: Cash Payment for Supplies (Simple Case)
-- ============================================================================

-- 2.1.1: Insert test cash transaction
-- ⚠️ REMEMBER: Use real supplier_code from your database
-- Get supplier first:
SELECT 
    supplier_code,
    company_id,
    COUNT(*) as count
FROM supplier_transactions
WHERE company_id = 1
GROUP BY supplier_code
LIMIT 1;

-- Then use the supplier_code in the insert below:
INSERT INTO cash_transactions (
    company_id,
    supplier_code,
    expense_code,
    transaction_type,
    description,
    amount,
    created_at,
    status,
    device_id
) VALUES (
    1,                          -- company_id
    1001,                       -- supplier_code (REPLACE with actual)
    'SUPPLIES',                 -- expense_code
    'PAYMENT',                  -- transaction_type
    'TEST: Payment for supplies - Test Run 2026-05-10',
    50000,                      -- amount
    datetime('now'),
    'draft',                    -- initial status
    'test-device-001'
);

-- 2.1.2: Verify insert
SELECT 
    id,
    supplier_code,
    amount,
    status,
    created_at
FROM cash_transactions
WHERE description LIKE '%TEST: Payment for supplies%'
ORDER BY created_at DESC
LIMIT 1;

-- 2.1.3: Simulate posting this transaction
-- (This is what Backend does when user clicks "Post")
-- UPDATE cash_transactions
-- SET status = 'posted', journal_entry_id = <generated_je_id>
-- WHERE id = <transaction_id>;

-- ============================================================================
-- TEST 2: Inventory Movement - GRN (Purchase from Supplier)
-- ============================================================================

-- 2.2.1: Get available items and suppliers
SELECT 
    item_code,
    COUNT(*) as count
FROM inventory_movements
WHERE company_id = 1 AND qty_in > 0
GROUP BY item_code
LIMIT 5;

-- 2.2.2: Insert test GRN
INSERT INTO inventory_movements (
    company_id,
    supplier_code,
    item_code,
    movement_type,
    movement_date,
    warehouse,
    quantity,
    qty_in,
    qty_out,
    unit_price,
    value_in,
    value_out,
    notes,
    device_id,
    created_at,
    local_id,
    status,
    gl_posting_status
) VALUES (
    1,                              -- company_id
    1001,                           -- supplier_code (REPLACE)
    1010189,                        -- item_code
    'GRN',                          -- movement_type
    '2026-05-10',                   -- movement_date
    'WAREHOUSE-001',                -- warehouse
    100,                            -- quantity
    100,                            -- qty_in
    0,                              -- qty_out
    150.00,                         -- unit_price
    15000,                          -- value_in (qty * price)
    0,                              -- value_out
    'TEST: Purchase from Supplier - Test Run 2026-05-10',
    'test-device-001',
    datetime('now'),
    'test_grn_001',
    'posted',
    'posted'
);

-- 2.2.3: Verify GRN insert
SELECT 
    id,
    item_code,
    qty_in,
    value_in,
    status,
    notes
FROM inventory_movements
WHERE notes LIKE '%TEST: Purchase from Supplier%'
ORDER BY created_at DESC
LIMIT 1;

-- ============================================================================
-- TEST 3: Inventory Movement - ISSUE (Take from Store)
-- ============================================================================

-- 2.3.1: Get available centers
SELECT 
    center_code,
    COUNT(*) as count
FROM inventory_movements
WHERE company_id = 1 AND center_code IS NOT NULL
GROUP BY center_code
LIMIT 5;

-- 2.3.2: Insert test ISSUE
INSERT INTO inventory_movements (
    company_id,
    center_code,
    item_code,
    movement_type,
    movement_date,
    warehouse,
    quantity,
    qty_in,
    qty_out,
    unit_price,
    value_in,
    value_out,
    notes,
    device_id,
    created_at,
    local_id,
    status,
    gl_posting_status
) VALUES (
    1,                              -- company_id
    1001,                           -- center_code (REPLACE)
    1010189,                        -- item_code
    'ISSUE',                        -- movement_type
    '2026-05-10',                   -- movement_date
    'WAREHOUSE-001',                -- warehouse
    50,                             -- quantity
    0,                              -- qty_in
    50,                             -- qty_out
    150.00,                         -- unit_price
    0,                              -- value_in
    7500,                           -- value_out (qty * price)
    'TEST: Issue to Operations - Test Run 2026-05-10',
    'test-device-001',
    datetime('now'),
    'test_issue_001',
    'posted',
    'posted'
);

-- 2.3.3: Verify ISSUE insert
SELECT 
    id,
    item_code,
    qty_out,
    value_out,
    center_code,
    status
FROM inventory_movements
WHERE notes LIKE '%TEST: Issue to Operations%'
ORDER BY created_at DESC
LIMIT 1;

-- ============================================================================
-- SECTION 3: VERIFY JOURNAL ENTRIES CREATED
-- ============================================================================

-- 3.1: Check if JE was created for Cash transaction
SELECT 
    'Cash Transaction JE' as test_name,
    je.id,
    je.entry_date,
    je.description,
    COUNT(jel.id) as line_count,
    SUM(jel.debit) as total_debit,
    SUM(jel.credit) as total_credit,
    (SUM(jel.debit) - SUM(jel.credit)) as balance
FROM journal_entries je
LEFT JOIN journal_entry_lines jel ON je.id = jel.entry_id
WHERE je.description LIKE '%TEST: Payment for supplies%'
GROUP BY je.id;

-- 3.2: Check if JE was created for GRN
SELECT 
    'GRN Movement JE' as test_name,
    je.id,
    je.entry_date,
    je.description,
    COUNT(jel.id) as line_count,
    SUM(jel.debit) as total_debit,
    SUM(jel.credit) as total_credit,
    (SUM(jel.debit) - SUM(jel.credit)) as balance
FROM journal_entries je
LEFT JOIN journal_entry_lines jel ON je.id = jel.entry_id
WHERE je.description LIKE '%TEST: Purchase from Supplier%'
GROUP BY je.id;

-- 3.3: Check if JE was created for ISSUE
SELECT 
    'ISSUE Movement JE' as test_name,
    je.id,
    je.entry_date,
    je.description,
    COUNT(jel.id) as line_count,
    SUM(jel.debit) as total_debit,
    SUM(jel.credit) as total_credit,
    (SUM(jel.debit) - SUM(jel.credit)) as balance
FROM journal_entries je
LEFT JOIN journal_entry_lines jel ON je.id = jel.entry_id
WHERE je.description LIKE '%TEST: Issue to Operations%'
GROUP BY je.id;

-- ============================================================================
-- SECTION 4: VERIFY GL MAPPING (Are accounts correct?)
-- ============================================================================

-- 4.1: Detail lines for Cash JE
SELECT 
    'Cash JE Detail Lines' as section,
    jel.id,
    jel.account_code,
    jel.debit,
    jel.credit,
    jel.description,
    jel.center_code
FROM journal_entry_lines jel
WHERE jel.entry_id IN (
    SELECT je.id FROM journal_entries je 
    WHERE je.description LIKE '%TEST: Payment for supplies%'
)
ORDER BY jel.id;

-- 4.2: Detail lines for GRN JE
SELECT 
    'GRN JE Detail Lines' as section,
    jel.id,
    jel.account_code,
    jel.debit,
    jel.credit,
    jel.description,
    jel.center_code
FROM journal_entry_lines jel
WHERE jel.entry_id IN (
    SELECT je.id FROM journal_entries je 
    WHERE je.description LIKE '%TEST: Purchase from Supplier%'
)
ORDER BY jel.id;

-- 4.3: Detail lines for ISSUE JE
SELECT 
    'ISSUE JE Detail Lines' as section,
    jel.id,
    jel.account_code,
    jel.debit,
    jel.credit,
    jel.description,
    jel.center_code
FROM journal_entry_lines jel
WHERE jel.entry_id IN (
    SELECT je.id FROM journal_entries je 
    WHERE je.description LIKE '%TEST: Issue to Operations%'
)
ORDER BY jel.id;

-- ============================================================================
-- SECTION 5: FINAL RECONCILIATION & BALANCE CHECK
-- ============================================================================

-- 5.1: Check total balance across all test JEs
SELECT 
    'ALL TEST ENTRIES BALANCE' as check_name,
    COUNT(DISTINCT je.id) as total_je_count,
    SUM(jel.debit) as total_debit,
    SUM(jel.credit) as total_credit,
    SUM(jel.debit) - SUM(jel.credit) as balance_check
FROM journal_entries je
LEFT JOIN journal_entry_lines jel ON je.id = jel.entry_id
WHERE je.description LIKE '%TEST:%';

-- 5.2: Verify business_events for test operations
SELECT 
    'BUSINESS EVENTS FOR TESTS' as check_name,
    entity_type,
    event_type,
    COUNT(*) as count,
    MAX(created_at) as latest
FROM business_events
WHERE event_detail LIKE '%Test Run 2026-05-10%'
   OR event_detail LIKE '%TEST:%'
GROUP BY entity_type, event_type;

-- 5.3: Check for any posting errors
SELECT 
    'POSTING ERRORS CHECK' as check_name,
    COUNT(*) as error_count,
    GROUP_CONCAT(DISTINCT gl_posting_error) as errors
FROM inventory_movements
WHERE gl_posting_error IS NOT NULL
  AND notes LIKE '%TEST:%';

-- 5.4: Summary report
SELECT 
    'FINAL TEST SUMMARY' as report_type,
    'Cash Transactions Created' as metric,
    COUNT(*) as value
FROM cash_transactions
WHERE description LIKE '%TEST:%'
UNION ALL
SELECT 
    'FINAL TEST SUMMARY',
    'Inventory Movements Created',
    COUNT(*)
FROM inventory_movements
WHERE notes LIKE '%TEST:%'
UNION ALL
SELECT 
    'FINAL TEST SUMMARY',
    'Journal Entries Created',
    COUNT(*)
FROM journal_entries
WHERE description LIKE '%TEST:%'
UNION ALL
SELECT 
    'FINAL TEST SUMMARY',
    'Total Debit Amount (EGP)',
    ROUND(SUM(jel.debit), 2)
FROM journal_entry_lines jel
JOIN journal_entries je ON jel.entry_id = je.id
WHERE je.description LIKE '%TEST:%'
UNION ALL
SELECT 
    'FINAL TEST SUMMARY',
    'Total Credit Amount (EGP)',
    ROUND(SUM(jel.credit), 2)
FROM journal_entry_lines jel
JOIN journal_entries je ON jel.entry_id = je.id
WHERE je.description LIKE '%TEST:%';

-- ============================================================================
-- IMPORTANT NOTES FOR EXECUTION
-- ============================================================================
-- 
-- ⚠️ BEFORE RUNNING:
-- 1. Replace supplier_code (1001) with ACTUAL supplier from your database
-- 2. Replace center_code (1001) with ACTUAL center from your database
-- 3. Use items that exist in inventory
-- 4. Set correct GL accounts for your chart of accounts
--
-- ✅ EXPECTED RESULTS:
-- - All inserts succeed without errors
-- - JEs created immediately after operation posting
-- - All JEs have debit = credit (balance = 0)
-- - business_events linked correctly
-- - GL account codes match posting rules
--
-- ❌ COMMON ISSUES:
-- - supplier_code not in database → insert fails
-- - center_code not in database → insert fails
-- - item_code not in database → insert fails
-- - GL account not configured → JE not created
-- - GL posting error → check gl_posting_error field
--
-- ============================================================================
-- CLEANUP (Optional - to remove test data)
-- ============================================================================
--
-- DELETE FROM journal_entry_lines 
-- WHERE entry_id IN (SELECT id FROM journal_entries WHERE description LIKE '%TEST:%');
--
-- DELETE FROM journal_entries 
-- WHERE description LIKE '%TEST:%';
--
-- DELETE FROM cash_transactions 
-- WHERE description LIKE '%TEST:%';
--
-- DELETE FROM inventory_movements 
-- WHERE notes LIKE '%TEST:%';
--
-- DELETE FROM business_events 
-- WHERE event_detail LIKE '%Test Run 2026-05-10%' OR event_detail LIKE '%TEST:%';
--
-- ============================================================================
