-- ============================================================================
-- 0051_POSTING_ENGINE_PHASE1_BASICS.sql
-- 
-- Safe Additions — No breaking changes
-- Adds: Valid From/To, Multi-Currency prep, Business Unit, Audit
-- ============================================================================

PRAGMA foreign_keys = OFF;

-- 1. Valid From/To on posting_rules (Effective dating)
-- NULL = rule is always active (current behavior)
ALTER TABLE posting_rules ADD COLUMN valid_from TEXT DEFAULT NULL;
ALTER TABLE posting_rules ADD COLUMN valid_to TEXT DEFAULT NULL;

-- 2. Costing method on companies (for reference only in Phase 1)
ALTER TABLE companies ADD COLUMN costing_method TEXT DEFAULT 'ACTUAL' 
  CHECK(costing_method IN ('ACTUAL', 'STANDARD', 'FIFO', 'MOVING_AVERAGE', 'LIFO'));

-- 3. Base currency on companies
ALTER TABLE companies ADD COLUMN base_currency_code TEXT DEFAULT 'EGP';

-- 4. Multi-currency support on journal_entry_lines
ALTER TABLE journal_entry_lines ADD COLUMN currency_code TEXT DEFAULT 'EGP';
ALTER TABLE journal_entry_lines ADD COLUMN amount_in_base_currency REAL;
-- amount_in_base_currency = debit (if > 0) or credit (if > 0), converted to base

-- 5. Business Unit dimension on journal_entry_lines
ALTER TABLE journal_entry_lines ADD COLUMN business_unit_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_jel_business_unit ON journal_entry_lines(business_unit_id);

-- 6. Account Role reference (for Phase 3 transition)
ALTER TABLE journal_entry_lines ADD COLUMN account_role_id INTEGER;

-- 7. Warehouse dimension in posting_rules (optional, for location-specific rules)
ALTER TABLE posting_rules ADD COLUMN wh_id INTEGER;

-- 8. Priority for cascade matching (Phase 2)
-- 1 = exact match (BPG+PPG+WH), 2 = BPG+PPG, 3 = BPG only, 4 = default (NULL,NULL,NULL)
ALTER TABLE posting_rules ADD COLUMN priority_index INTEGER DEFAULT 100;

-- 9. Audit trail on posting_rules
ALTER TABLE posting_rules ADD COLUMN last_modified_by INTEGER;
ALTER TABLE posting_rules ADD COLUMN last_modified_at TEXT;

-- 10. Migration marker (for tracking which rules are old vs new)
ALTER TABLE posting_rules ADD COLUMN migrated_from_v1 INTEGER DEFAULT 0;

PRAGMA foreign_keys = ON;

-- ============================================================================
-- Verification
-- ============================================================================
SELECT 'Phase 1 Migration Complete' as status;
SELECT COUNT(*) as total_posting_rules FROM posting_rules;
SELECT COUNT(DISTINCT company_id) as total_companies FROM companies;
