-- ============================================
-- Migration: Add missing journal_entry_id columns
-- Priority: P0-2 - Critical for subledger linkage
-- Tables: wip_balances, depreciation_schedules, work_tasks, harvests
-- ============================================

-- 1. wip_balances — for wip_carryforward events
ALTER TABLE wip_balances ADD COLUMN journal_entry_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_wip_balances_journal_entry_id ON wip_balances(company_id, journal_entry_id);

-- 2. depreciation_schedules — for depreciation events
ALTER TABLE depreciation_schedules ADD COLUMN journal_entry_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_depreciation_schedules_journal_entry_id ON depreciation_schedules(company_id, journal_entry_id);

-- 3. work_tasks — for work_order_labor events
ALTER TABLE work_tasks ADD COLUMN journal_entry_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_work_tasks_journal_entry_id ON work_tasks(company_id, journal_entry_id);

-- 4. harvests — for harvest_revenue and harvest_cogs events
ALTER TABLE harvests ADD COLUMN journal_entry_id INTEGER;
ALTER TABLE harvests ADD COLUMN cogs_journal_entry_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_harvests_journal_entry_id ON harvests(company_id, journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_harvests_cogs_journal_entry_id ON harvests(company_id, cogs_journal_entry_id);

-- ============================================
-- Verification queries (should return 0 before backfill)
-- ============================================

-- Check column addition
SELECT 
  'wip_balances' as table_name,
  COUNT(*) as total_rows,
  COUNT(journal_entry_id) as with_je_id
FROM wip_balances
UNION ALL
SELECT 
  'depreciation_schedules',
  COUNT(*),
  COUNT(journal_entry_id)
FROM depreciation_schedules
UNION ALL
SELECT 
  'work_tasks',
  COUNT(*),
  COUNT(journal_entry_id)
FROM work_tasks
UNION ALL
SELECT 
  'harvests',
  COUNT(*),
  COUNT(journal_entry_id)
FROM harvests;
