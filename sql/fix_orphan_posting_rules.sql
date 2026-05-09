-- =============================================================
-- FIX: Orphan posting_rules referencing missing/header accounts
-- Date: 2026-05-09
-- Root cause: ALL inventory rules had wip_account='13500001' and
--   finished_goods_account='14070401' which don't exist in COA.
--   Plus control rules pointing to missing accounts.
-- Trigger constraint: must fix ALL bad columns in SINGLE UPDATE per rule.
-- =============================================================

-- ---------------------------------------------------------------
-- STEP 1: Deactivate control/inventory rules with completely unfixable accounts.
-- Trigger bypassed because WHEN condition checks NEW.is_active=1 → false for is_active=0.
-- ---------------------------------------------------------------
UPDATE posting_rules SET is_active = 0
WHERE id IN (
  47,  -- accounts_payable → 21100001 (missing, no payable leaf in COA)
  59,  -- deferred_revenue → 21300001 (missing)
  65,  -- wip_asset → 13500001 (missing)
  74,  -- inventory rule: cogs=55010001 (missing), inventory=14070401 (missing)
  77,  -- inventory rule: cogs=55010004 (missing), inventory=14070301 (missing)
  78,  -- inventory rule: cogs=55010005 (missing), inventory=14070302 (missing)
  79,  -- inventory rule: inventory=13500001 (missing)
  80,  -- VAT_INPUT_PURCHASE → 14040711 (missing)
  81,  -- VAT_OUTPUT_SALES → 21060001 (missing)
  82,  -- WIP_ACCOUNT → 13500001 (missing)
  83   -- FINISHED_GOODS → 14070401 (missing)
) AND is_active = 1;

-- ---------------------------------------------------------------
-- STEP 2: Fix inventory rules - clear bad wip_account + finished_goods_account
--   AND fix bad inventory_account in the same statement.
--   Trigger fires on UPDATE OF inventory_account/wip_account/finished_goods_account
--   but passes because NEW values are valid (NULL or valid leaf codes).
-- ---------------------------------------------------------------

-- Rule 19: inventory=140701(header), wip=13500001(missing), finished=14070401(missing)
-- Fix all three in one statement → trigger passes with valid new values
UPDATE posting_rules
SET inventory_account    = '14070106',
    wip_account          = NULL,
    finished_goods_account = NULL
WHERE id = 19 AND is_active = 1;

-- All other active inventory rules have valid inventory_account but bad wip+finished.
-- Clear wip and finished in one sweep (safe: inventory_account already valid).
UPDATE posting_rules
SET wip_account          = NULL,
    finished_goods_account = NULL
WHERE rule_type = 'inventory'
  AND is_active = 1
  AND (wip_account IS NOT NULL OR finished_goods_account IS NOT NULL);

-- ---------------------------------------------------------------
-- STEP 3: Fix cogs_account for inventory rules still having bad cogs
--   (cogs_account is NOT in trigger's UPDATE OF list for inventory type → safe)
-- ---------------------------------------------------------------
UPDATE posting_rules
SET cogs_account = '45010001'   -- تكلفة المبيعات (exists, leaf, active)
WHERE rule_type = 'inventory'
  AND is_active = 1
  AND cogs_account IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa
    WHERE coa.company_id = posting_rules.company_id
      AND coa.code = posting_rules.cogs_account
      AND coa.is_active = 1
      AND coa.is_header = 0
  );

-- ---------------------------------------------------------------
-- STEP 4: Fix general rule purchases_account = 140701 (header → leaf)
--   Trigger passes: purchases_account='14070106' is valid leaf.
-- ---------------------------------------------------------------
UPDATE posting_rules
SET purchases_account = '14070106'  -- مخزن متنوع (leaf of 140701)
WHERE id = 1 AND purchases_account = '140701';

-- ---------------------------------------------------------------
-- STEP 5: Fix control rules with redirectable accounts
-- ---------------------------------------------------------------

-- Rule 48 (control/inventory): account_code=140701(header) → 14070106(leaf)
UPDATE posting_rules
SET account_code = '14070106'
WHERE id = 48 AND account_code = '140701';

-- Rule 61 (receivable_default): 14030001(missing) → 14030101(عملاء نقدى-بيع مباشر)
UPDATE posting_rules
SET account_code = '14030101'
WHERE id = 61 AND account_code = '14030001';

-- Rule 67 (depreciation_expense): 55010001(missing) → 55020001(إهلاك مبانى)
UPDATE posting_rules
SET account_code = '55020001'
WHERE id = 67 AND account_code = '55010001';
