-- 0160: Add po_id to inventory_movements for GRN reversal traceability
-- Needed to identify which movements to reverse when a purchase order is cancelled.
-- Back-filled NULL for existing rows; set going forward in processPOReceiptOrchestrated.

ALTER TABLE inventory_movements ADD COLUMN po_id INTEGER REFERENCES purchase_orders(id);

CREATE INDEX IF NOT EXISTS idx_inv_movements_po_id
  ON inventory_movements(company_id, po_id)
  WHERE po_id IS NOT NULL;
