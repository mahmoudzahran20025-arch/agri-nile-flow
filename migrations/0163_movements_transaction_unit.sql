-- Migration 0163: transaction_unit + transaction_qty on inventory_movements
-- -------------------------------------------------------------------------
-- Preserves the original unit and quantity as the user entered them, so that
-- display layers can show "100 KG (2 bags)" without recomputation.
-- The authoritative quantity column remains `quantity` (always in base_unit).

ALTER TABLE inventory_movements ADD COLUMN transaction_unit TEXT;
ALTER TABLE inventory_movements ADD COLUMN transaction_qty  REAL;
