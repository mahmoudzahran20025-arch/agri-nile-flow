-- Migration: 0147 — inventory_movements total_value_entered
--
-- Stores the operator's original value entry (total cost of the line) alongside
-- the derived unit_price. Enables audit trail for GRNs entered as "total cost"
-- rather than "price per unit". No behavior change — GL posting uses value_in/value_out.
--
-- _entered suffix distinguishes this from computed value_in / value_out columns.

ALTER TABLE inventory_movements ADD COLUMN total_value_entered REAL;

CREATE INDEX IF NOT EXISTS idx_inv_movements_date_wh
  ON inventory_movements(company_id, warehouse_id, movement_date DESC, id DESC);
