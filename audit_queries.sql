-- Query 1: Count journal entries
SELECT COUNT(*) as total_entries FROM journal_entries WHERE is_posted = 1;

-- Query 2: Check ref_type breakdown (to understand data sources)
SELECT ref_type, COUNT(*) as count 
FROM journal_entries 
WHERE is_posted = 1 
GROUP BY ref_type;

-- Query 3: GL Balance check (Company 1)
SELECT 
  'Company 1' as company,
  SUM(debit) as total_debit,
  SUM(credit) as total_credit,
  ABS(SUM(debit) - SUM(credit)) as imbalance
FROM journal_entry_lines jl
JOIN journal_entries je ON je.id = jl.entry_id
WHERE je.company_id = 1 AND je.is_posted = 1;

-- Query 4: Lines with source tracking
SELECT 
  COUNT(*) as total_lines,
  COUNT(CASE WHEN source_ledger IS NOT NULL THEN 1 END) as with_source_ledger,
  COUNT(CASE WHEN source_ledger IS NULL THEN 1 END) as without_source_ledger,
  COUNT(CASE WHEN source_record_id IS NOT NULL THEN 1 END) as with_source_record
FROM journal_entry_lines jl
JOIN journal_entries je ON je.id = jl.entry_id
WHERE je.company_id = 1 AND je.is_posted = 1;

-- Query 5: Business events status
SELECT 
  status,
  COUNT(*) as count,
  COUNT(CASE WHEN journal_entry_id IS NOT NULL THEN 1 END) as linked_to_gl
FROM business_events
WHERE company_id = 1
GROUP BY status;

-- Query 6: Monthly breakdown of entries
SELECT 
  strftime('%Y-%m', entry_date) as month,
  COUNT(*) as entry_count,
  COUNT(CASE WHEN ref_type IS NOT NULL THEN 1 END) as with_ref
FROM journal_entries
WHERE company_id = 1 AND is_posted = 1
GROUP BY strftime('%Y-%m', entry_date)
ORDER BY month;
