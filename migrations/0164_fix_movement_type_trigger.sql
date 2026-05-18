-- Migration 0164: Replace legacy Arabic movement-type triggers
-- ---------------------------------------------------------------
-- Migration 001_constraints_staging_audit.sql defined trg_im_type_insert
-- and trg_im_type_update that only allow movement_type IN ('اضافة', 'صرف').
-- The backend has used English canonical types (GRN, ISSUE, TRANSFER_IN, …)
-- since the canonical-movement refactor. If those triggers are live they block
-- every single inventory movement — they are safe to drop because:
--   1) The system has been operating with English types (trigger was likely
--      never applied to production D1, or ignored due to IF NOT EXISTS on a
--      new schema).
--   2) The correct enforcement is now in the application layer
--      (SUPPORTED_MOVEMENT_TYPES set in movements.ts).
--
-- We replace them with guards that enforce the actual English canonical enum
-- and also fix the warehouse check (schema uses warehouse_id, not warehouse).

DROP TRIGGER IF EXISTS trg_im_type_insert;
DROP TRIGGER IF EXISTS trg_im_type_update;

-- Re-create with correct English enum + warehouse_id check
CREATE TRIGGER IF NOT EXISTS trg_im_type_insert
BEFORE INSERT ON inventory_movements
BEGIN
  SELECT CASE
    WHEN NEW.movement_type NOT IN (
      'GRN', 'GRN_REVERSE',
      'ISSUE',
      'RETURN_CUSTOMER', 'RETURN_SUPPLIER',
      'TRANSFER_IN', 'TRANSFER_OUT',
      'ADJUSTMENT_PROFIT', 'ADJUSTMENT_LOSS',
      'PRODUCTION_INPUT', 'PRODUCTION_OUTPUT',
      'SALE'
    )
    THEN RAISE(ABORT, 'ERR_INVALID_MOVEMENT_TYPE: unsupported movement_type value')
  END;
  SELECT CASE
    WHEN NEW.quantity IS NULL OR NEW.quantity <= 0
    THEN RAISE(ABORT, 'ERR_INVALID_QUANTITY: quantity must be > 0')
  END;
  SELECT CASE
    WHEN NEW.warehouse_id IS NULL
    THEN RAISE(ABORT, 'ERR_MISSING_WAREHOUSE: warehouse_id is required')
  END;
  SELECT CASE
    WHEN NEW.movement_date IS NULL
    THEN RAISE(ABORT, 'ERR_MISSING_DATE: movement_date is required')
  END;
  SELECT CASE
    WHEN NEW.item_code IS NULL
    THEN RAISE(ABORT, 'ERR_MISSING_ITEM: item_code is required')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_im_type_update
BEFORE UPDATE ON inventory_movements
BEGIN
  SELECT CASE
    WHEN NEW.movement_type NOT IN (
      'GRN', 'GRN_REVERSE',
      'ISSUE',
      'RETURN_CUSTOMER', 'RETURN_SUPPLIER',
      'TRANSFER_IN', 'TRANSFER_OUT',
      'ADJUSTMENT_PROFIT', 'ADJUSTMENT_LOSS',
      'PRODUCTION_INPUT', 'PRODUCTION_OUTPUT',
      'SALE'
    )
    THEN RAISE(ABORT, 'ERR_INVALID_MOVEMENT_TYPE: unsupported movement_type value')
  END;
  SELECT CASE
    WHEN NEW.quantity IS NULL OR NEW.quantity <= 0
    THEN RAISE(ABORT, 'ERR_INVALID_QUANTITY: quantity must be > 0')
  END;
END;
