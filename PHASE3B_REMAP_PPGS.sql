-- ============================================================================
-- PHASE 3B: REMAP OLD PPGs TO NEW PRODUCT POSTING GROUPS
-- Maps: BEET → HARVEST, FERT → CHEM, EQUIP → EQUIP_CAP
-- Date: April 30, 2026
-- ============================================================================

-- Before
SELECT 'BEFORE REMAPPING' as status;
SELECT posting_group_code, COUNT(*) as cnt FROM items WHERE company_id = 1 GROUP BY posting_group_code ORDER BY posting_group_code;

-- ============================================================================
-- REMAP: BEET → HARVEST (محاصيل)
-- ============================================================================
UPDATE items SET posting_group_code = 'HARVEST', bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 AND posting_group_code = 'BEET';

-- ============================================================================
-- REMAP: FERT → CHEM (كيماويات ومخصبات)
-- ============================================================================
UPDATE items SET posting_group_code = 'CHEM', bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 AND posting_group_code = 'FERT';

-- ============================================================================
-- SPLIT: EQUIP → EQUIP_CAP (معدات رأسمالية)
-- Based on name patterns - capital equipment
-- ============================================================================
UPDATE items 
SET posting_group_code = 'EQUIP_CAP', 
    bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 
  AND posting_group_code = 'EQUIP'
  AND (name LIKE '%جرار%' 
       OR name LIKE '%حصادة%' 
       OR name LIKE '%مضخة%'
       OR name LIKE '%ماكينة%'
       OR name LIKE '%آلة%');

-- ============================================================================
-- SPLIT: EQUIP → EQUIP_CONS (مستهلكات)
-- Everything else in EQUIP becomes consumable
-- ============================================================================
UPDATE items 
SET posting_group_code = 'EQUIP_CONS', 
    bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 
  AND posting_group_code = 'EQUIP';

-- ============================================================================
-- OPTIONAL: Map by name for items without PPG or in MISC
-- ============================================================================

-- SEED - بذور
UPDATE items SET posting_group_code = 'SEED', bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 
  AND (name LIKE '%بذور%' OR name LIKE '%تقاوي%')
  AND (posting_group_code IS NULL OR posting_group_code IN ('MISC', 'SERV', 'FUEL'));

-- HARVEST - محاصيل
UPDATE items SET posting_group_code = 'HARVEST', bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 
  AND (name LIKE '%بنجر%' OR name LIKE '%قصب%' OR name LIKE '%قطن%' OR name LIKE '%محصول%')
  AND (posting_group_code IS NULL OR posting_group_code IN ('MISC', 'SERV', 'FUEL'));

-- CHEM - مبيدات وكيماويات
UPDATE items SET posting_group_code = 'CHEM', bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 
  AND (name LIKE '%مبيد%' OR name LIKE '%كيماوي%' OR name LIKE '%مخصب%')
  AND (posting_group_code IS NULL OR posting_group_code IN ('MISC', 'SERV', 'FUEL'));

-- ============================================================================
-- AFTER
-- ============================================================================
SELECT 'AFTER REMAPPING' as status;
SELECT posting_group_code, COUNT(*) as cnt FROM items WHERE company_id = 1 GROUP BY posting_group_code ORDER BY posting_group_code;

-- Show items still in old PPGs or without PPG
SELECT 'Items needing attention' as warning, posting_group_code, COUNT(*) as cnt 
FROM items 
WHERE company_id = 1 
  AND (posting_group_code IN ('MISC', 'SERV', 'FUEL') OR posting_group_code IS NULL)
GROUP BY posting_group_code;

SELECT 'REMAPPING COMPLETED' as final_status;
