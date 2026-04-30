-- ============================================================================
-- PHASE 3B: LINK ITEMS TO NEW PRODUCT POSTING GROUPS (V2 - Schema Fixed)
-- Uses 'name' column (not 'item_name')
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
  AND (name LIKE '%بذور%' OR code LIKE '%SEED%')
  AND posting_group_code IS NULL;

SELECT 'SEED items linked' as status, COUNT(*) as count FROM items WHERE posting_group_code = 'SEED' AND company_id = 1;

-- ============================================================================
-- 2. LINK CHEM PPG (مبيدات وكيماويات)
-- ============================================================================
UPDATE items 
SET posting_group_code = 'CHEM', 
    bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 
  AND (name LIKE '%مبيد%' 
       OR name LIKE '%كيماوي%'
       OR name LIKE '%مخصب%'
       OR name LIKE '%علف%'
       OR code LIKE '%CHEM%'
       OR code LIKE '%PEST%')
  AND posting_group_code IS NULL;

SELECT 'CHEM items linked' as status, COUNT(*) as count FROM items WHERE posting_group_code = 'CHEM' AND company_id = 1;

-- ============================================================================
-- 3. LINK HARVEST PPG (محاصيل)
-- ============================================================================
UPDATE items 
SET posting_group_code = 'HARVEST', 
    bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 
  AND (name LIKE '%محصول%'
       OR name LIKE '%بنجر%'
       OR name LIKE '%قصب%'
       OR name LIKE '%قطن%'
       OR name LIKE '%قمح%'
       OR code LIKE '%BEET%'
       OR code LIKE '%CROP%'
       OR code LIKE '%HRV%')
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
  AND (name LIKE '%جرار%'
       OR name LIKE '%حصادة%'
       OR name LIKE '%مضخة%'
       OR name LIKE '%ماكينة%'
       OR name LIKE '%آلة%'
       OR name LIKE '%معدات%'
       OR code LIKE '%TRACTOR%'
       OR code LIKE '%MACHINE%')
  AND posting_group_code = 'EQUIP';

SELECT 'EQUIP_CAP items linked' as status, COUNT(*) as count FROM items WHERE posting_group_code = 'EQUIP_CAP' AND company_id = 1;

-- EQUIP_CONS: Consumables/spare parts
UPDATE items 
SET posting_group_code = 'EQUIP_CONS', 
    bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 
  AND (name LIKE '%قطعة غيار%'
       OR name LIKE '%صيانة%'
       OR name LIKE '%زيت%'
       OR name LIKE '%شحوم%'
       OR name LIKE '%مستهلكات%'
       OR code LIKE '%PART%'
       OR code LIKE '%SPARE%')
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

-- Sample of linked items
SELECT code, name, posting_group_code, bus_posting_group_code 
FROM items 
WHERE posting_group_code IN ('SEED', 'CHEM', 'HARVEST', 'EQUIP_CAP', 'EQUIP_CONS') 
AND company_id = 1 
LIMIT 10;

SELECT 'ITEM LINKING TO NEW PPGs COMPLETED' as final_status;
