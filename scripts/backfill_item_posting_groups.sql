-- Bulk backfill PPG + IPG on items using warehouse as the mapping key.
-- SAFE: only touches rows where prod_posting_group_code IS NULL.
-- Each PPG code has valid GPS (general_posting_setup) entries.

-- اسمدة → FERT / FERT-WH
UPDATE items SET
  prod_posting_group_code = 'FERT',
  inv_posting_group_code  = 'FERT-WH'
WHERE warehouse = 'اسمدة'
  AND (prod_posting_group_code IS NULL OR TRIM(prod_posting_group_code) = '');

-- مبيدات → CHEM / CHEM-WH
UPDATE items SET
  prod_posting_group_code = 'CHEM',
  inv_posting_group_code  = 'CHEM-WH'
WHERE warehouse = 'مبيدات'
  AND (prod_posting_group_code IS NULL OR TRIM(prod_posting_group_code) = '');

-- تقاوي وبذور → SEED / SEED-WH
UPDATE items SET
  prod_posting_group_code = 'SEED',
  inv_posting_group_code  = 'SEED-WH'
WHERE warehouse = 'تقاوي وبذور'
  AND (prod_posting_group_code IS NULL OR TRIM(prod_posting_group_code) = '');

-- قطع غيار → EQUIP / MAIN-WH
UPDATE items SET
  prod_posting_group_code = 'EQUIP',
  inv_posting_group_code  = 'MAIN-WH'
WHERE warehouse = 'قطع غيار'
  AND (prod_posting_group_code IS NULL OR TRIM(prod_posting_group_code) = '');

-- شبكات ري → EQUIP / MAIN-WH
UPDATE items SET
  prod_posting_group_code = 'EQUIP',
  inv_posting_group_code  = 'MAIN-WH'
WHERE warehouse = 'شبكات ري'
  AND (prod_posting_group_code IS NULL OR TRIM(prod_posting_group_code) = '');

-- متنوعات → EQUIP / FERT-WH  (matching existing 4 assigned items)
UPDATE items SET
  prod_posting_group_code = 'EQUIP',
  inv_posting_group_code  = 'FERT-WH'
WHERE warehouse = 'متنوعات'
  AND (prod_posting_group_code IS NULL OR TRIM(prod_posting_group_code) = '');

-- عدد وادوات → EQUIP / MAIN-WH  (tools, no prior assignments)
UPDATE items SET
  prod_posting_group_code = 'EQUIP',
  inv_posting_group_code  = 'MAIN-WH'
WHERE warehouse = 'عدد وادوات'
  AND (prod_posting_group_code IS NULL OR TRIM(prod_posting_group_code) = '');

-- تعبئة وتغليف → FERT / FERT-WH  (matching existing 1 assigned item)
UPDATE items SET
  prod_posting_group_code = 'FERT',
  inv_posting_group_code  = 'FERT-WH'
WHERE warehouse = 'تعبئة وتغليف'
  AND (prod_posting_group_code IS NULL OR TRIM(prod_posting_group_code) = '');

-- زيوت ووقود → FERT / FERT-WH  (matching existing 1 assigned item)
UPDATE items SET
  prod_posting_group_code = 'FERT',
  inv_posting_group_code  = 'FERT-WH'
WHERE warehouse = 'زيوت ووقود'
  AND (prod_posting_group_code IS NULL OR TRIM(prod_posting_group_code) = '');

-- اصول ثابتة → EQUIP_CAP / MAIN-WH  (fixed assets, no prior assignments)
UPDATE items SET
  prod_posting_group_code = 'EQUIP_CAP',
  inv_posting_group_code  = 'MAIN-WH'
WHERE warehouse = 'اصول ثابتة'
  AND (prod_posting_group_code IS NULL OR TRIM(prod_posting_group_code) = '');

-- انتاج تام → HARVEST / FINISHED  (finished goods, no prior assignments)
UPDATE items SET
  prod_posting_group_code = 'HARVEST',
  inv_posting_group_code  = 'FINISHED'
WHERE warehouse = 'انتاج تام'
  AND (prod_posting_group_code IS NULL OR TRIM(prod_posting_group_code) = '');
