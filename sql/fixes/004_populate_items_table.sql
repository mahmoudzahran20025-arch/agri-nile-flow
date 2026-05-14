-- =============================================================================
-- POPULATE ITEMS TABLE FROM INVENTORY_MOVEMENTS
-- Generated: 2026-05-11
-- costing_method CHECK: must be 'moving_average' or 'fifo' (lowercase)
-- =============================================================================

-- Fertilizers (101xxxx)
INSERT OR IGNORE INTO items (code, company_id, name, unit, prod_posting_group_code, inv_posting_group_code, is_active, costing_method)
SELECT DISTINCT item_code, 1, 'صنف ' || item_code, 'كجم', 'FERT', 'AG_FERT', 1, 'fifo'
FROM inventory_movements WHERE company_id=1 AND item_code BETWEEN 1010000 AND 1019999;

-- Seeds (102xxxx)
INSERT OR IGNORE INTO items (code, company_id, name, unit, prod_posting_group_code, inv_posting_group_code, is_active, costing_method)
SELECT DISTINCT item_code, 1, 'صنف ' || item_code, 'كجم', 'SEED', 'AG_SEED', 1, 'fifo'
FROM inventory_movements WHERE company_id=1 AND item_code BETWEEN 1020000 AND 1029999;

-- Chemicals/Pesticides (103xxxx)
INSERT OR IGNORE INTO items (code, company_id, name, unit, prod_posting_group_code, inv_posting_group_code, is_active, costing_method)
SELECT DISTINCT item_code, 1, 'صنف ' || item_code, 'لتر', 'CHEM', 'AG_CHEM', 1, 'fifo'
FROM inventory_movements WHERE company_id=1 AND item_code BETWEEN 1030000 AND 1039999;

-- Equipment/Spare Parts (105xxxx)
INSERT OR IGNORE INTO items (code, company_id, name, unit, prod_posting_group_code, inv_posting_group_code, is_active, costing_method)
SELECT DISTINCT item_code, 1, 'صنف ' || item_code, 'قطعة', 'EQUIP', 'AG_EQUIP', 1, 'fifo'
FROM inventory_movements WHERE company_id=1 AND item_code BETWEEN 1050000 AND 1059999;

-- Equipment/Machinery (107xxxx)
INSERT OR IGNORE INTO items (code, company_id, name, unit, prod_posting_group_code, inv_posting_group_code, is_active, costing_method)
SELECT DISTINCT item_code, 1, 'صنف ' || item_code, 'قطعة', 'EQUIP', 'AG_EQUIP', 1, 'fifo'
FROM inventory_movements WHERE company_id=1 AND item_code BETWEEN 1070000 AND 1079999;

-- Other (109xxxx)
INSERT OR IGNORE INTO items (code, company_id, name, unit, prod_posting_group_code, inv_posting_group_code, is_active, costing_method)
SELECT DISTINCT item_code, 1, 'صنف ' || item_code, 'وحدة', 'OTHER', 'AG_OTHER', 1, 'moving_average'
FROM inventory_movements WHERE company_id=1 AND item_code BETWEEN 1090000 AND 1099999;

-- Verification
SELECT prod_posting_group_code, COUNT(*) as item_count
FROM items WHERE company_id=1
GROUP BY prod_posting_group_code ORDER BY prod_posting_group_code;
