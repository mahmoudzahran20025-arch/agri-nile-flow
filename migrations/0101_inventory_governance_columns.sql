-- 0101_inventory_governance_columns.sql
-- Canonical governance columns for inventory transactions and movements.

ALTER TABLE inventory_transactions ADD COLUMN statement_text TEXT;
ALTER TABLE inventory_transactions ADD COLUMN service_type_code TEXT;

ALTER TABLE inventory_movements ADD COLUMN statement_text TEXT;
ALTER TABLE inventory_movements ADD COLUMN service_type_code TEXT;

CREATE INDEX IF NOT EXISTS idx_inventory_movements_service_type_code
  ON inventory_movements(company_id, service_type_code, movement_type, movement_date)
  WHERE service_type_code IS NOT NULL;

SELECT 'inventory_governance_columns_added' AS status;