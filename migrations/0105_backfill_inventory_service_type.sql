-- Migration 0105: Backfill service_type_code for existing inventory data
-- Historical rows have no semantic discriminator (notes/statement/category mostly null),
-- so we apply the safe governance default for GRN/ISSUE: SRV_SUPPLY.

UPDATE inventory_movements
SET service_type_code = 'SRV_SUPPLY'
WHERE service_type_code IS NULL
  AND movement_type IN ('GRN', 'ISSUE');

UPDATE inventory_transactions
SET service_type_code = 'SRV_SUPPLY'
WHERE service_type_code IS NULL
  AND transaction_type IN ('GRN', 'ISSUE');
