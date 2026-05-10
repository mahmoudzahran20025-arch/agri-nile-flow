-- ============================================================
-- Migration 0098: Fix equipment_type_id=1 Orphan References
-- Problem: 109 supplier_transactions reference equipment_type_id=1
--          which does not exist in equipment_types (IDs start at 6).
-- Solution: Map each row to the correct type using the equipment
--           free-text name as the authoritative source.
-- Mapping (verified against equipment_types table):
--   لودر    → id=12
--   بدارة   → id=7
--   بلانتر  → id=8
--   رشاشة   → id=11
--   رشاشه   → id=11  (alternate spelling)
--   جرار    → id=6
--   عزاقه   → id=17  (new type — inserted below, category=machinery)
-- ============================================================

-- Insert missing type for عزاقه (not in current list)
INSERT OR IGNORE INTO equipment_types
  (company_id, code, name, category, asset_nature, default_life_months, created_at)
VALUES
  (1, 'CULT-01', 'عزاقه', 'machinery', 'capital', 60, datetime('now'));

-- Remap orphan references: equipment text → correct type id
-- Each UPDATE is isolated by equipment name to prevent cross-contamination.

UPDATE supplier_transactions
SET equipment_type_id = 12   -- لودر
WHERE company_id = 1
  AND equipment_type_id = 1
  AND equipment = 'لودر';

UPDATE supplier_transactions
SET equipment_type_id = 7    -- بدارة
WHERE company_id = 1
  AND equipment_type_id = 1
  AND equipment = 'بدارة';

UPDATE supplier_transactions
SET equipment_type_id = 8    -- بلانتر
WHERE company_id = 1
  AND equipment_type_id = 1
  AND equipment = 'بلانتر';

UPDATE supplier_transactions
SET equipment_type_id = 11   -- رشاشة (both spellings)
WHERE company_id = 1
  AND equipment_type_id = 1
  AND equipment IN ('رشاشة', 'رشاشه');

UPDATE supplier_transactions
SET equipment_type_id = 6    -- جرار
WHERE company_id = 1
  AND equipment_type_id = 1
  AND equipment = 'جرار';

UPDATE supplier_transactions
SET equipment_type_id = (
  SELECT id FROM equipment_types
  WHERE company_id = 1 AND code = 'CULT-01' LIMIT 1
)
WHERE company_id = 1
  AND equipment_type_id = 1
  AND equipment = 'عزاقه';

-- Safety check: any remaining id=1 references get NULL
-- (better NULL than a broken foreign key — will surface in governance dashboard)
UPDATE supplier_transactions
SET equipment_type_id = NULL
WHERE company_id = 1
  AND equipment_type_id = 1;
