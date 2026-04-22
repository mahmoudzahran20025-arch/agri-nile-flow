-- Phase D-4: Supplier Invoice 3-Way Match (PO → GR → Invoice)
CREATE TABLE IF NOT EXISTS supplier_invoices (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL,
  po_id           INTEGER NOT NULL,
  invoice_number  TEXT    NOT NULL,
  invoice_date    TEXT    NOT NULL,
  supplier_code   INTEGER,
  total_amount    REAL    NOT NULL DEFAULT 0,
  notes           TEXT,
  created_by      INTEGER,
  created_at      TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS supplier_invoice_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id    INTEGER NOT NULL,
  po_item_id    INTEGER NOT NULL,
  company_id    INTEGER NOT NULL,
  qty_invoiced  REAL    NOT NULL,
  unit_price    REAL    NOT NULL DEFAULT 0,
  FOREIGN KEY (invoice_id) REFERENCES supplier_invoices(id)  ON DELETE CASCADE,
  FOREIGN KEY (po_item_id) REFERENCES purchase_order_items(id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_po ON supplier_invoices(po_id, company_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_inv    ON supplier_invoice_items(invoice_id);
