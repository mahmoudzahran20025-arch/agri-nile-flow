-- =============================================================================
-- Migration 0073: CoA — Add Deferred Revenue & Fix AP/Deferred Collision
-- Date: 2026-05-02
-- =============================================================================
-- deferred_revenue control rule currently shares 21100001 with accounts_payable.
-- Customer advance payments (إيرادات مؤجلة) must be separated from trade AP.
--
-- Add: 21300001  إيرادات مؤجلة - دفعات مقدمة عملاء  (liability / credit)
-- Update deferred_revenue control rule → 21300001
-- =============================================================================

INSERT INTO chart_of_accounts (
  company_id, code, name, account_type, normal_balance,
  parent_code, level, is_header, is_active
)
VALUES (
  1, '21300001', 'إيرادات مؤجلة - دفعات مقدمة عملاء',
  'liability', 'credit',
  NULL, 2, 0, 1
);

UPDATE posting_rules
SET account_code = '21300001', updated_at = datetime('now')
WHERE company_id = 1
  AND rule_type = 'control'
  AND mapping_key = 'deferred_revenue';

-- =============================================================================
-- VERIFICATION:
-- SELECT mapping_key, account_code FROM posting_rules
-- WHERE company_id=1 AND mapping_key IN ('accounts_payable','deferred_revenue');
-- Expected: accounts_payable → 21100001, deferred_revenue → 21300001
-- =============================================================================
