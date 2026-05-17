-- 0091_work_orders_center_code_and_equipment_linkage.sql
-- Goal:
-- 1) Add center_code to work_orders so operations costing can post by cost center.
-- 2) Enrich work_order_equipment to distinguish owned vs rental sources.

-- 1) Add center_code to work_orders
ALTER TABLE work_orders ADD COLUMN center_code INTEGER;

-- Backfill from linked field when available
UPDATE work_orders
SET center_code = (
  SELECT f.center_code
  FROM fields f
  WHERE f.id = work_orders.field_id
    AND f.company_id = work_orders.company_id
)
WHERE center_code IS NULL
  AND field_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_company_center ON work_orders(company_id, center_code);

-- 2) Enrich work_order_equipment for ownership/rental tracing
ALTER TABLE work_order_equipment ADD COLUMN equipment_usage_mode TEXT NOT NULL DEFAULT 'rental';
ALTER TABLE work_order_equipment ADD COLUMN fixed_asset_id INTEGER REFERENCES fixed_assets(id);
ALTER TABLE work_order_equipment ADD COLUMN supplier_code INTEGER;

CREATE INDEX IF NOT EXISTS idx_woe_company_mode ON work_order_equipment(company_id, equipment_usage_mode, task_date);
CREATE INDEX IF NOT EXISTS idx_woe_fixed_asset ON work_order_equipment(fixed_asset_id);
CREATE INDEX IF NOT EXISTS idx_woe_supplier ON work_order_equipment(supplier_code);

-- Validate usage mode
CREATE TRIGGER IF NOT EXISTS trg_woe_validate_usage_mode_insert
BEFORE INSERT ON work_order_equipment
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.equipment_usage_mode NOT IN ('owned', 'rental')
    THEN RAISE(ABORT, 'equipment_usage_mode must be owned or rental')
  END;

  SELECT CASE
    WHEN NEW.equipment_usage_mode = 'owned' AND NEW.fixed_asset_id IS NULL
    THEN RAISE(ABORT, 'fixed_asset_id is required when equipment_usage_mode=owned')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_woe_validate_usage_mode_update
BEFORE UPDATE ON work_order_equipment
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.equipment_usage_mode NOT IN ('owned', 'rental')
    THEN RAISE(ABORT, 'equipment_usage_mode must be owned or rental')
  END;

  SELECT CASE
    WHEN NEW.equipment_usage_mode = 'owned' AND NEW.fixed_asset_id IS NULL
    THEN RAISE(ABORT, 'fixed_asset_id is required when equipment_usage_mode=owned')
  END;
END;
