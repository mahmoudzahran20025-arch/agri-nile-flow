-- Backfill fields.center_code using pivot mapping from cost_centers
-- Scope: company_id = 1

-- 0) Before snapshot
SELECT id, code, name, center_code
FROM fields
WHERE company_id = 1
ORDER BY id;

-- 1) Primary mapping: field.code == cost_centers.code
UPDATE fields
SET center_code = CAST(code AS INTEGER)
WHERE company_id = 1
  AND center_code IS NULL
  AND code GLOB '[0-9]*'
  AND CAST(code AS TEXT) IN (
    SELECT cc.code
    FROM cost_centers cc
    WHERE cc.company_id = fields.company_id
      AND cc.is_active = 1
  );

-- 2) Fallback mapping by exact Arabic name match
UPDATE fields
SET center_code = (
  SELECT CAST(cc.code AS INTEGER)
  FROM cost_centers cc
  WHERE cc.company_id = fields.company_id
    AND cc.is_active = 1
    AND TRIM(cc.name_ar) = TRIM(fields.name)
  LIMIT 1
)
WHERE company_id = 1
  AND center_code IS NULL
  AND EXISTS (
    SELECT 1
    FROM cost_centers cc
    WHERE cc.company_id = fields.company_id
      AND cc.is_active = 1
      AND TRIM(cc.name_ar) = TRIM(fields.name)
  );

-- 3) Propagate to existing work_orders
UPDATE work_orders
SET center_code = (
  SELECT f.center_code
  FROM fields f
  WHERE f.id = work_orders.field_id
    AND f.company_id = work_orders.company_id
)
WHERE company_id = 1
  AND center_code IS NULL
  AND field_id IS NOT NULL;

-- 4) After snapshot
SELECT id, code, name, center_code
FROM fields
WHERE company_id = 1
ORDER BY id;

-- 5) Unmapped fields (manual review)
SELECT id, code, name
FROM fields
WHERE company_id = 1 AND center_code IS NULL
ORDER BY id;

-- 6) Work orders coverage check
SELECT COUNT(*) AS wo_total,
       SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) AS wo_with_center,
       SUM(CASE WHEN center_code IS NULL THEN 1 ELSE 0 END) AS wo_without_center
FROM work_orders
WHERE company_id = 1;
