-- ORDERED LEDGER PROPAGATION
PRAGMA foreign_keys = OFF;

-- 1. Unpost to allow updates
UPDATE journal_entries SET is_posted = 0 
WHERE company_id = 1 AND ref_type IN ('cash_transaction', 'supplier_transaction');

-- 2. Propagate Cash Centers
UPDATE journal_entry_lines 
SET center_code = (SELECT center_code FROM cash_transactions ct WHERE ct.journal_entry_id = journal_entry_lines.entry_id LIMIT 1)
WHERE center_code IS NULL 
  AND entry_id IN (SELECT id FROM journal_entries WHERE ref_type = 'cash_transaction');

-- 3. Propagate Supplier Centers (for payments)
UPDATE journal_entry_lines 
SET center_code = (SELECT center_code FROM supplier_transactions st WHERE st.journal_entry_id = journal_entry_lines.entry_id LIMIT 1)
WHERE center_code IS NULL 
  AND entry_id IN (SELECT id FROM journal_entries WHERE ref_type = 'supplier_transaction');

-- 4. Re-post
UPDATE journal_entries SET is_posted = 1 
WHERE company_id = 1 AND ref_type IN ('cash_transaction', 'supplier_transaction');

PRAGMA foreign_keys = ON;

-- 5. Final Verify
SELECT source_ledger, COUNT(*) as total_lines, COUNT(center_code) as linked_lines
FROM journal_entry_lines
WHERE company_id = 1
GROUP BY source_ledger;
