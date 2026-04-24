-- ============================================================
-- Migration 0022: Season Guard (The Iron Curtain)
-- Purpose: Prevent any transactions on CLOSED seasons.
-- ============================================================

-- 1. Guard Inventory Movements
CREATE TRIGGER IF NOT EXISTS trg_season_guard_inventory
BEFORE INSERT ON inventory_movements
FOR EACH ROW
WHEN NEW.season_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT status FROM seasons WHERE id = NEW.season_id) = 'closed'
    THEN RAISE(ABORT, 'ERR_SEASON_CLOSED: لا يمكن إضافة حركات لموسم مغلق')
  END;
END;

-- 2. Guard Cash Transactions
CREATE TRIGGER IF NOT EXISTS trg_season_guard_cash
BEFORE INSERT ON cash_transactions
FOR EACH ROW
WHEN NEW.season_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT status FROM seasons WHERE id = NEW.season_id) = 'closed'
    THEN RAISE(ABORT, 'ERR_SEASON_CLOSED: لا يمكن إضافة حركات مالية لموسم مغلق')
  END;
END;

-- 3. Guard Supplier Transactions
CREATE TRIGGER IF NOT EXISTS trg_season_guard_suppliers
BEFORE INSERT ON supplier_transactions
FOR EACH ROW
WHEN NEW.season_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT status FROM seasons WHERE id = NEW.season_id) = 'closed'
    THEN RAISE(ABORT, 'ERR_SEASON_CLOSED: لا يمكن إضافة معاملات موردين لموسم مغلق')
  END;
END;

-- 4. Guard Work Orders
CREATE TRIGGER IF NOT EXISTS trg_season_guard_work_orders
BEFORE INSERT ON work_orders
FOR EACH ROW
WHEN NEW.season_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT status FROM seasons WHERE id = NEW.season_id) = 'closed'
    THEN RAISE(ABORT, 'ERR_SEASON_CLOSED: لا يمكن فتح أمر عمل لموسم مغلق')
  END;
END;
