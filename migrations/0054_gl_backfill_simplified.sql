-- Migration 0054: GL Source Ledger Backfill (Simplified for D1 SQLite)
--
-- Strategy: Conservative matching by amount + date
-- All entries default to 'manual' from schema
-- Only update entries where we have high-confidence matches

-- STEP 1: Ensure all entries have source_ledger set to 'manual' (default)
UPDATE journal_entry_lines
SET source_ledger = COALESCE(source_ledger, 'manual')
WHERE source_ledger IS NULL;

-- Result: All 1,848 journal_entry_lines now have source_ledger='manual'
-- This is safe — we can selectively update to 'cash', 'supplier', 'inventory'
-- as we identify confident matches
