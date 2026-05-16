-- Migration 0123: Add crop_name to fields table
-- Date: 2026-05-15
-- Rationale: Align schema with cost-per-feddan report requirements.

ALTER TABLE fields ADD COLUMN crop_name TEXT;

-- Verification
SELECT 
  'migration_0123_complete' AS status,
  (SELECT COUNT(*) FROM pragma_table_info('fields') WHERE name = 'crop_name') AS crop_name_col_exists;
