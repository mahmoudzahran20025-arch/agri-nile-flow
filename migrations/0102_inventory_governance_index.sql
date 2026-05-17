-- 0102_inventory_governance_index.sql
-- Retry-safe completion for inventory governance indexing.

CREATE INDEX IF NOT EXISTS idx_inventory_movements_service_type_code
  ON inventory_movements(company_id, service_type_code, movement_type, movement_date)
  WHERE service_type_code IS NOT NULL;

SELECT 'inventory_governance_index_ready' AS status;
