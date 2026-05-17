-- =============================================================================
-- Migration 0074: Inventory Posting Group → Correct Sub-Accounts
-- Date: 2026-05-02
-- =============================================================================
-- All 30 active inventory rules pointed to 140701 (summary).
-- Items have prod_posting_group_code assigned: FERT, SEED, CHEM, EQUIP.
-- Map each group to its correct leaf inventory account.
--
-- Mapping:
--   FERT  (24 items, fertilizers)        → 14070101 مخزون اسمدة
--   CHEM  (7 items, pesticides/chemicals) → 14070102 مخزن مبيدات
--   SEED  (14 items, seeds)              → 14070103 مخزون تقاوي وبذور
--   EQUIP (14+4 items, equipment/parts)  → 14070105 مخزن قطع غيار
--   NULL / fallback                      → 140701 (stays, catch-all)
-- =============================================================================

-- FERT group
UPDATE posting_rules
SET inventory_account = '14070101', updated_at = datetime('now')
WHERE company_id = 1
  AND rule_type = 'inventory'
  AND is_active = 1
  AND prod_posting_group_code = 'FERT';

-- CHEM group
UPDATE posting_rules
SET inventory_account = '14070102', updated_at = datetime('now')
WHERE company_id = 1
  AND rule_type = 'inventory'
  AND is_active = 1
  AND prod_posting_group_code = 'CHEM';

-- SEED group
UPDATE posting_rules
SET inventory_account = '14070103', updated_at = datetime('now')
WHERE company_id = 1
  AND rule_type = 'inventory'
  AND is_active = 1
  AND prod_posting_group_code = 'SEED';

-- EQUIP group (spare parts, equipment maintenance materials)
UPDATE posting_rules
SET inventory_account = '14070105', updated_at = datetime('now')
WHERE company_id = 1
  AND rule_type = 'inventory'
  AND is_active = 1
  AND prod_posting_group_code = 'EQUIP';

-- =============================================================================
-- VERIFICATION:
-- SELECT DISTINCT prod_posting_group_code, inventory_account
-- FROM posting_rules WHERE company_id=1 AND rule_type='inventory' AND is_active=1
-- ORDER BY prod_posting_group_code;
-- Expected: CHEM→14070102, EQUIP→14070105, FERT→14070101, SEED→14070103, NULL→140701
-- =============================================================================
