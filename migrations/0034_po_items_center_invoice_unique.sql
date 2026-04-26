-- Migration 0034: center_code on PO items + unique invoice number constraint

-- 1. Add cost-center dimension to purchase_order_items
ALTER TABLE purchase_order_items ADD COLUMN center_code INTEGER REFERENCES cost_centers(code);

-- 2. Prevent duplicate supplier invoice numbers per company
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_invoices_number
  ON supplier_invoices (company_id, invoice_number);
