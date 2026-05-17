UPDATE inventory_movements
SET season_id = COALESCE(
  (
    SELECT f.season_id
    FROM fields f
    WHERE f.company_id = inventory_movements.company_id
      AND f.center_code = inventory_movements.center_code
      AND f.is_active = 1
      AND f.season_id IS NOT NULL
    LIMIT 1
  ),
  (
    SELECT s.id
    FROM seasons s
    WHERE s.company_id = inventory_movements.company_id
      AND s.status = 'active'
    ORDER BY s.id DESC
    LIMIT 1
  )
)
WHERE company_id = 1
  AND season_id IS NULL;

UPDATE inventory_movements
SET field_id = (
  SELECT f.id
  FROM fields f
  WHERE f.company_id = inventory_movements.company_id
    AND f.center_code = inventory_movements.center_code
    AND f.is_active = 1
    AND f.season_id IS NOT NULL
  LIMIT 1
)
WHERE company_id = 1
  AND field_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM fields f
    WHERE f.company_id = inventory_movements.company_id
      AND f.center_code = inventory_movements.center_code
      AND f.is_active = 1
      AND f.season_id IS NOT NULL
  );

UPDATE cash_transactions
SET season_id = COALESCE(
  (
    SELECT f.season_id
    FROM fields f
    WHERE f.company_id = cash_transactions.company_id
      AND f.center_code = cash_transactions.center_code
      AND f.is_active = 1
      AND f.season_id IS NOT NULL
    LIMIT 1
  ),
  (
    SELECT s.id
    FROM seasons s
    WHERE s.company_id = cash_transactions.company_id
      AND s.status = 'active'
    ORDER BY s.id DESC
    LIMIT 1
  )
)
WHERE company_id = 1
  AND season_id IS NULL;

UPDATE cash_transactions
SET field_id = (
  SELECT f.id
  FROM fields f
  WHERE f.company_id = cash_transactions.company_id
    AND f.center_code = cash_transactions.center_code
    AND f.is_active = 1
    AND f.season_id IS NOT NULL
  LIMIT 1
)
WHERE company_id = 1
  AND field_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM fields f
    WHERE f.company_id = cash_transactions.company_id
      AND f.center_code = cash_transactions.center_code
      AND f.is_active = 1
      AND f.season_id IS NOT NULL
  );

SELECT 'inventory_missing_season' AS metric, COUNT(*) AS n
FROM inventory_movements
WHERE company_id = 1 AND season_id IS NULL;

SELECT 'inventory_missing_field_operational' AS metric, COUNT(*) AS n
FROM inventory_movements im
WHERE im.company_id = 1
  AND im.field_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM fields f
    WHERE f.company_id = im.company_id
      AND f.center_code = im.center_code
      AND f.is_active = 1
      AND f.season_id IS NOT NULL
  );

SELECT 'cash_missing_season' AS metric, COUNT(*) AS n
FROM cash_transactions
WHERE company_id = 1 AND season_id IS NULL;

SELECT 'cash_missing_field_operational' AS metric, COUNT(*) AS n
FROM cash_transactions ct
WHERE ct.company_id = 1
  AND ct.field_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM fields f
    WHERE f.company_id = ct.company_id
      AND f.center_code = ct.center_code
      AND f.is_active = 1
      AND f.season_id IS NOT NULL
  );