-- ============================================================================
-- LINK ITEMS TO PRODUCT POSTING GROUPS (PPG)
-- ============================================================================

-- Add posting_group_code column to items if not exists
-- Note: This may fail if column already exists, which is fine
ALTER TABLE items ADD COLUMN posting_group_code TEXT;
ALTER TABLE items ADD COLUMN bus_posting_group_code TEXT;

-- ============================================================================
-- UPDATE ITEMS WITH POSTING GROUPS BASED ON ITEM CODE RANGES
-- ============================================================================

-- BEET (بنجر) - Items with code 1030xxxx
UPDATE items SET 
  posting_group_code = 'BEET',
  bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 
  AND CAST(code AS TEXT) LIKE '1030%';

-- FERTILIZERS (أسمدة) - Items with code 1020xxxx  
UPDATE items SET 
  posting_group_code = 'FERT',
  bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 
  AND CAST(code AS TEXT) LIKE '1020%';

-- SEEDS (تقاوي أخرى) - Items with code 103xxxx but not 1030 (non-beet seeds)
UPDATE items SET 
  posting_group_code = 'SEEDS',
  bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 
  AND CAST(code AS TEXT) LIKE '103%'
  AND CAST(code AS TEXT) NOT LIKE '1030%';

-- FUEL (وقود) - Items with code 108xxxx or name contains fuel
UPDATE items SET 
  posting_group_code = 'FUEL',
  bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 
  AND (CAST(code AS TEXT) LIKE '108%' OR name LIKE '%وقود%' OR name LIKE '%سولار%' OR name LIKE '%بنزين%');

-- EQUIPMENT (معدات) - Items with code 104xxxx or 105xxxx
UPDATE items SET 
  posting_group_code = 'EQUIP',
  bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 
  AND (CAST(code AS TEXT) LIKE '104%' OR CAST(code AS TEXT) LIKE '105%');

-- SERVICES (خدمات) - Items with code 107xxxx
UPDATE items SET 
  posting_group_code = 'SERV',
  bus_posting_group_code = 'AGRI-OP'
WHERE company_id = 1 
  AND CAST(code AS TEXT) LIKE '107%';

-- MISC (متنوعات) - All other items default to MISC
UPDATE items SET 
  posting_group_code = 'MISC',
  bus_posting_group_code = 'DOMESTIC'
WHERE company_id = 1 
  AND posting_group_code IS NULL;

-- ============================================================================
-- VERIFICATION - SHOW ITEMS WITH THEIR POSTING GROUPS
-- ============================================================================
SELECT '=== ITEMS LINKED TO POSTING GROUPS ===' as status;

SELECT posting_group_code, COUNT(*) as item_count FROM items WHERE company_id = 1 GROUP BY posting_group_code ORDER BY item_count DESC;
