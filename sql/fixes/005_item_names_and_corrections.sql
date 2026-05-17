-- =============================================================================
-- SPRINT 1 DAY 1: Item Names, Units, and Posting Group Corrections
-- Source: مخازن_نواة_المستقبل_2025-2026.json
-- Date: 2026-05-11
-- =============================================================================
-- CRITICAL FINDING: Code-range vs actual warehouse mismatch discovered:
--   102xxxx items → actually in مبيدات (CHEM-WH), NOT seed warehouse
--   103xxxx items → actually in تقاوي وبذور (SEED-WH), NOT chem warehouse
--   105xxxx items → actually in شبكات ري (IRR-WH)
--   109xxxx items → actually in متنوعات (MISC-WH)  ← correct
-- The original 004 script mapped by code range which was inverted for 102/103.
-- =============================================================================

-- BLOCK 1: Fix posting groups for 102xxxx items (are CHEM, not SEED)
UPDATE items SET prod_posting_group_code = 'CHEM', inv_posting_group_code = 'AG_CHEM'
WHERE company_id = 1 AND code BETWEEN 1020000 AND 1029999;

-- BLOCK 2: Fix posting groups for 103xxxx items (are SEED, not CHEM)
UPDATE items SET prod_posting_group_code = 'SEED', inv_posting_group_code = 'AG_SEED'
WHERE company_id = 1 AND code BETWEEN 1030000 AND 1039999;

-- BLOCK 3: Fix posting groups for 105xxxx items (are IRR irrigation parts, not general EQUIP)
-- Keep prod_posting_group_code=EQUIP (closest match — no IRR PPG exists), fix inv_posting_group_code
-- IRR-WH uses SPARE-WH×EQUIP rule cascade as fallback — IRR-WH has its own rules in posting_rules
-- No change needed to PPG (EQUIP is correct for irrigation spare parts), but IPG must match warehouse
UPDATE items SET inv_posting_group_code = 'IRR-WH'
WHERE company_id = 1 AND code BETWEEN 1050000 AND 1059999;

-- BLOCK 4: Fix posting groups for 107xxxx items (قطع غيار → SPARE-WH)
UPDATE items SET inv_posting_group_code = 'SPARE-WH'
WHERE company_id = 1 AND code BETWEEN 1070000 AND 1079999;

-- =============================================================================
-- BLOCK 5: Update item names and units from source JSON (all 48 items)
-- =============================================================================

-- Fertilizers (101xxxx) — warehouse: اسمدة
UPDATE items SET name = 'حمض فسفوريك', unit = 'كجم'       WHERE company_id=1 AND code=1010002;
UPDATE items SET name = 'سلفات النشادر محبب', unit = 'كجم' WHERE company_id=1 AND code=1010004;
UPDATE items SET name = 'حمض كبرتيك', unit = 'كجم'        WHERE company_id=1 AND code=1010006;
UPDATE items SET name = 'سلفات ماغنسيوم', unit = 'كجم'    WHERE company_id=1 AND code=1010023;
UPDATE items SET name = 'ماب', unit = 'كجم'                WHERE company_id=1 AND code=1010060;
UPDATE items SET name = 'فولفيك', unit = 'كجم'             WHERE company_id=1 AND code=1010062;
UPDATE items SET name = 'حامض نيتريك', unit = 'كجم'        WHERE company_id=1 AND code=1010066;
UPDATE items SET name = 'هيومك', unit = 'كجم'              WHERE company_id=1 AND code=1010071;
UPDATE items SET name = 'نترات ابوقير', unit = 'كجم'       WHERE company_id=1 AND code=1010074;
UPDATE items SET name = 'بوتاسيوم 0050', unit = 'كجم'      WHERE company_id=1 AND code=1010075;
UPDATE items SET name = 'يوريا', unit = 'كجم'              WHERE company_id=1 AND code=1010095;
UPDATE items SET name = 'نترات كالسيوم محبب صيني', unit = 'كجم' WHERE company_id=1 AND code=1010132;
UPDATE items SET name = 'اي جي امينو - احماض امينية', unit = 'لتر' WHERE company_id=1 AND code=1010189;
UPDATE items SET name = 'سبيد الجاماكس', unit = 'لتر'      WHERE company_id=1 AND code=1010327;
UPDATE items SET name = 'فيرتك 19-19-19', unit = 'كجم'     WHERE company_id=1 AND code=1010374;
UPDATE items SET name = 'فيروكس - منشط جزور', unit = 'لتر' WHERE company_id=1 AND code=1010436;
UPDATE items SET name = 'سبلة سير', unit = 'متر'            WHERE company_id=1 AND code=1010437;
UPDATE items SET name = 'اي جي سي انيتروبي اس', unit = 'لتر' WHERE company_id=1 AND code=1010438;
UPDATE items SET name = 'اي جي مالتي ميكس - مكس عناصر', unit = 'لتر' WHERE company_id=1 AND code=1010439;
UPDATE items SET name = 'اي جي سي بورامين 15%', unit = 'لتر' WHERE company_id=1 AND code=1010449;

-- Pesticides/Chemicals (102xxxx) — warehouse: مبيدات
UPDATE items SET name = 'خل', unit = 'لتر'                  WHERE company_id=1 AND code=1020259;
UPDATE items SET name = 'ساليكس', unit = 'كجم'              WHERE company_id=1 AND code=1020288;
UPDATE items SET name = 'مارفل - معالج ملوحة', unit = 'لتر' WHERE company_id=1 AND code=1020361;
UPDATE items SET name = 'نصر بروكسيد - ماء اكسجين', unit = 'لتر' WHERE company_id=1 AND code=1020362;
UPDATE items SET name = 'ريزوسفير 15', unit = 'لتر'         WHERE company_id=1 AND code=1020380;
UPDATE items SET name = 'هاي كيو', unit = 'لتر'             WHERE company_id=1 AND code=1020393;
UPDATE items SET name = 'لارفا مايورا', unit = 'لتر'        WHERE company_id=1 AND code=1020401;

-- Seeds (103xxxx) — warehouse: تقاوي وبذور
UPDATE items SET name = 'تقاوى بنجر جوستاف', unit = 'وحدة'  WHERE company_id=1 AND code=1030002;
UPDATE items SET name = 'تقاوى بنجر جينيو', unit = 'وحدة'   WHERE company_id=1 AND code=1030008;
UPDATE items SET name = 'تقاوي بنجر تايسون', unit = 'وحدة'  WHERE company_id=1 AND code=1030229;
UPDATE items SET name = 'تقاوى بنجر برسيا', unit = 'وحدة'   WHERE company_id=1 AND code=1030233;
UPDATE items SET name = 'تقاوي بنجر ماتروس', unit = 'وحدة'  WHERE company_id=1 AND code=1030264;
UPDATE items SET name = 'تقاوي بنجر Pitt', unit = 'وحدة'    WHERE company_id=1 AND code=1030265;
UPDATE items SET name = 'تقاوي بنجر دنزيل', unit = 'وحدة'   WHERE company_id=1 AND code=1030266;
UPDATE items SET name = 'تقاوي بنجر بي تي اس 7870', unit = 'وحدة' WHERE company_id=1 AND code=1030267;
UPDATE items SET name = 'تقاوي بنجر بريليف', unit = 'وحدة'  WHERE company_id=1 AND code=1030274;
UPDATE items SET name = 'تقاوي بنجر امالدي', unit = 'وحدة'  WHERE company_id=1 AND code=1030277;

-- Irrigation Parts (105xxxx) — warehouse: شبكات ري
UPDATE items SET name = 'لفة خرطوم 2 بوصة', unit = 'وحدة'  WHERE company_id=1 AND code=1050092;
UPDATE items SET name = 'نبل بلاستيك 3/4 بوصة', unit = 'وحدة' WHERE company_id=1 AND code=1050095;
UPDATE items SET name = 'قفيز 2 بوصة حديد', unit = 'وحدة'  WHERE company_id=1 AND code=1050149;
UPDATE items SET name = 'محبس 3/4 سن', unit = 'وحدة'        WHERE company_id=1 AND code=1050316;

-- Spare Parts (107xxxx) — warehouse: قطع غيار
UPDATE items SET name = 'شريط لحام', unit = 'وحدة'          WHERE company_id=1 AND code=1070238;
UPDATE items SET name = 'اسكوتش', unit = 'وحدة'             WHERE company_id=1 AND code=1070245;
UPDATE items SET name = 'سرفيل 50 نحاس', unit = 'وحدة'     WHERE company_id=1 AND code=1070786;
UPDATE items SET name = 'مفتاح كهرباء', unit = 'وحدة'       WHERE company_id=1 AND code=1070844;

-- Misc (109xxxx) — warehouse: متنوعات
UPDATE items SET name = 'لمبه 9 وات', unit = 'وحدة'         WHERE company_id=1 AND code=1090043;
UPDATE items SET name = 'صرف قاعده سوسته', unit = 'وحدة'   WHERE company_id=1 AND code=1090228;
UPDATE items SET name = 'كوع سيفون 4 بوصة', unit = 'وحدة'  WHERE company_id=1 AND code=1090230;

-- =============================================================================
-- BLOCK 6: Opening GRN movements for 5 negative-balance items
-- These items have ISSUE records but no corresponding GRN — opening stock missing
-- Date set to day before first movement (or 2025-11-01 season start if pre-season)
-- Quantities = exact deficit to bring balance to zero
-- =============================================================================

-- 1010004 سلفات النشادر محبب: net=-1750 kg, first movement 2026-03-10
INSERT INTO inventory_movements
  (company_id, season_id, warehouse_id, warehouse, item_code, movement_type, quantity, movement_date, notes)
VALUES
  (1, 1, 1, 'اسمدة', 1010004, 'GRN', 1750, '2026-03-09', 'رصيد افتتاحي تصحيحي - Sprint1');

-- 1030229 تقاوي بنجر تايسون: net=-30 units, first movement 2026-01-21
INSERT INTO inventory_movements
  (company_id, season_id, warehouse_id, warehouse, item_code, movement_type, quantity, movement_date, notes)
VALUES
  (1, 1, 3, 'تقاوي وبذور', 1030229, 'GRN', 30, '2026-01-20', 'رصيد افتتاحي تصحيحي - Sprint1');

-- 1070786 سرفيل 50 نحاس: net=-3 units, first movement 2026-03-28
INSERT INTO inventory_movements
  (company_id, season_id, warehouse_id, warehouse, item_code, movement_type, quantity, movement_date, notes)
VALUES
  (1, 1, 6, 'قطع غيار', 1070786, 'GRN', 3, '2026-03-27', 'رصيد افتتاحي تصحيحي - Sprint1');

-- 1070238 شريط لحام: net=-2 units, first movement 2026-03-28
INSERT INTO inventory_movements
  (company_id, season_id, warehouse_id, warehouse, item_code, movement_type, quantity, movement_date, notes)
VALUES
  (1, 1, 6, 'قطع غيار', 1070238, 'GRN', 2, '2026-03-27', 'رصيد افتتاحي تصحيحي - Sprint1');

-- 1070245 اسكوتش: net=-1 unit, first movement 2026-03-28
INSERT INTO inventory_movements
  (company_id, season_id, warehouse_id, warehouse, item_code, movement_type, quantity, movement_date, notes)
VALUES
  (1, 1, 6, 'قطع غيار', 1070245, 'GRN', 1, '2026-03-27', 'رصيد افتتاحي تصحيحي - Sprint1');

-- =============================================================================
-- BLOCK 7: Verification
-- =============================================================================

-- Check all items now have real names (no more 'صنف XXXXXXX')
SELECT COUNT(*) as items_with_stub_names FROM items WHERE company_id=1 AND name LIKE 'صنف %';

-- Check negative items are resolved
SELECT item_code, SUM(CASE WHEN movement_type='GRN' THEN quantity ELSE -quantity END) as net_qty
FROM inventory_movements WHERE company_id=1
GROUP BY item_code HAVING net_qty < 0 ORDER BY net_qty;

-- Check posting group correction
SELECT
  CASE WHEN code BETWEEN 1020000 AND 1029999 THEN '102xxxx'
       WHEN code BETWEEN 1030000 AND 1039999 THEN '103xxxx'
       WHEN code BETWEEN 1050000 AND 1059999 THEN '105xxxx'
       WHEN code BETWEEN 1070000 AND 1079999 THEN '107xxxx'
       ELSE 'other' END as range,
  prod_posting_group_code, inv_posting_group_code, COUNT(*) as cnt
FROM items WHERE company_id=1
GROUP BY 1, 2, 3
ORDER BY 1;
