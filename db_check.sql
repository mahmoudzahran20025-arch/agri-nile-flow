-- 1. Total accounts breakdown
SELECT is_header, account_type, count(*) as count 
FROM chart_of_accounts 
GROUP BY is_header, account_type;

-- 2. Total journal entries & lines
SELECT 
  (SELECT count(*) FROM journal_entries) as total_entries,
  (SELECT count(*) FROM journal_entry_lines) as total_lines;

-- 3. Phantom Accounts (Used in ledger but missing in CoA)
SELECT l.account_code, COUNT(*) as line_count, SUM(l.debit) as total_dr, SUM(l.credit) as total_cr
FROM journal_entry_lines l
LEFT JOIN chart_of_accounts a ON l.account_code = a.code AND l.company_id = a.company_id
WHERE a.code IS NULL
GROUP BY l.account_code;

-- 4. Unbalanced Journal Entries
SELECT e.id, e.entry_number, SUM(l.debit) as total_dr, SUM(l.credit) as total_cr, (SUM(COALESCE(l.debit, 0)) - SUM(COALESCE(l.credit, 0))) as difference
FROM journal_entries e
JOIN journal_entry_lines l ON e.id = l.entry_id
GROUP BY e.id
HAVING ABS(SUM(COALESCE(l.debit, 0)) - SUM(COALESCE(l.credit, 0))) > 0.01;

-- 5. Accounts with no transactions (Idle Leaf Accounts)
SELECT count(*) as idle_leaf_accounts
FROM chart_of_accounts a
LEFT JOIN journal_entry_lines l ON a.code = l.account_code AND a.company_id = l.company_id
WHERE a.is_header = 0 AND l.id IS NULL;

-- 6. Accounts used in transactions but marked as header!
SELECT a.code, a.name, count(l.id) as line_count
FROM chart_of_accounts a
JOIN journal_entry_lines l ON a.code = l.account_code AND a.company_id = l.company_id
WHERE a.is_header = 1
GROUP BY a.code, a.name;
