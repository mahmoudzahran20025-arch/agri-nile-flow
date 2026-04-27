-- Phase 3a: Add missing Inventory Posting Groups
INSERT OR IGNORE INTO inventory_posting_groups (company_id, code, name, is_active)
VALUES
  (1, 'CHEM-WH',  'مخزن المبيدات',       1),
  (1, 'OIL-WH',   'مخزن الزيوت والوقود', 1),
  (1, 'IRR-WH',   'مخزن شبكات الري',     1),
  (1, 'SPARE-WH', 'مخزن قطع الغيار',     1),
  (1, 'PACK-WH',  'مخزن التعبئة والتغليف',1),
  (1, 'MISC-WH',  'مخزن المتنوعات',      1);

-- Phase 3b: Assign IPG to warehouses (by name pattern)
UPDATE warehouses SET inv_posting_group_code = 'FERT-WH'  WHERE name LIKE '%سماد%'  OR name LIKE '%اسمد%';
UPDATE warehouses SET inv_posting_group_code = 'CHEM-WH'  WHERE name LIKE '%مبيد%';
UPDATE warehouses SET inv_posting_group_code = 'SEED-WH'  WHERE name LIKE '%تقاو%'  OR name LIKE '%بذور%';
UPDATE warehouses SET inv_posting_group_code = 'OIL-WH'   WHERE name LIKE '%زيوت%'  OR name LIKE '%وقود%';
UPDATE warehouses SET inv_posting_group_code = 'IRR-WH'   WHERE name LIKE '%شبك%'   OR name LIKE '%ري%';
UPDATE warehouses SET inv_posting_group_code = 'SPARE-WH' WHERE name LIKE '%قطع%'   OR name LIKE '%غيار%';
UPDATE warehouses SET inv_posting_group_code = 'PACK-WH'  WHERE name LIKE '%تعبئ%'  OR name LIKE '%تغليف%';
UPDATE warehouses SET inv_posting_group_code = 'MISC-WH'  WHERE inv_posting_group_code IS NULL;

-- Phase 3c: Assign BPG to suppliers (by name/code pattern)
UPDATE suppliers SET bus_posting_group_code = 'GOVT'
WHERE name LIKE '%جهاز%' OR name LIKE '%حكوم%' OR name LIKE '%وزارة%'
   OR code LIKE '20900%';

UPDATE suppliers SET bus_posting_group_code = 'CUSTOMER'
WHERE name LIKE '%عميل%' OR code LIKE '101%';

UPDATE suppliers SET bus_posting_group_code = 'LOCAL'
WHERE bus_posting_group_code IS NULL;

-- Phase 3d: Assign PPG to items (by item code prefix)
UPDATE items SET prod_posting_group_code = 'FERT' WHERE CAST(code AS TEXT) LIKE '1010%';
UPDATE items SET prod_posting_group_code = 'CHEM' WHERE CAST(code AS TEXT) LIKE '1020%';
UPDATE items SET prod_posting_group_code = 'SEED' WHERE CAST(code AS TEXT) LIKE '1030%';
UPDATE items SET prod_posting_group_code = 'EQUIP' WHERE CAST(code AS TEXT) LIKE '105%' OR CAST(code AS TEXT) LIKE '107%';

-- Name-based fallback for remaining items
UPDATE items SET prod_posting_group_code = 'FERT'
WHERE prod_posting_group_code IS NULL
  AND (name LIKE '%سماد%' OR name LIKE '%نترات%' OR name LIKE '%يوريا%' OR name LIKE '%فوسفات%'
    OR name LIKE '%بوتاسيوم%' OR name LIKE '%ماغنيسيوم%' OR name LIKE '%ماغنسيوم%'
    OR name LIKE '%امينو%'    OR name LIKE '%حمض%'       OR name LIKE '%سوبر%'
    OR name LIKE '%سلفات%'    OR name LIKE '%ماب%'        OR name LIKE '%فيرتك%'
    OR name LIKE '%فيرت%'     OR name LIKE '%هيوم%'       OR name LIKE '%كلسيوم%'
    OR name LIKE '%كالسيوم%'  OR name LIKE '%فوليك%'      OR name LIKE '%بوليفيد%');

UPDATE items SET prod_posting_group_code = 'SEED'
WHERE prod_posting_group_code IS NULL
  AND (name LIKE '%تقاو%' OR name LIKE '%بذور%' OR name LIKE '%بذر%');

UPDATE items SET prod_posting_group_code = 'CHEM'
WHERE prod_posting_group_code IS NULL
  AND (name LIKE '%مبيد%' OR name LIKE '%رش%' OR name LIKE '%فطر%' OR name LIKE '%حشر%');

UPDATE items SET prod_posting_group_code = 'EQUIP'
WHERE prod_posting_group_code IS NULL;

-- Verification queries
SELECT 'warehouses_unassigned' as check_name, COUNT(*) as cnt FROM warehouses WHERE inv_posting_group_code IS NULL;
SELECT 'suppliers_unassigned' as check_name, COUNT(*) as cnt FROM suppliers WHERE bus_posting_group_code IS NULL;
SELECT 'items_unassigned' as check_name, COUNT(*) as cnt FROM items WHERE prod_posting_group_code IS NULL;
SELECT name, inv_posting_group_code FROM warehouses ORDER BY name;
SELECT bus_posting_group_code, COUNT(*) as cnt FROM suppliers GROUP BY bus_posting_group_code;
SELECT prod_posting_group_code, COUNT(*) as cnt FROM items GROUP BY prod_posting_group_code;
