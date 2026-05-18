-- Migration 0148 — Item POS prerequisites + expiry governance
--
-- list_price   : base selling price (POS prerequisite; not used in cost calculations)
-- barcode      : scanning/POS identifier; unique per company where set
-- expiry_tracking : when 1, inbound movements (GRN/RETURN_CUSTOMER) must supply expiry_date
--
-- All columns are additive with safe defaults — no existing behavior changes.

ALTER TABLE items ADD COLUMN list_price       REAL;
ALTER TABLE items ADD COLUMN barcode          TEXT;
ALTER TABLE items ADD COLUMN expiry_tracking  INTEGER NOT NULL DEFAULT 0
  CHECK(expiry_tracking IN (0, 1));

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_barcode_company
  ON items(company_id, barcode)
  WHERE barcode IS NOT NULL;
