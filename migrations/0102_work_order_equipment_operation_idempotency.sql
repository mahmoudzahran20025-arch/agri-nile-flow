-- 0102_work_order_equipment_operation_idempotency.sql
-- Goal:
-- 1) Add operation_id to work_order_equipment for endpoint-level idempotency.
-- 2) Enforce uniqueness per (company_id, work_order_id, operation_id).

ALTER TABLE work_order_equipment ADD COLUMN operation_id TEXT;

-- Keep operation_id nullable for legacy rows; endpoint enforces non-null for new inserts.
CREATE UNIQUE INDEX IF NOT EXISTS uq_woe_operation_id
  ON work_order_equipment(company_id, work_order_id, operation_id)
  WHERE operation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_woe_company_order_operation
  ON work_order_equipment(company_id, work_order_id, operation_id);
