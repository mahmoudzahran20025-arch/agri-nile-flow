-- Phase 1 Safe Migration - Corrected
-- Adds new columns needed for Phase 1

PRAGMA foreign_keys = OFF;

-- Add to posting_rules
ALTER TABLE posting_rules ADD COLUMN valid_from TEXT DEFAULT NULL;
ALTER TABLE posting_rules ADD COLUMN valid_to TEXT DEFAULT NULL;
ALTER TABLE posting_rules ADD COLUMN priority_index INTEGER DEFAULT 100;
ALTER TABLE posting_rules ADD COLUMN migrated_from_v1 INTEGER DEFAULT 0;
ALTER TABLE posting_rules ADD COLUMN last_modified_by INTEGER;
ALTER TABLE posting_rules ADD COLUMN last_modified_at TEXT;
ALTER TABLE posting_rules ADD COLUMN wh_id INTEGER;

-- Add to companies
ALTER TABLE companies ADD COLUMN costing_method TEXT DEFAULT 'ACTUAL' CHECK(costing_method IN ('ACTUAL', 'STANDARD', 'FIFO', 'MOVING_AVERAGE', 'LIFO'));
ALTER TABLE companies ADD COLUMN base_currency_code TEXT DEFAULT 'EGP';

-- Add to journal_entry_lines  
ALTER TABLE journal_entry_lines ADD COLUMN currency_code TEXT DEFAULT 'EGP';
ALTER TABLE journal_entry_lines ADD COLUMN amount_in_base_currency REAL;
ALTER TABLE journal_entry_lines ADD COLUMN business_unit_id INTEGER;
ALTER TABLE journal_entry_lines ADD COLUMN account_role_id INTEGER;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_posting_rules_company ON posting_rules(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_jel_business_unit ON journal_entry_lines(business_unit_id);
CREATE INDEX IF NOT EXISTS idx_jel_currency ON journal_entry_lines(currency_code);

PRAGMA foreign_keys = ON;

-- Verification
SELECT 'Migration 0051 applied successfully' as status;
