-- Migration 0162: strict_po_matching flag on inventory_posting_controls
-- When enabled (1), POST /purchase-orders/:id/invoices is blocked until
-- at least one GRN (inventory_movements with movement_type='GRN') exists for the PO.
ALTER TABLE inventory_posting_controls
  ADD COLUMN strict_po_matching INTEGER NOT NULL DEFAULT 0;
