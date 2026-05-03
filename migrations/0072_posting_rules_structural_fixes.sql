-- =============================================================================
-- Migration 0072: Posting Rules Structural Fixes
-- Date: 2026-05-02
-- =============================================================================
-- Full architecture review findings — fix all silent failures in posting_rules.
--
-- ISSUE 1: accounts_payable / payable control rules → '2110' (parent code)
--   Fix: → '21100001' (ذمم دائنة تجارية - موردين) — correct trade-AP leaf
--
-- ISSUE 2: inventory control rule → '140701' (parent code)
--   Acceptable as catch-all for now; specific product groups need dedicated rules.
--   No change — documented as known gap in ARCHITECTURAL_GAPS.
--
-- ISSUE 3: EQUIPMENT general rule — phantom CoA codes
--   511401/611401/511403/140207 don't exist. Deactivate this rule to prevent
--   orphan journal_entry_lines with no CoA reference.
--
-- ISSUE 4: BEET-SEEDS / FERTILIZERS inventory rules — matching dimensions NULL
--   These named rules can never match (no bus/prod/inv_posting_group set).
--   Deactivate to prevent confusion; specific matching rules must be created
--   with proper dimension codes when product groups are assigned.
--
-- ISSUE 5: Duplicate general rules (18 rows, no dimension, different expense_account)
--   Non-deterministic. Keep only the ONE general rule with expense_account=51200034
--   (the catch-all). Deactivate the 6 general rules with expense_account=51010001
--   (wages should post via HR/payroll path using wages control rule, not general rules).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1: AP control rules → correct leaf account
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE posting_rules
SET account_code = '21100001', updated_at = datetime('now')
WHERE company_id = 1
  AND rule_type = 'control'
  AND mapping_key IN ('accounts_payable', 'payable');

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 3: Deactivate EQUIPMENT general rule — phantom CoA codes
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE posting_rules
SET is_active = 0, updated_at = datetime('now')
WHERE company_id = 1
  AND rule_type = 'general'
  AND mapping_key = 'EQUIPMENT';

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 4: Deactivate BEET-SEEDS / FERTILIZERS inventory rules (unmatchable)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE posting_rules
SET is_active = 0, updated_at = datetime('now')
WHERE company_id = 1
  AND rule_type = 'inventory'
  AND mapping_key IN ('BEET-SEEDS', 'FERTILIZERS');

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 5: Deactivate duplicate general rules with expense_account=51010001
--   (wages must route via control rule 'wages', not a general rule)
--   Keep all rules where expense_account='51200034' or expense_account IS NULL.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE posting_rules
SET is_active = 0, updated_at = datetime('now')
WHERE company_id = 1
  AND rule_type = 'general'
  AND mapping_key IS NULL
  AND expense_account = '51010001';

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 5b: Among the remaining duplicate general rules (expense_account=51200034),
--   keep only the highest-priority active one by setting priority=1 on one row
--   and deactivating the rest.
--   All 12 matching rows are identical — leave the first (lowest id) active at
--   priority 1, deactivate the rest.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE posting_rules
SET priority = 1, updated_at = datetime('now')
WHERE company_id = 1
  AND rule_type = 'general'
  AND mapping_key IS NULL
  AND expense_account = '51200034'
  AND is_active = 1
  AND id = (
    SELECT MIN(id) FROM posting_rules
    WHERE company_id = 1
      AND rule_type = 'general'
      AND mapping_key IS NULL
      AND expense_account = '51200034'
      AND is_active = 1
  );

UPDATE posting_rules
SET is_active = 0, updated_at = datetime('now')
WHERE company_id = 1
  AND rule_type = 'general'
  AND mapping_key IS NULL
  AND expense_account = '51200034'
  AND is_active = 1
  AND id != (
    SELECT MIN(id) FROM posting_rules
    WHERE company_id = 1
      AND rule_type = 'general'
      AND mapping_key IS NULL
      AND expense_account = '51200034'
  );

-- =============================================================================
-- VERIFICATION:
-- SELECT rule_type, mapping_key, account_code, expense_account, is_active
-- FROM posting_rules WHERE company_id=1 AND is_active=1
-- ORDER BY rule_type, mapping_key;
-- Expected:
--   control accounts_payable → 21100001
--   control payable         → 21100001
--   general (one row only)  → expense_account 51200034
--   inventory BEET-SEEDS/FERTILIZERS — absent from active results
-- =============================================================================
