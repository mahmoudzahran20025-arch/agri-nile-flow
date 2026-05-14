-- ========================================
-- Complete Database Cleanup Script
-- 2026-05-10
-- ========================================
-- Purpose: Remove legacy test data from 2026-05-09 and orphan JE 4807
-- Result: Start fresh with only production-ready data from 2026-05-10

BEGIN TRANSACTION;

-- Step 1: Delete journal_entry_lines from legacy entries (2026-05-09)
DELETE FROM journal_entry_lines 
WHERE entry_id IN (
  SELECT id FROM journal_entries 
  WHERE DATE(created_at) = '2026-05-09'
);

-- Step 2: Delete legacy journal_entries (2026-05-09)
DELETE FROM journal_entries 
WHERE DATE(created_at) = '2026-05-09';

-- Step 3: Delete orphan JE 4807 (posted with zero lines)
DELETE FROM journal_entries 
WHERE id = 4807;

COMMIT;

-- ========================================
-- Verification
-- ========================================
-- Show summary after cleanup

SELECT 'AFTER CLEANUP - SUMMARY' as status;

SELECT 
  COUNT(*) as total_journal_entries,
  COUNT(DISTINCT DATE(created_at)) as dates_with_entries
FROM journal_entries;

SELECT 
  COUNT(*) as total_journal_entry_lines,
  'Lines per entry' as metric
FROM journal_entry_lines;

-- Show entries count per date
SELECT 
  DATE(created_at) as entry_date,
  COUNT(*) as entry_count
FROM journal_entries
GROUP BY DATE(created_at)
ORDER BY entry_date;

-- Verify no orphans remain
SELECT 
  'Orphan Check (should be 0)' as metric,
  COUNT(*) as orphan_count
FROM journal_entries je
LEFT JOIN journal_entry_lines jel ON je.id = jel.entry_id
WHERE je.is_posted = 1 AND jel.id IS NULL;
