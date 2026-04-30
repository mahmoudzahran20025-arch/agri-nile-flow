-- ============================================================================
-- PHASE 3B: LINK ITEMS TO NEW PRODUCT POSTING GROUPS (FIXED)
-- Date: April 30, 2026
-- ============================================================================

-- Check current distribution
SELECT 'Current Item Distribution' as check_before;
SELECT posting_group_code, COUNT(*) as item_count FROM items WHERE company_id = 1 GROUP BY posting_group_code ORDER BY posting_group_code;

-- ============================================================================
-- 1. LINK SEED PPG (بذور أساسية)
-- ============================================================================
UPDATE items 
SET posting_group_code = 'SEED', 
    bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 
  AND (item_name LIKE '%بذور%' OR item_code LIKE '%SEED%')
  AND posting_group_code IS NULL;

SELECT 'SEED items linked' as status, COUNT(*) as count FROM items WHERE posting_group_code = 'SEED' AND company_id = 1;

-- ============================================================================
-- 2. LINK CHEM PPG (مبيدات وكيماويات)
-- ============================================================================
UPDATE items 
SET posting_group_code = 'CHEM', 
    bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 
  AND (item_name LIKE '%مبيد%' 
       OR item_name LIKE '%كيماوي%'
       OR item_name LIKE '%مخصب%'
       OR item_name LIKE '%علف%'
       OR item_code LIKE '%CHEM%'
       OR item_code LIKE '%PEST%')
  AND posting_group_code IS NULL;

SELECT 'CHEM items linked' as status, COUNT(*) as count FROM items WHERE posting_group_code = 'CHEM' AND company_id = 1;

-- ============================================================================
-- 3. LINK HARVEST PPG (محاصيل)
-- ============================================================================
UPDATE items 
SET posting_group_code = 'HARVEST', 
    bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 
  AND (item_name LIKE '%محصول%'
       OR item_name LIKE '%بنجر%'
       OR item_name LIKE '%قصب%'
       OR item_name LIKE '%قطن%'
       OR item_name LIKE '%قمح%'
       OR item_code LIKE '%BEET%'
       OR item_code LIKE '%CROP%'
       OR item_code LIKE '%HRV%')
  AND posting_group_code IS NULL;

SELECT 'HARVEST items linked' as status, COUNT(*) as count FROM items WHERE posting_group_code = 'HARVEST' AND company_id = 1;

-- ============================================================================
-- 4. SPLIT EQUIP INTO EQUIP_CAP vs EQUIP_CONS
-- ============================================================================

-- EQUIP_CAP: Capital equipment
UPDATE items 
SET posting_group_code = 'EQUIP_CAP', 
    bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 
  AND (item_name LIKE '%جرار%'
       OR item_name LIKE '%حصادة%'
       OR item_name LIKE '%مضخة%'
       OR item_name LIKE '%ماكينة%'
       OR item_name LIKE '%آلة%'
       OR item_name LIKE '%معدات%'
       OR item_code LIKE '%TRACTOR%'
       OR item_code LIKE '%MACHINE%')
  AND posting_group_code = 'EQUIP';

SELECT 'EQUIP_CAP items linked' as status, COUNT(*) as count FROM items WHERE posting_group_code = 'EQUIP_CAP' AND company_id = 1;

-- EQUIP_CONS: Consumables/spare parts
UPDATE items 
SET posting_group_code = 'EQUIP_CONS', 
    bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 
  AND (item_name LIKE '%قطعة غيار%'
       OR item_name LIKE '%صيانة%'
       OR item_name LIKE '%زيت%'
       OR item_name LIKE '%شحوم%'
       OR item_name LIKE '%مستهلكات%'
       OR item_code LIKE '%PART%'
       OR item_code LIKE '%SPARE%')
  AND posting_group_code = 'EQUIP';

SELECT 'EQUIP_CONS items linked' as status, COUNT(*) as count FROM items WHERE posting_group_code = 'EQUIP_CONS' AND company_id = 1;

-- ============================================================================
-- 5. FINAL VERIFICATION
-- ============================================================================

SELECT 'FINAL Item Distribution' as check_after;
SELECT posting_group_code, COUNT(*) as item_count 
FROM items 
WHERE company_id = 1 
GROUP BY posting_group_code 
ORDER BY posting_group_code;

-- Show items without PPG
SELECT 'Items without PPG' as warning, COUNT(*) as orphan_count 
FROM items 
WHERE company_id = 1 AND (posting_group_code IS NULL OR posting_group_code = '');

SELECT 'ITEM LINKING TO NEW PPGs COMPLETED' as final_status;
