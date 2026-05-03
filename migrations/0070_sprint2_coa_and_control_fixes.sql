-- =============================================================================
-- Migration 0070: Sprint 2 — CoA account_type + Control Rule Leaf Fixes
-- Date: 2026-05-02
-- =============================================================================
-- Fixes three categories of issues found in post-0069 DB audit:
--
-- FIX-1: Group 7x accounts tagged account_type='expense' — should be 'revenue'
--   All إيرادات other income / investment income accounts show as expenses on
--   the Income Statement, hiding ~Xم EGP of other income.
--
-- FIX-2: Group 25x equity accounts tagged account_type='liability'
--   رأس المال, احتياطيات, أرباح مرحلة all appear on Balance Sheet under
--   liabilities instead of equity — equity section shows zero.
--
-- FIX-3: Control rules using parent-node codes instead of posting leaf accounts
--   Parent codes (3, 6, 7, 22) cannot receive journal entry lines — D1 FK
--   constraints and posting engine validation both require leaf codes.
--   Fix: point each control rule to the correct leaf account.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX-1: Group 7x — other income accounts incorrectly tagged 'expense'
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE chart_of_accounts
SET account_type = 'revenue'
WHERE company_id = 1
  AND code LIKE '7%'
  AND account_type = 'expense';

-- Verify: SELECT COUNT(*) FROM chart_of_accounts WHERE company_id=1 AND code LIKE '7%' AND account_type='expense';
-- Expected: 0

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX-2: Group 25x — equity accounts incorrectly tagged 'liability'
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE chart_of_accounts
SET account_type = 'equity'
WHERE company_id = 1
  AND code LIKE '25%'
  AND account_type = 'liability';

-- Verify: SELECT COUNT(*) FROM chart_of_accounts WHERE company_id=1 AND code LIKE '25%' AND account_type='liability';
-- Expected: 0

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX-3: Control rules — replace parent codes with posting leaf accounts
-- ─────────────────────────────────────────────────────────────────────────────

-- equity: '3' (parent حقوق الملكية) → '25010001' (رأس المال — leaf)
UPDATE posting_rules
SET account_code = '25010001'
WHERE company_id = 1
  AND rule_type = 'control'
  AND mapping_key = 'equity';

-- partner_current_account: '2105' (WRONG — أوراق الدفع، notes payable)
--   Partners in this entity draw against equity (رأس المال), not a separate
--   current account leaf — map to رأس المال until a partner-current sub-account
--   is added to the CoA.
UPDATE posting_rules
SET account_code = '25010001'
WHERE company_id = 1
  AND rule_type = 'control'
  AND mapping_key = 'partner_current_account';

-- wip_contra: '3' (parent) → '25010001' (رأس المال — equity contra for WIP)
UPDATE posting_rules
SET account_code = '25010001'
WHERE company_id = 1
  AND rule_type = 'control'
  AND mapping_key = 'wip_contra';

-- accumulated_depreciation: '22' (parent مجمعات الإهلاك) → '22030001' (مجمع إهلاك آلات ومعدات — general default leaf)
UPDATE posting_rules
SET account_code = '22030001'
WHERE company_id = 1
  AND rule_type = 'control'
  AND mapping_key = 'accumulated_depreciation';

-- harvest_revenue: '7' (parent الايرادات, tagged expense!) → '41010001' (إيراد نشاط المحصول — correct revenue leaf)
UPDATE posting_rules
SET account_code = '41010001'
WHERE company_id = 1
  AND rule_type = 'control'
  AND mapping_key = 'harvest_revenue';

-- harvest_cogs: '6' (parent تكاليف النشاط) → '45010001' (تكلفة المبيعات — correct COGS leaf, already fixed in CoA by 0069)
UPDATE posting_rules
SET account_code = '45010001'
WHERE company_id = 1
  AND rule_type = 'control'
  AND mapping_key = 'harvest_cogs';

-- =============================================================================
-- VERIFICATION QUERIES:
-- =============================================================================
-- 1. FIX-1: should return 0
--    SELECT COUNT(*) FROM chart_of_accounts WHERE company_id=1 AND code LIKE '7%' AND account_type='expense';
--
-- 2. FIX-2: should return 0
--    SELECT COUNT(*) FROM chart_of_accounts WHERE company_id=1 AND code LIKE '25%' AND account_type='liability';
--
-- 3. FIX-3: all control rules should now point to leaf accounts
--    SELECT pr.mapping_key, pr.account_code, coa.name, coa.is_header
--    FROM posting_rules pr
--    JOIN chart_of_accounts coa ON coa.company_id=pr.company_id AND coa.code=pr.account_code
--    WHERE pr.company_id=1 AND pr.rule_type='control'
--    ORDER BY pr.mapping_key;
--    Expected: is_header=0 for all rows (all leaves)
-- =============================================================================
