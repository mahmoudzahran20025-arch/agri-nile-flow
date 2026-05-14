-- Migration 0104: Backfill service_type_code for existing supplier_transactions
-- Strategy: assign each transaction the supplier's active primary service type mapping.

UPDATE supplier_transactions
SET service_type_code = (
  SELECT ssm.service_type_code
  FROM supplier_service_map ssm
  WHERE ssm.company_id = COALESCE(supplier_transactions.company_id, 1)
    AND ssm.supplier_code = supplier_transactions.supplier_code
    AND ssm.is_active = 1
  ORDER BY ssm.is_primary DESC, ssm.id ASC
  LIMIT 1
)
WHERE service_type_code IS NULL
  AND supplier_code IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM supplier_service_map ssm
    WHERE ssm.company_id = COALESCE(supplier_transactions.company_id, 1)
      AND ssm.supplier_code = supplier_transactions.supplier_code
      AND ssm.is_active = 1
  );
